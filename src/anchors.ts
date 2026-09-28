/**
 * Text-quote anchors on source markdown. `anchorFor` builds the anchor a new
 * note stores. `resolveAnchor` re-locates it the same way the agent skill's
 * `notes.py` does. An exact match wins first. A repeated `exact` narrows by
 * prefix and suffix, then to the one heading occurrence when the note was
 * taken on a heading, then by prefix alone or suffix alone. A
 * whitespace-normalized pass repeats the same ladder. `null` means orphaned.
 */

export interface NoteAnchor {
  exact: string;
  prefix: string;
  suffix: string;
}

export interface AnchorHit {
  offset: number;
  line: number;
}

export interface Span {
  start: number;
  end: number;
}

const ANCHOR_CONTEXT_CHARS = 32;

/** `exact` is `source.slice(start, end)`. `prefix`/`suffix` are up to 32 source chars around it. */
export function anchorFor(source: string, start: number, end: number): NoteAnchor {
  return {
    exact: source.slice(start, end),
    prefix: source.slice(Math.max(0, start - ANCHOR_CONTEXT_CHARS), start),
    suffix: source.slice(end, end + ANCHOR_CONTEXT_CHARS),
  };
}

/** Re-locates `anchor` in `text`. `null` if it no longer resolves to exactly one span. */
export function resolveAnchor(text: string, anchor: NoteAnchor): AnchorHit | null {
  const exact = anchor.exact;
  if (exact === "") return null;
  const literal = singleHit(text, findAll(text, literalPattern(exact)), anchor);
  if (literal !== null) return literal;
  return singleHit(text, findAll(text, flexiblePattern(exact)), anchor);
}

function hitAt(text: string, offset: number): AnchorHit {
  const before = text.slice(0, offset);
  const newlines = before.match(/\n/g);
  return { offset, line: (newlines?.length ?? 0) + 1 };
}

/**
 * The one span `matches` narrows to: unique outright, unique after prefix and
 * suffix, the one heading occurrence when the anchor was taken on a heading,
 * or unique by prefix alone or by suffix alone. Else `null`.
 */
function singleHit(text: string, matches: Span[], anchor: NoteAnchor): AnchorHit | null {
  const [only] = matches;
  if (matches.length === 1 && only) return hitAt(text, only.start);
  if (matches.length > 1) {
    const pools = [
      matches.filter((span) => prefixMatches(text, span, anchor.prefix) && suffixMatches(text, span, anchor.suffix)),
      anchorOnHeading(anchor) ? matches.filter((span) => startsHeadingLine(text, span)) : [],
      anchor.prefix === "" ? [] : matches.filter((span) => prefixMatches(text, span, anchor.prefix)),
      anchor.suffix === "" ? [] : matches.filter((span) => suffixMatches(text, span, anchor.suffix)),
    ];
    for (const pool of pools) {
      const [poolOnly] = pool;
      if (pool.length === 1 && poolOnly) return hitAt(text, poolOnly.start);
    }
  }
  return null;
}

function prefixMatches(text: string, span: Span, prefix: string): boolean {
  return prefix === "" || text.slice(Math.max(0, span.start - prefix.length), span.start).endsWith(prefix);
}

function suffixMatches(text: string, span: Span, suffix: string): boolean {
  return suffix === "" || text.slice(span.end, span.end + suffix.length).startsWith(suffix);
}

const HEADING_TAIL = /(?:^|\n)#{1,6} $/;
const HEADING_LINE = /^#{1,6} $/;

/** True when the anchor's own prefix shows the note was taken on a heading's text. */
function anchorOnHeading(anchor: NoteAnchor): boolean {
  return HEADING_TAIL.test(anchor.prefix);
}

/** True when `span` sits right after a heading marker at the start of its line. */
function startsHeadingLine(text: string, span: Span): boolean {
  const lineStart = text.lastIndexOf("\n", span.start - 1) + 1;
  return HEADING_LINE.test(text.slice(lineStart, span.start));
}

/** `literal` with every regex metacharacter escaped, so it matches itself. */
export function escapeLiteral(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `exact` as a global regex matching itself literally. */
export function literalPattern(exact: string): RegExp {
  return new RegExp(escapeLiteral(exact), "g");
}

/** `exact` as a pattern where any run of whitespace matches any run of whitespace in the target. */
export function flexiblePattern(exact: string): RegExp {
  const tokens = exact.split(/(\s+)/);
  const source = tokens.map((token) => (token !== "" && /^\s+$/.test(token) ? "\\s+" : escapeLiteral(token))).join("");
  return new RegExp(source, "g");
}

/** Every non-overlapping match of `pattern` in `text`, as spans. */
export function findAll(text: string, pattern: RegExp): Span[] {
  const spans: Span[] = [];
  let match = pattern.exec(text);
  while (match !== null) {
    spans.push({ start: match.index, end: match.index + match[0].length });
    pattern.lastIndex = match[0].length === 0 ? match.index + 1 : pattern.lastIndex;
    match = pattern.exec(text);
  }
  return spans;
}
