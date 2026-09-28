/**
 * Editing-mode decorations for the active file's OPEN, unarchived notes: a
 * `Decoration.mark` with class `agent-thread-mark` over each note's anchor,
 * wherever it still resolves in the current doc text. A note whose anchor
 * no longer matches gets no decoration. Clicking inside a decorated span opens
 * the notes panel and the note's thread popover. Decorations reload on file switch,
 * whenever this plugin writes the tracked file's thread file (`plugin.onSidecarWritten`,
 * because the vault's own "modify" event never fires for `.agent-threads/*`), and
 * whenever the tracked file's sidecar (at any home) changes on
 * disk some other way. The reload race itself is guarded and tested in
 * decoration-reloader.ts.
 */

import type { Extension } from "@codemirror/state";
import { ViewPlugin } from "@codemirror/view";
import type { DecorationSet, EditorView, ViewUpdate } from "@codemirror/view";
import { editorInfoField, TFile } from "obsidian";
import type { EventRef } from "obsidian";

import { DecorationReloader } from "./decoration-reloader";
import type AgentThreadsPlugin from "./main";
import { isSidecarFor } from "./vault-notes";

/** A CM6 `Extension`, handed to `registerEditorExtension` as-is. */
export function createNoteDecorationsExtension(plugin: AgentThreadsPlugin): Extension {
  class NoteDecorations {
    private readonly reloader = new DecorationReloader((path) => plugin.loadNotesFor(path));
    private readonly modifyRef: EventRef | null;
    private readonly unsubscribeSidecarWritten: () => void;

    get decorations(): DecorationSet {
      return this.reloader.decorations;
    }

    constructor(private readonly view: EditorView) {
      const info = view.state.field(editorInfoField, false);
      this.reloader.trackedPath = info?.file?.path ?? null;
      const app = info?.app ?? null;
      this.modifyRef =
        app === null
          ? null
          : app.vault.on("modify", (file) => {
              const path = this.reloader.trackedPath;
              if (path !== null && file instanceof TFile && isSidecarFor(path, file.path)) void this.reload();
            });
      this.unsubscribeSidecarWritten = plugin.onSidecarWritten((path) => {
        if (path === this.reloader.trackedPath) void this.reload();
      });
      void this.reload();
    }

    update(update: ViewUpdate): void {
      const currentPath = update.state.field(editorInfoField, false)?.file?.path ?? null;
      if (currentPath !== this.reloader.trackedPath) {
        this.reloader.trackedPath = currentPath;
        void this.reload();
        return;
      }
      if (update.docChanged) this.reloader.decorations = this.reloader.decorations.map(update.changes);
    }

    destroy(): void {
      this.reloader.destroy();
      const app = this.view.state.field(editorInfoField, false)?.app ?? null;
      if (this.modifyRef !== null && app !== null) app.vault.offref(this.modifyRef);
      this.unsubscribeSidecarWritten();
    }

    private async reload(): Promise<void> {
      const updated = await this.reloader.reload(() => this.view.state.doc.toString());
      if (updated) this.view.dispatch({});
    }
  }

  return ViewPlugin.fromClass(NoteDecorations, {
    decorations: (value) => value.decorations,
    eventHandlers: {
      click(event, view) {
        const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(".agent-thread-mark") : null;
        const noteId = target?.dataset.agentThreadId;
        if (noteId === undefined) return false;
        const path = view.state.field(editorInfoField, false)?.file?.path;
        if (path === undefined) return false;
        void plugin.revealNotesView();
        plugin.openThread(path, noteId, { top: event.clientY, left: event.clientX });
        return false;
      },
    },
  });
}
