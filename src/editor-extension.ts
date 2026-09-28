/**
 * The Live Preview / source-mode selection affordance: a CodeMirror 6
 * `ViewPlugin` that, whenever the focused editor has a non-empty selection,
 * asks the plugin to show the floating "Add note" button near its end.
 *
 * Coordinates are read in a measure phase (`requestMeasure`), never inside
 * the update cycle itself, where CM6's layout is not yet settled and
 * `coordsAtPos` answers `null` or stale positions. A selection ending at a
 * line start (a triple click selects the trailing newline) is positioned at
 * the visual end of the selected line, not the start of the next.
 */

import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";

import type AgentThreadsPlugin from "./main";

/** A CM6 `Extension`, handed to `registerEditorExtension` as-is. */
export function createAddNoteExtension(plugin: AgentThreadsPlugin) {
  return ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        this.measure(view);
      }

      update(update: ViewUpdate): void {
        if (!update.selectionSet && !update.focusChanged && !update.docChanged && !update.viewportChanged) return;
        this.measure(update.view);
      }

      /** Defers the show/hide decision to CM6's measure phase, where reading coordinates is reliable. */
      private measure(view: EditorView): void {
        view.requestMeasure({
          read: (measuredView) => {
            if (!measuredView.hasFocus) {
              plugin.hideNoteAffordance();
              return;
            }
            const range = measuredView.state.selection.main;
            if (range.empty) {
              plugin.hideNoteAffordance();
              return;
            }
            // Side -1 anchors a line-start end position to the end of the line before
            // it, so a triple click's button sits by the selected line.
            const coords = measuredView.coordsAtPos(range.to, -1) ?? measuredView.coordsAtPos(range.from, 1);
            if (coords === null) {
              plugin.hideNoteAffordance();
              return;
            }
            plugin.showNoteAffordance({
              top: coords.bottom,
              left: coords.left,
              from: range.from,
              to: range.to,
              source: measuredView.state.doc.toString(),
            });
          },
        });
      }

      destroy(): void {
        plugin.hideNoteAffordance();
      }
    },
  );
}
