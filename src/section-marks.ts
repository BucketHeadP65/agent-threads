/**
 * Maps each open note's anchor onto the rendered text of the reading-view
 * sections that show it. A note is anchored in raw source. Reading view
 * renders that source block by block with the markdown markers gone, so a
 * mark in reading view needs the note's source span first (resolved once,
 * against the whole file, exactly as the editor does) and then the rendered
 * characters that span became inside each section it touches. Resolving in
 * the source is what keeps a note on the one place it was taken, however
 * often its text repeats elsewhere in the file.
 */

import { findAll, resolveAnchor } from "./anchors";
import { renderedPattern, strippedShadow } from "./locate-selection";
import type { SourceSpan, StrippedShadow } from "./locate-selection";
import type { NoteSheet } from "./sidecar";

/** One rendered section of a reading view: the source lines it renders and its rendered text (its text nodes concatenated). */
export interface RenderedSection {
  /** First source line of the section, 0-based. */
  lineStart: number;
  /** Last source line of the section, 0-based, inclusive. */
  lineEnd: number;
  text: string;
}

export interface SectionMarkRange {
  /** Index into the `sections` the range was computed for. */
  section: number;
  /** Character offsets into that section's rendered text. */
  from: number;
  to: number;
  noteId: string;
}

/** The source span covering lines `lineStart` to `lineEnd` inclusive, without the newline that ends the last one. */
export function lineSpan(source: string, lineStart: number, lineEnd: number): SourceSpan {
  let start = 0;
  for (let line = 0; line < lineStart; line += 1) {
    const next = source.indexOf("\n", start);
    if (next === -1) return { start: source.length, end: source.length };
    start = next + 1;
  }
  let end = start;
  for (let line = lineStart; line <= lineEnd; line += 1) {
    const next = source.indexOf("\n", end);
    if (next === -1) {
      end = source.length;
      break;
    }
    end = line === lineEnd ? next : next + 1;
  }
  return { start, end };
}

/** Rendered ranges to mark, per section, for every OPEN, unarchived note in `sheet` whose anchor resolves to one place in `source`. */
export function sectionMarkRanges(sheet: NoteSheet, source: string, sections: readonly RenderedSection[]): SectionMarkRange[] {
  const shadow = strippedShadow(source);
  const spans = sections.map((section) => lineSpan(source, section.lineStart, section.lineEnd));
  const ranges: SectionMarkRange[] = [];
  for (const note of sheet.notes) {
    if (note.status !== "open" || note.archived) continue;
    const hit = resolveAnchor(source, note.anchor);
    if (hit === null) continue;
    const noteSpan = { start: hit.offset, end: hit.offset + note.anchor.exact.length };
    sections.forEach((section, index) => {
      const sectionSpan = spans[index];
      if (sectionSpan === undefined) return;
      const range = renderedRange(shadow, noteSpan, sectionSpan, section.text);
      if (range !== null) ranges.push({ section: index, from: range.start, to: range.end, noteId: note.id });
    });
  }
  return ranges;
}

/**
 * Where the part of `noteSpan` inside `sectionSpan` sits in `rendered`, or
 * `null` when the note misses the section or its text cannot be found there.
 * The note's slice of the section's marker-stripped shadow is the rendered
 * text to look for. When that text repeats inside the section, the occurrence
 * is chosen by its position in the shadow.
 */
function renderedRange(shadow: StrippedShadow, noteSpan: SourceSpan, sectionSpan: SourceSpan, rendered: string): SourceSpan | null {
  const start = Math.max(noteSpan.start, sectionSpan.start);
  const end = Math.min(noteSpan.end, sectionSpan.end);
  if (end <= start) return null;

  const chars: string[] = [];
  let from = -1;
  let to = -1;
  for (let i = 0; i < shadow.map.length; i += 1) {
    const offset = shadow.map[i] ?? -1;
    if (offset < sectionSpan.start || offset >= sectionSpan.end) continue;
    if (from === -1 && offset >= start) from = chars.length;
    if (to === -1 && offset >= end) to = chars.length;
    chars.push(shadow.text[i] ?? "");
  }
  const sectionText = chars.join("");
  if (from === -1) return null;
  if (to === -1) to = sectionText.length;
  while (from < to && /\s/.test(sectionText[from] ?? "")) from += 1;
  while (to > from && /\s/.test(sectionText[to - 1] ?? "")) to -= 1;
  if (from >= to) return null;

  const pattern = renderedPattern(sectionText.slice(from, to));
  const occurrence = findAll(sectionText, pattern).filter((span) => span.start < from).length;
  const candidates = findAll(rendered, pattern);
  const chosen = candidates[occurrence] ?? (candidates.length === 1 ? candidates[0] : undefined);
  return chosen === undefined ? null : { start: chosen.start, end: chosen.end };
}
