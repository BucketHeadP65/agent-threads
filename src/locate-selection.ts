/**
 * Maps a reading-view selection (rendered text, formatting marks gone) back
 * to the one span of raw markdown source it came from. Reading view renders
 * `**bold**`, `[text](url)`, `` `code` `` and heading/list/quote markers away,
 * so a plain substring search fails on any formatted or marked-up selection.
 * The ladder here: a literal match, a whitespace-flexible match, then a match
 * against a marker-stripped shadow of the source whose every character maps
 * back to its source offset. When the caller knows which occurrence of the
 * text the reader selected (counted in the rendered text), that occurrence is
 * taken from the shadow, which approximates the rendered text closely enough
 * for the counts to line up. Otherwise a selection inside a rendered heading
 * narrows a multi-hit result to spans on heading lines of that level. `null`
 * means the selection cannot be pinned to exactly one source span, and no
 * anchor should be created from a guess.
 */

import { escapeLiteral, findAll, flexiblePattern, literalPattern } from "./anchors";
import type { Span } from "./anchors";

export interface SourceSpan {
  start: number;
  end: number;
}

/**
 * The source span `selected` (as rendered text) came from, or `null` when no
 * single span can be pinned. `headingLevel` narrows an ambiguous result to
 * heading lines of that level (1 to 6) when the selection sat in a rendered
 * heading. `within` confines the search to that span of `source` (it must
 * start at a line start). The result is still in whole-source offsets.
 * `occurrence` is the index of the selected occurrence among the matches of
 * the text in the rendered form of that span (see `occurrenceIndex`).
 */
export function locateSelection(
  source: string,
  selected: string,
  headingLevel: number | null = null,
  within: SourceSpan | null = null,
  occurrence: number | null = null,
): SourceSpan | null {
  if (within !== null) {
    const inner = locateSelection(source.slice(within.start, within.end), selected, headingLevel, null, occurrence);
    return inner === null ? null : { start: inner.start + within.start, end: inner.end + within.start };
  }
  const text = selected.trim();
  if (text === "") return null;

  const shadow = strippedShadow(source);
  if (occurrence !== null) {
    const picked = shadowSpans(shadow, text)[occurrence];
    if (picked !== undefined) return picked;
  }

  const literal = narrow(source, findAll(source, literalPattern(text)), headingLevel);
  if (literal !== null) return literal;

  const flexible = narrow(source, findAll(source, flexiblePattern(text)), headingLevel);
  if (flexible !== null) return flexible;

  return narrow(source, shadowSpans(shadow, text), headingLevel);
}

/** The source spans where `text` occurs in the shadow, in order, each mapped back to source offsets. */
function shadowSpans(shadow: StrippedShadow, text: string): SourceSpan[] {
  return findAll(shadow.text, renderedPattern(text))
    .filter((span) => span.end > span.start)
    .map((span) => {
      const start = shadow.map[span.start];
      const last = shadow.map[span.end - 1];
      return start === undefined || last === undefined ? null : { start, end: last + 1 };
    })
    .filter((span): span is SourceSpan => span !== null);
}

/**
 * How many occurrences of `selected` start before `offset` in `rendered`, the
 * rendered text (text nodes concatenated) the selection was made in. Pairs
 * with `locateSelection`'s `occurrence` to pick the same occurrence in the
 * source.
 */
export function occurrenceIndex(rendered: string, selected: string, offset: number): number {
  const text = selected.trim();
  if (text === "") return 0;
  return findAll(rendered, renderedPattern(text)).filter((span) => span.start < offset).length;
}

/**
 * `text` as a pattern tolerant of how a renderer treats whitespace: a run
 * holding a line break may render as anything from nothing (a soft break) to
 * a block boundary, any other run as any run of whitespace.
 */
export function renderedPattern(text: string): RegExp {
  const parts = text.split(/(\s+)/).map((token) => {
    if (token === "") return "";
    if (!/^\s+$/.test(token)) return escapeLiteral(token);
    return token.includes("\n") ? "\\s*" : "\\s+";
  });
  return new RegExp(parts.join(""), "g");
}

/** The one span, or the one span on a matching heading line, else `null`. */
function narrow(source: string, spans: Span[], headingLevel: number | null): SourceSpan | null {
  const [only] = spans;
  if (spans.length === 1 && only) return { start: only.start, end: only.end };
  if (spans.length > 1 && headingLevel !== null) {
    const onHeading = spans.filter((span) => lineHasHeading(source, span.start, headingLevel));
    const [headingOnly] = onHeading;
    if (onHeading.length === 1 && headingOnly) return { start: headingOnly.start, end: headingOnly.end };
  }
  return null;
}

/** Whether the line holding `offset` opens with exactly `level` `#` marks and a space. */
function lineHasHeading(source: string, offset: number, level: number): boolean {
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
  const line = source.slice(lineStart, lineStart + level + 2);
  return line.startsWith(`${"#".repeat(level)} `);
}

export interface StrippedShadow {
  /** The source with markdown markers removed, approximating the rendered text. */
  text: string;
  /** For each shadow character, the source offset it came from. */
  map: number[];
}

/**
 * The source with heading/quote/list markers, emphasis and highlight marks,
 * code-span backticks and link syntax removed, each surviving character
 * remembering its source offset. `_` survives (an italic `_x_` simply falls
 * through unresolved) because underscores inside identifiers are real text.
 */
export function strippedShadow(source: string): StrippedShadow {
  const out: string[] = [];
  const map: number[] = [];
  let i = 0;
  let atLineStart = true;
  let inCode = false;

  const emit = (index: number): void => {
    out.push(source[index] ?? "");
    map.push(index);
  };

  while (i < source.length) {
    const char = source[i] ?? "";

    if (atLineStart && !inCode) {
      const marker = /^(?: {0,3}#{1,6} | {0,3}> ?|\s*[-*+] |\s*\d+\. )/.exec(source.slice(i, i + 12));
      if (marker && marker[0] !== "") {
        i += marker[0].length;
        atLineStart = false;
        continue;
      }
      atLineStart = false;
    }

    if (char === "\n") {
      emit(i);
      i += 1;
      atLineStart = true;
      continue;
    }

    if (char === "`") {
      inCode = !inCode;
      i += 1;
      continue;
    }
    if (inCode) {
      emit(i);
      i += 1;
      continue;
    }

    if (source.startsWith("![", i)) {
      const skipped = skipLink(source, i + 1);
      if (skipped !== null) {
        i = skipped.after;
        continue;
      }
    }

    if (source.startsWith("[[", i)) {
      const close = source.indexOf("]]", i + 2);
      if (close !== -1) {
        const inner = source.slice(i + 2, close);
        const pipe = inner.indexOf("|");
        const labelStart = i + 2 + (pipe === -1 ? 0 : pipe + 1);
        for (let k = labelStart; k < close; k += 1) emit(k);
        i = close + 2;
        continue;
      }
    }

    if (char === "[") {
      const link = skipLink(source, i);
      if (link !== null) {
        for (let k = link.labelStart; k < link.labelEnd; k += 1) emit(k);
        i = link.after;
        continue;
      }
    }

    if (char === "*" || source.startsWith("==", i) || source.startsWith("~~", i)) {
      i += char === "*" ? 1 : 2;
      continue;
    }

    emit(i);
    i += 1;
  }

  return { text: out.join(""), map };
}

interface LinkShape {
  labelStart: number;
  labelEnd: number;
  after: number;
}

/** The shape of a `[label](target)` starting at `open` (which must point at `[`), or `null` if it is not one. */
function skipLink(source: string, open: number): LinkShape | null {
  if (source[open] !== "[") return null;
  const close = source.indexOf("]", open + 1);
  if (close === -1 || source[close + 1] !== "(") return null;
  const end = source.indexOf(")", close + 2);
  if (end === -1) return null;
  return { labelStart: open + 1, labelEnd: close, after: end + 1 };
}
