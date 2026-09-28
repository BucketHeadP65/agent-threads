/**
 * The right-leaf side panel: the active file's threads, open first, resolved
 * collapsed and dimmed. Reacts to the active file changing and to its
 * thread file being written, by this plugin's own composer and panel actions
 * or by an external writer (a coding agent replying) through the plugin's
 * poll-backed `onSidecarWritten` (the vault's own "modify" event never fires
 * under `.agent-threads/`).
 */

import { ItemView, MarkdownView, Notice, setIcon, TFile, WorkspaceLeaf } from "obsidian";

import { resolveAnchor } from "./anchors";
import type { Note, NoteSheet } from "./sidecar";
import type AgentThreadsPlugin from "./main";

export const VIEW_TYPE_AGENT_THREADS = "agent-threads-view";

export class NotesView extends ItemView {
  private file: TFile | null = null;
  private sheet: NoteSheet = { version: 1, notes: [] };
  private expandedResolved = new Set<string>();
  private confirmingDeleteId: string | null = null;
  private editingTarget: { noteId: string; replyIndex: number | null } | null = null;
  private unsubscribeSidecarWritten: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: AgentThreadsPlugin) {
    super(leaf);
  }

  override getViewType(): string {
    return VIEW_TYPE_AGENT_THREADS;
  }

  override getDisplayText(): string {
    return "Note threads";
  }

  override getIcon(): string {
    return "message-square";
  }

  override async onOpen(): Promise<void> {
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => void this.onActiveFileChanged()));
    this.registerEvent(this.app.workspace.on("file-open", () => void this.onActiveFileChanged()));
    this.unsubscribeSidecarWritten = this.plugin.onSidecarWritten((path) => {
      if (path === this.file?.path) void this.refresh();
    });
    await this.onActiveFileChanged();
  }

  override async onClose(): Promise<void> {
    this.unsubscribeSidecarWritten?.();
    this.unsubscribeSidecarWritten = null;
  }

  /** The active file's path, or `null` when it isn't a markdown file the panel tracks. */
  activeFilePath(): string | null {
    return this.file?.path ?? null;
  }

  /** Re-reads the thread file and re-renders. Called on activation and on an external change to it. */
  async refresh(): Promise<void> {
    this.sheet = this.file ? await this.plugin.loadNotesFor(this.file.path) : { version: 1, notes: [] };
    this.render();
  }

  /**
   * Retargets the panel when a DIFFERENT markdown file becomes active. Focus
   * moving into this panel (or any non-file leaf) keeps the current file, and
   * an unchanged file skips the re-render so a half-typed reply survives.
   */
  private async onActiveFileChanged(): Promise<void> {
    const active = this.app.workspace.getActiveFile();
    const next = active && active.extension === "md" ? active : null;
    if (next === null) {
      if (this.file === null) await this.refresh();
      return;
    }
    if (next.path === this.file?.path) return;
    this.file = next;
    await this.refresh();
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("agent-threads-view");

    if (!this.file) {
      container.createEl("p", { cls: "agent-threads-empty", text: "Open a Markdown file to see its notes." });
      return;
    }

    const notes = this.sheet.notes.filter((note) => !note.archived);
    if (notes.length === 0) {
      container.createEl("p", { cls: "agent-threads-empty", text: "No notes on this file yet." });
      return;
    }

    const open = notes.filter((note) => note.status === "open");
    const resolved = notes.filter((note) => note.status === "resolved");

    for (const note of open) this.renderThread(container, note, false);
    if (resolved.length > 0) {
      const heading = container.createEl("p", { cls: "agent-threads-resolved-heading", text: `Resolved (${resolved.length})` });
      heading.setAttr("role", "heading");
      for (const note of resolved) this.renderThread(container, note, true);
    }
  }

  private renderThread(container: HTMLElement, note: Note, resolved: boolean): void {
    const file = this.file;
    if (!file) return;
    const collapsed = resolved && !this.expandedResolved.has(note.id);
    const thread = container.createDiv({ cls: `agent-thread-thread${resolved ? " is-resolved" : ""}` });

    const source = this.currentSourceOf(file);
    const hit = source === null ? null : resolveAnchor(source, note.anchor);
    const orphaned = source !== null && hit === null;

    const header = thread.createDiv({ cls: "agent-thread-header" });
    if (orphaned) header.createSpan({ cls: "agent-thread-badge is-warn", text: "Anchor lost" });
    if (resolved) header.createSpan({ cls: "agent-thread-badge is-ok", text: "Resolved" });

    const quote = thread.createEl("blockquote", { cls: "agent-thread-quote", text: note.anchor.exact });
    quote.setAttr("role", "button");
    quote.setAttr("tabindex", "0");
    // The whole card jumps to the note's place in the text. Its own controls stay controls.
    thread.onclick = (event) => {
      if (event.target instanceof HTMLElement && event.target.closest("textarea, button, input")) return;
      void this.jumpTo(file, note);
    };

    if (resolved && collapsed) {
      thread.createEl("p", { cls: "agent-thread-text agent-thread-collapsed-text", text: note.text });
      const expand = thread.createEl("button", { cls: "agent-thread-link-button", text: "Show thread" });
      expand.onclick = () => {
        this.expandedResolved.add(note.id);
        this.render();
      };
      return;
    }

    // Every message in a thread says who wrote it: the opening note is always the
    // owner's, each reply carries its own author. Owner messages carry their own
    // pencil, and the one being edited renders as an editor in place.
    this.renderMessage(thread, file, note, null, "owner", note.text);

    if (note.replies.length > 0) {
      const replies = thread.createDiv({ cls: "agent-thread-replies" });
      note.replies.forEach((reply, index) => this.renderMessage(replies, file, note, index, reply.author, reply.text));
    }

    const composer = thread.createEl("textarea", { cls: "agent-thread-reply-input", attr: { placeholder: "Reply", rows: "2" } });

    const actions = thread.createDiv({ cls: "agent-thread-actions" });
    const resolveButton = actions.createEl("button", { cls: "agent-thread-button", text: resolved ? "Reopen" : "Resolve" });
    resolveButton.onclick = () => void this.toggleStatus(file, note);

    if (this.confirmingDeleteId === note.id) {
      const confirm = actions.createEl("button", { cls: "agent-thread-button agent-thread-confirm-delete", text: "Delete?" });
      confirm.onclick = () => void this.deleteNote(file, note);
      const cancel = actions.createEl("button", { cls: "agent-thread-button", text: "Cancel" });
      cancel.onclick = () => {
        this.confirmingDeleteId = null;
        this.render();
      };
    } else {
      const trashButton = actions.createEl("button", { cls: "agent-thread-icon-button", attr: { "aria-label": "Delete note" } });
      setIcon(trashButton, "trash-2");
      trashButton.onclick = () => {
        this.confirmingDeleteId = note.id;
        this.render();
      };
    }

    const replyButton = actions.createEl("button", { cls: "agent-thread-button is-primary", text: "Reply" });
    replyButton.onclick = () => void this.submitReply(file, note, composer);
  }

  private currentSourceOf(file: TFile): string | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view && view.file?.path === file.path) return view.editor.getValue();
    return null;
  }

  private async jumpTo(file: TFile, note: Note): Promise<void> {
    // A click here makes THIS side leaf the active one, so asking for "the
    // active leaf" would open the file over the panel itself. The most recent
    // main-area leaf is where the owner reads.
    const leaf = this.app.workspace.getMostRecentLeaf() ?? this.app.workspace.getLeaf(true);
    await leaf.openFile(file);
    const view = leaf.view instanceof MarkdownView ? leaf.view : null;
    if (!view) return;
    const source = view.editor.getValue();
    const hit = resolveAnchor(source, note.anchor);
    if (hit === null) {
      new Notice("This note's anchor no longer resolves in the file.");
      return;
    }
    const pos = view.editor.offsetToPos(hit.offset);
    if (view.getMode() === "preview") {
      view.setEphemeralState({ line: pos.line });
      return;
    }
    view.editor.setCursor(pos);
    view.editor.scrollIntoView({ from: pos, to: pos }, true);
  }

  private async toggleStatus(file: TFile, note: Note): Promise<void> {
    try {
      await this.plugin.setNoteStatusFor(file.path, note.id, note.status === "resolved" ? "open" : "resolved");
    } catch (error) {
      new Notice(`Could not change the note's status: ${error instanceof Error ? error.message : String(error)}`);
    }
    await this.refresh();
  }

  /** One message row: author chip, a pencil on the owner's own messages, and an in-place editor for the one being edited. */
  private renderMessage(container: HTMLElement, file: TFile, note: Note, replyIndex: number | null, author: "owner" | "agent", text: string): void {
    const editingThis = this.editingTarget !== null && this.editingTarget.noteId === note.id && this.editingTarget.replyIndex === replyIndex;
    const row = container.createDiv({ cls: `agent-thread-reply is-${author}` });
    const head = row.createDiv({ cls: "agent-thread-message-head" });
    head.createSpan({ cls: "agent-thread-reply-author", text: author === "owner" ? "You" : "Agent" });
    if (author === "owner" && !editingThis) {
      const pencil = head.createEl("button", { cls: "agent-thread-icon-button", attr: { "aria-label": "Edit message" } });
      setIcon(pencil, "pencil");
      pencil.onclick = () => {
        this.editingTarget = { noteId: note.id, replyIndex };
        this.confirmingDeleteId = null;
        this.render();
      };
    }

    if (editingThis) {
      const editor = row.createEl("textarea", { cls: "agent-thread-reply-input", attr: { rows: "3" } });
      editor.value = text;
      const actions = row.createDiv({ cls: "agent-thread-actions" });
      const cancel = actions.createEl("button", { cls: "agent-thread-button", text: "Cancel" });
      cancel.onclick = () => {
        this.editingTarget = null;
        this.render();
      };
      const save = actions.createEl("button", { cls: "agent-thread-button is-primary", text: "Save" });
      save.onclick = () => void this.saveMessageEdit(file, note, replyIndex, editor);
      editor.focus();
      return;
    }

    row.createEl("p", { cls: "agent-thread-text", text });
  }

  private async saveMessageEdit(file: TFile, note: Note, replyIndex: number | null, editor: HTMLTextAreaElement): Promise<void> {
    const text = editor.value.trim();
    if (text === "") return;
    try {
      if (replyIndex === null) await this.plugin.editNoteFor(file.path, note.id, text);
      else await this.plugin.editReplyFor(file.path, note.id, replyIndex, text);
    } catch (error) {
      new Notice(`Could not save the message: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.editingTarget = null;
    await this.refresh();
  }

  private async deleteNote(file: TFile, note: Note): Promise<void> {
    try {
      await this.plugin.deleteNoteFor(file.path, note.id);
    } catch (error) {
      new Notice(`Could not delete the note: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.confirmingDeleteId = null;
    await this.refresh();
  }

  private async submitReply(file: TFile, note: Note, composer: HTMLTextAreaElement): Promise<void> {
    const text = composer.value.trim();
    if (text === "") return;
    try {
      await this.plugin.replyToNoteFor(file.path, note.id, text);
    } catch (error) {
      new Notice(`Could not save the reply: ${error instanceof Error ? error.message : String(error)}`);
    }
    await this.refresh();
  }
}
