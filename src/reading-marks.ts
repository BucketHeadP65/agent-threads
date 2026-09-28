/**
 * Reading-view note marks. Reading view renders markdown to HTML section by
 * section, so the editor's CM6 decorations never apply there. Each rendered
 * section is stamped with the source lines it came from, every open note is
 * resolved once against the whole source (exactly as the editor does), and
 * the part of its span inside a section is wrapped in the same
 * `.agent-thread-mark` span the editor draws, opening the notes panel and the
 * note's thread popover on click. Resolving in the source keeps a note on the
 * one place it was taken, however often its text repeats in the file.
 *
 * A post processor only runs when a section renders, and a sidecar write
 * renders nothing. `refreshReadingMarks` covers that by patching the stamped
 * sections in place: on load (a pane already open), on `file-open` (a pane
 * switched back into), and on every thread file write. It never goes through a preview
 * rerender, which would disturb the scroll position. The one exception is a
 * pane whose rendered sections carry no stamps (rendered before this code
 * ran): it is rerendered once, so its sections come back stamped and marked.
 */

import type { MarkdownPostProcessor } from "obsidian";

import { sectionMarkRanges } from "./section-marks";
import { stampSection, stampedSections } from "./section-stamps";
import type { StampedSection } from "./section-stamps";
import type { NoteSheet } from "./sidecar";

/** The reading-view pane `refreshReadingMarks` acts on, narrow enough for a hand-written fake in tests. */
export interface ReadingPane {
  getMode(): "source" | "preview";
  file: { path: string } | null;
  /** The file's current text, which the sections' stamped line ranges index into. */
  data: string;
  previewMode: { containerEl: HTMLElement; rerender(full?: boolean): void };
}

/** The slice of the plugin this module needs, narrow enough for a hand-written fake in tests. */
export interface ReadingMarksPlugin {
  loadNotesFor(path: string): Promise<NoteSheet>;
  revealNotesView(): Promise<void>;
  registerMarkdownPostProcessor(postProcessor: MarkdownPostProcessor): void;
  /** Every markdown view's reading surface, focused or not. A thread file write must refresh panes the writer never focused. */
  readingPanes(): ReadingPane[];
  /** Opens the floating thread popover for `noteId` of `path` at a viewport position. */
  openThread(path: string, noteId: string, at: { top: number; left: number }): void;
}

type MarkClick = (noteId: string, event: MouseEvent) => void;

export function registerReadingMarks(plugin: ReadingMarksPlugin): void {
  plugin.registerMarkdownPostProcessor(async (element, context) => {
    const info = context.getSectionInfo(element);
    if (info === null) return;
    stampSection(element, info.lineStart, info.lineEnd);
    const sheet = await plugin.loadNotesFor(context.sourcePath);
    if (sheet.notes.length === 0) return;
    markSections([{ element, lineStart: info.lineStart, lineEnd: info.lineEnd }], sheet, info.text, markClick(plugin, context.sourcePath));
  });
}

/**
 * Refreshes the note marks of every reading view showing `path`, so a
 * sidecar written elsewhere (the panel, an external writer) shows up without
 * a manual reload: old spans unwrapped, fresh ones wrapped onto the stamped
 * sections. Sections Obsidian has not rendered yet are covered by the
 * registered post processor when they render.
 */
export function refreshReadingMarks(plugin: ReadingMarksPlugin, path: string): void {
  for (const pane of plugin.readingPanes()) {
    if (pane.getMode() !== "preview" || pane.file?.path !== path) continue;
    void plugin.loadNotesFor(path).then((sheet) => {
      const root = pane.previewMode.containerEl;
      unwrapMarks(root);
      if (sheet.notes.length === 0) return;
      const sections = stampedSections(root);
      if (sections.length === 0) {
        if ((root.textContent ?? "").trim() !== "") pane.previewMode.rerender(true);
        return;
      }
      markSections(sections, sheet, pane.data, markClick(plugin, path));
    });
  }
}

function markClick(plugin: ReadingMarksPlugin, path: string): MarkClick {
  return (noteId, event) => {
    void plugin.revealNotesView();
    plugin.openThread(path, noteId, { top: event.clientY, left: event.clientX });
  };
}

/** Removes every existing mark span under `root`, merging the text back so fresh ranges match contiguous nodes. */
function unwrapMarks(root: HTMLElement): void {
  for (const mark of Array.from(root.querySelectorAll("span.agent-thread-mark"))) {
    const parent = mark.parentNode;
    if (parent === null) continue;
    while (mark.firstChild !== null) parent.insertBefore(mark.firstChild, mark);
    mark.remove();
  }
  root.normalize();
}

/** Wraps, in each section, the rendered part of every open note whose anchor resolves in `source`. */
function markSections(sections: readonly StampedSection[], sheet: NoteSheet, source: string, onClick: MarkClick): void {
  const rendered = sections.map((section) => ({
    lineStart: section.lineStart,
    lineEnd: section.lineEnd,
    text: collectTextNodes(section.element)
      .map((node) => node.data)
      .join(""),
  }));
  const ranges = sectionMarkRanges(sheet, source, rendered);
  // Later ranges first, so wrapping one never shifts the offsets of the next. Text
  // nodes are re-collected before every wrap: wrapping a range splits its enclosing
  // node into new siblings that a node list captured before that wrap knows nothing
  // about, so reusing one stale list across two overlapping ranges would misalign the
  // second wrap's offsets against nodes that no longer hold the text it expects.
  // Wrapping never changes a section's total text or node order, so every range's
  // offset stays valid.
  for (const range of [...ranges].sort((a, b) => b.from - a.from)) {
    const section = sections[range.section];
    if (section !== undefined) wrapRange(collectTextNodes(section.element), range.from, range.to, range.noteId, onClick);
  }
}

/** True when `node` is a text node, checked by node type so it holds across windows. */
function isText(node: Node): node is Text {
  return node.nodeType === Node.TEXT_NODE;
}

function collectTextNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (isText(node)) nodes.push(node);
  }
  return nodes;
}

/** Wraps the characters `from`..`to` of the concatenated text nodes, splitting nodes at the edges. */
function wrapRange(textNodes: readonly Text[], from: number, to: number, noteId: string, onClick: MarkClick): void {
  let offset = 0;
  for (const node of textNodes) {
    const start = offset;
    const end = offset + node.data.length;
    offset = end;
    if (end <= from || start >= to) continue;
    const localFrom = Math.max(from, start) - start;
    const localTo = Math.min(to, end) - start;
    let target = node;
    if (localFrom > 0) target = target.splitText(localFrom);
    if (localTo - localFrom < target.data.length) target.splitText(localTo - localFrom);
    const mark = createSpan({ cls: "agent-thread-mark" });
    mark.dataset.agentThreadId = noteId;
    mark.onclick = (event) => onClick(noteId, event);
    target.replaceWith(mark);
    mark.appendChild(target);
  }
}
