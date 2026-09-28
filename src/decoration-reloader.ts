/**
 * The async reload sequencing for note decorations, factored out so the race
 * it guards against can be unit-tested without a full Obsidian/CM6 app: once
 * a load for a path resolves, the result commits to `decorations` only if
 * that path still matches `trackedPath` at that moment. A stale in-flight
 * reload for an old path is dropped rather than overwriting a newer one.
 */

import { Decoration } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";

import { noteDecorationRanges } from "./note-decoration-ranges";
import type { NoteDecorationRange } from "./note-decoration-ranges";
import { emptySheet, type NoteSheet } from "./sidecar";

function toDecorations(ranges: NoteDecorationRange[]): DecorationSet {
  return Decoration.set(
    ranges.map((range) =>
      Decoration.mark({ class: "agent-thread-mark", attributes: { "data-agent-thread-id": range.noteId } }).range(range.from, range.to),
    ),
    true,
  );
}

export class DecorationReloader {
  decorations: DecorationSet = Decoration.none;
  trackedPath: string | null = null;
  private destroyed = false;

  constructor(private readonly loadSheet: (path: string) => Promise<NoteSheet>) {}

  destroy(): void {
    this.destroyed = true;
  }

  /** Reloads `decorations` for the currently tracked path against `getDocText()`. Returns whether it actually committed. */
  async reload(getDocText: () => string): Promise<boolean> {
    const path = this.trackedPath;
    const sheet = path === null ? emptySheet() : await this.loadSheet(path);
    if (this.destroyed || path !== this.trackedPath) return false;
    this.decorations = toDecorations(noteDecorationRanges(sheet, getDocText()));
    return true;
  }
}
