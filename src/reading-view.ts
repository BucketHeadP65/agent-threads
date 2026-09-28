/**
 * The reading-view selection affordance. Reading view renders markdown to
 * HTML, so the selected text is the RENDERED text. `locateSelection` maps it
 * back to the one raw-source span it came from (through formatting marks,
 * heading/list/quote markers and link syntax), refusing only when no single
 * span can be pinned. The search is confined to the source lines of the
 * rendered sections under the selection (stamped by reading-marks.ts), and
 * within them to the occurrence the reader actually selected, so text that
 * repeats elsewhere in the file, or even inside the same section, still pins
 * to the place selected. A selection inside a rendered heading narrows a
 * repeated text to the heading's own line.
 *
 * Ownership: this listener only ever acts while the active markdown view is
 * in preview mode. Editing mode (Live Preview or source) belongs to the CM6
 * extension in editor-extension.ts. Outside preview mode this listener is
 * inert (no show, no hide), so the two never race to decide the button's
 * state.
 */

import { MarkdownView } from "obsidian";

import { affordanceAction, type SelectionState } from "./affordance-action";
import { locateSelection, occurrenceIndex } from "./locate-selection";
import type AgentThreadsPlugin from "./main";
import { lineSpan } from "./section-marks";
import { selectionPlacement } from "./section-stamps";

export function registerReadingViewSelection(plugin: AgentThreadsPlugin): void {
  plugin.registerDomEvent(document, "selectionchange", () => {
    const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    const mode = view?.getMode() ?? null;
    const selection = document.getSelection();
    const state: SelectionState | null = selection === null ? null : { text: selection.toString(), isCollapsed: selection.isCollapsed };

    const action = affordanceAction(mode, state);
    if (action === "ignore") return;
    if (action === "hide") {
      plugin.hideNoteAffordance();
      return;
    }
    if (view === null || selection === null) return;

    const source = view.editor.getValue();
    const selected = selection.toString();
    const range = selection.getRangeAt(0);
    const placement = selectionPlacement(range);
    const within = placement === null ? null : lineSpan(source, placement.lineStart, placement.lineEnd);
    const occurrence = placement === null ? null : occurrenceIndex(placement.renderedText, selected, placement.renderedOffset);
    const span = locateSelection(source, selected, headingLevelOf(selection), within, occurrence);
    if (span === null) {
      plugin.hideNoteAffordance();
      return;
    }
    const rect = range.getBoundingClientRect();
    plugin.showNoteAffordance({
      top: rect.bottom,
      left: rect.left,
      from: span.start,
      to: span.end,
      source,
    });
  });
}

/** The rendered heading level the selection starts inside (1 to 6), or `null` outside a heading. */
function headingLevelOf(selection: Selection): number | null {
  const node = selection.anchorNode;
  const element = node instanceof Element ? node : (node?.parentElement ?? null);
  const heading = element?.closest("h1, h2, h3, h4, h5, h6") ?? null;
  if (heading === null) return null;
  const level = Number(heading.tagName.slice(1));
  return Number.isInteger(level) && level >= 1 && level <= 6 ? level : null;
}
