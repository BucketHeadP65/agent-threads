/**
 * Which spans of the current doc text should carry an editing-mode note
 * decoration, factored out as a pure computation so it can be unit-tested
 * without a full Obsidian/CM6 app. Each OPEN, unarchived note in a sheet
 * whose anchor still resolves in the doc text gets a range. A note whose
 * anchor no longer matches gets none.
 */

import { resolveAnchor } from "./anchors";
import type { NoteSheet } from "./sidecar";

export interface NoteDecorationRange {
  from: number;
  to: number;
  /** The note whose anchor this span marks, so a click can open its thread. */
  noteId: string;
}

/** Ranges to mark for each OPEN, unarchived note in `sheet` whose anchor still resolves in `docText`. */
export function noteDecorationRanges(sheet: NoteSheet, docText: string): NoteDecorationRange[] {
  const ranges: NoteDecorationRange[] = [];
  for (const note of sheet.notes) {
    if (note.status !== "open" || note.archived) continue;
    const hit = resolveAnchor(docText, note.anchor);
    if (hit === null) continue;
    ranges.push({ from: hit.offset, to: hit.offset + note.anchor.exact.length, noteId: note.id });
  }
  return ranges;
}
