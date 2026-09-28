/**
 * Agent Threads: owner-and-agent note threads on markdown files, read and
 * written directly against the `.agent-threads/<file-path>.threads.json`
 * thread files that coding agents also read and write. There is no server.
 * The thread file is the shared source of truth.
 */

import { MarkdownView, Notice, Plugin, setIcon, TFile } from "obsidian";

import type { NoteAnchor } from "./anchors";
import { anchorFor } from "./anchors";
import { BUNDLED_SKILL } from "./bundled-skill";
import { createAddNoteExtension } from "./editor-extension";
import { installIdLinkResolution } from "./id-links";
import { createNoteDecorationsExtension } from "./note-decorations";
import type { ReadingPane } from "./reading-marks";
import { refreshReadingMarks, registerReadingMarks } from "./reading-marks";
import { registerReadingViewSelection } from "./reading-view";
import type { AgentThreadsSettings } from "./settings";
import { DEFAULT_SETTINGS, AgentThreadsSettingTab, readSettings } from "./settings";
import { SidecarPoller } from "./sidecar-poller";
import type { Author, Note, NoteSheet, Status } from "./sidecar";
import { installSkill, SKILL_DIR } from "./skill-installer";
import { createNote, deleteNote, editNote, editNoteReply, isSidecarFor, loadNotes, replyToNote, setNoteStatus, sidecarMtime } from "./vault-notes";
import { NotesView, VIEW_TYPE_AGENT_THREADS } from "./view";

export interface NoteAffordanceOptions {
  top: number;
  left: number;
  from: number;
  to: number;
  source: string;
}

/** How often the active file's sidecar is polled for an external writer's change (see `SidecarPoller`). */
const SIDECAR_POLL_INTERVAL_MS = 3000;

export default class AgentThreadsPlugin extends Plugin {
  settings: AgentThreadsSettings = DEFAULT_SETTINGS;
  private affordanceButton: HTMLButtonElement | null = null;
  private composerEl: HTMLDivElement | null = null;
  private threadPopoverEl: HTMLDivElement | null = null;
  private readonly sidecarWrittenListeners = new Set<(path: string) => void>();
  private readonly sidecarPoller = new SidecarPoller(
    (path) => sidecarMtime(this.app.vault.adapter, path),
    (path) => this.notifySidecarWritten(path),
    SIDECAR_POLL_INTERVAL_MS,
  );

  override async onload(): Promise<void> {
    this.settings = readSettings(await this.loadData());
    this.addSettingTab(new AgentThreadsSettingTab(this.app, this));

    this.registerView(VIEW_TYPE_AGENT_THREADS, (leaf) => new NotesView(leaf, this));

    this.addRibbonIcon("message-square", "Open Agent Threads", () => void this.revealNotesView());
    this.addCommand({
      id: "open-agent-threads",
      name: "Open notes panel",
      callback: () => void this.revealNotesView(),
    });

    this.registerEditorExtension(createAddNoteExtension(this));
    this.registerEditorExtension(createNoteDecorationsExtension(this));
    registerReadingViewSelection(this);
    registerReadingMarks(this);
    installIdLinkResolution(this);

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile) void this.onVaultModify(file);
      }),
    );

    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.trackActiveFileForPoll()));
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        this.trackActiveFileForPoll();
        if (file) refreshReadingMarks(this, file.path);
      }),
    );
    this.trackActiveFileForPoll();

    // A reading-view pane already open when this plugin (re)loads keeps whatever it
    // rendered under the previous plugin instance. Obsidian only re-runs a markdown
    // post processor when a section's own content changes, never because a new
    // processor was registered. So its notes stay unmarked until the marks are
    // patched in. `file-open` above catches switching into a stale pane later. This
    // catches the file already open at load time. Deferred to layout-ready because no
    // pane exists yet if this fires during Obsidian's own startup.
    this.app.workspace.onLayoutReady(() => {
      if (this.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT_THREADS).length === 0) void this.revealNotesView();
      const active = this.app.workspace.getActiveFile();
      if (active) refreshReadingMarks(this, active.path);
      if (this.settings.installAgentSkill) void this.installAgentSkill();
    });

    this.registerDomEvent(document, "mousedown", (event) => {
      const popover = this.threadPopoverEl;
      if (popover && event.target instanceof Node && !popover.contains(event.target)) this.closeThreadPopover();
    });
  }

  override onunload(): void {
    this.hideNoteAffordance();
    this.closeComposer();
    this.closeThreadPopover();
    this.sidecarPoller.destroy();
  }

  /** Retargets the external-change poll to the active markdown file, or drops it when none is open. */
  private trackActiveFileForPoll(): void {
    const active = this.app.workspace.getActiveFile();
    this.sidecarPoller.setActivePath(active && active.extension === "md" ? active.path : null);
  }

  /** Every markdown view's reading surface, focused or not, for `reading-marks.ts`'s `refreshReadingMarks`. */
  readingPanes(): ReadingPane[] {
    const panes: ReadingPane[] = [];
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view instanceof MarkdownView) panes.push(leaf.view);
    }
    return panes;
  }

  /** Opens (or focuses) the notes panel. Called from the ribbon/command and from a decorated span's click handler. */
  async revealNotesView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT_THREADS)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE_AGENT_THREADS, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  private async onVaultModify(file: TFile): Promise<void> {
    const view = this.activeNotesView();
    const trackedPath = view?.activeFilePath();
    if (view && trackedPath && isSidecarFor(trackedPath, file.path)) {
      await view.refresh();
    }
  }

  private activeNotesView(): NotesView | null {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_AGENT_THREADS)[0];
    return leaf?.view instanceof NotesView ? leaf.view : null;
  }

  refreshNotesView(): void {
    void this.activeNotesView()?.refresh();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** Writes the bundled skill into the vault, telling the owner when something was written or refused. */
  async installAgentSkill(): Promise<void> {
    try {
      const written = await installSkill(this.app.vault.adapter, BUNDLED_SKILL);
      if (written.length > 0) new Notice(`Agent Threads wrote the agent skill to ${SKILL_DIR}`);
    } catch (error) {
      new Notice(`Agent Threads could not write the agent skill (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  // Thread file operations, delegated to vault-notes.ts against the live vault adapter.

  loadNotesFor(path: string): Promise<NoteSheet> {
    return loadNotes(this.app.vault.adapter, path);
  }

  async createNoteFor(path: string, anchor: NoteAnchor, text: string): Promise<Note> {
    const note = await createNote(this.app.vault.adapter, path, anchor, text);
    this.notifySidecarWritten(path);
    return note;
  }

  async editNoteFor(path: string, noteId: string, text: string): Promise<Note> {
    const note = await editNote(this.app.vault.adapter, path, noteId, text);
    this.notifySidecarWritten(path);
    return note;
  }

  async editReplyFor(path: string, noteId: string, replyIndex: number, text: string): Promise<Note> {
    const note = await editNoteReply(this.app.vault.adapter, path, noteId, replyIndex, text);
    this.notifySidecarWritten(path);
    return note;
  }

  async deleteNoteFor(path: string, noteId: string): Promise<void> {
    await deleteNote(this.app.vault.adapter, path, noteId);
    this.notifySidecarWritten(path);
  }

  async replyToNoteFor(path: string, noteId: string, text: string): Promise<Note> {
    const note = await replyToNote(this.app.vault.adapter, path, noteId, "owner", text);
    this.notifySidecarWritten(path);
    return note;
  }

  async setNoteStatusFor(path: string, noteId: string, status: Status): Promise<Note> {
    const note = await setNoteStatus(this.app.vault.adapter, path, noteId, status);
    this.notifySidecarWritten(path);
    return note;
  }

  /**
   * Notifies `listener` with a file's path whenever this plugin instance
   * writes that file's sidecar. The vault's own "modify" event never fires
   * for `.agent-threads/*` because Obsidian does not track dot-folder contents.
   * This is the only live signal an editing-mode extension has for a note
   * added, replied to, resolved, or deleted while its file stays open.
   * Returns an unsubscribe function.
   */
  onSidecarWritten(listener: (path: string) => void): () => void {
    this.sidecarWrittenListeners.add(listener);
    return () => this.sidecarWrittenListeners.delete(listener);
  }

  private notifySidecarWritten(path: string): void {
    for (const listener of this.sidecarWrittenListeners) listener(path);
    refreshReadingMarks(this, path);
  }

  // The floating "Add note" affordance and its inline composer.

  /** Shows (or repositions) the "Add note" button. A no-op while the composer is open. */
  showNoteAffordance(options: NoteAffordanceOptions): void {
    if (this.composerEl) return;
    if (!this.affordanceButton) {
      const button = document.createElement("button");
      button.textContent = "Add note";
      button.className = "agent-threads-affordance";
      button.onmousedown = (event) => event.preventDefault();
      document.body.appendChild(button);
      this.affordanceButton = button;
    }
    const button = this.affordanceButton;
    button.style.top = `${options.top + 4}px`;
    button.style.left = `${options.left}px`;
    button.onclick = () => this.openComposer(options);
  }

  hideNoteAffordance(): void {
    this.affordanceButton?.remove();
    this.affordanceButton = null;
  }

  private openComposer(options: NoteAffordanceOptions): void {
    this.hideNoteAffordance();
    this.closeComposer();

    const file = this.app.workspace.getActiveFile();
    if (!file) return;

    const panel = document.createElement("div");
    panel.className = "agent-threads-composer";
    panel.style.top = `${options.top + 4}px`;
    panel.style.left = `${options.left}px`;

    const textarea = document.createElement("textarea");
    textarea.placeholder = "Add a note…";
    textarea.rows = 3;
    panel.appendChild(textarea);

    const actions = document.createElement("div");
    actions.className = "agent-threads-composer-actions";

    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.onclick = () => this.closeComposer();

    const save = document.createElement("button");
    save.textContent = "Save";
    save.className = "is-primary";
    save.onclick = () => void this.saveComposer(file, options, textarea);

    actions.append(cancel, save);
    panel.appendChild(actions);

    document.body.appendChild(panel);
    this.composerEl = panel;
    textarea.focus();
  }

  private closeComposer(): void {
    this.composerEl?.remove();
    this.composerEl = null;
  }

  private async saveComposer(file: TFile, options: NoteAffordanceOptions, textarea: HTMLTextAreaElement): Promise<void> {
    const text = textarea.value.trim();
    if (text === "") return;
    const anchor = anchorFor(options.source, options.from, options.to);
    try {
      await this.createNoteFor(file.path, anchor, text);
      this.closeComposer();
      this.refreshNotesView();
    } catch (error) {
      new Notice(`Could not save the note: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // The floating thread popover a clicked note mark opens.

  /** Opens (or re-renders) the thread popover for `noteId` of `path` at a viewport position. */
  openThread(path: string, noteId: string, at: { top: number; left: number }): void {
    void this.renderThreadPopover(path, noteId, at, { editing: null, confirmingDelete: false });
  }

  private closeThreadPopover(): void {
    this.threadPopoverEl?.remove();
    this.threadPopoverEl = null;
  }

  private async renderThreadPopover(path: string, noteId: string, at: { top: number; left: number }, state: PopoverState): Promise<void> {
    const sheet = await this.loadNotesFor(path);
    const note = sheet.notes.find((candidate) => candidate.id === noteId);
    this.closeThreadPopover();
    if (!note) return;

    const rerender = (next: PopoverState): void => void this.renderThreadPopover(path, noteId, at, next);

    const popover = document.createElement("div");
    popover.className = "agent-threads-thread-popover";
    popover.style.top = `${Math.min(at.top + 8, Math.max(0, window.innerHeight - 320))}px`;
    popover.style.left = `${Math.min(at.left, Math.max(0, window.innerWidth - 340))}px`;

    const quote = document.createElement("blockquote");
    quote.className = "agent-thread-quote";
    quote.textContent = note.anchor.exact;
    popover.appendChild(quote);

    const messages = document.createElement("div");
    messages.className = "agent-thread-replies";
    const message = (author: Author, text: string, replyIndex: number | null): void => {
      const editingThis = state.editing !== null && state.editing.replyIndex === replyIndex;
      messages.appendChild(
        this.popoverMessage(author, text, {
          onEdit: author === "owner" && !editingThis ? () => rerender({ editing: { replyIndex }, confirmingDelete: false }) : null,
          editor: editingThis
            ? {
                onCancel: () => rerender({ editing: null, confirmingDelete: false }),
                onSave: (edited) => void this.saveEditedMessage(path, noteId, at, replyIndex, edited),
              }
            : null,
        }),
      );
    };
    message("owner", note.text, null);
    note.replies.forEach((reply, index) => message(reply.author, reply.text, index));
    popover.appendChild(messages);

    const composer = document.createElement("textarea");
    composer.className = "agent-thread-reply-input";
    composer.placeholder = "Reply";
    composer.rows = 2;
    popover.appendChild(composer);

    const actions = document.createElement("div");
    actions.className = "agent-threads-composer-actions";

    if (state.confirmingDelete) {
      const confirm = document.createElement("button");
      confirm.textContent = "Delete?";
      confirm.className = "agent-thread-confirm-delete";
      confirm.onclick = () => void this.deleteFromPopover(path, noteId);
      const cancel = document.createElement("button");
      cancel.textContent = "Cancel";
      cancel.onclick = () => rerender({ editing: null, confirmingDelete: false });
      actions.append(confirm, cancel);
    } else {
      const trash = iconButton("trash-2", "Delete note");
      trash.onclick = () => rerender({ editing: null, confirmingDelete: true });
      actions.appendChild(trash);
    }

    const reply = document.createElement("button");
    reply.textContent = "Reply";
    reply.className = "is-primary";
    reply.onclick = () => void this.replyFromPopover(path, noteId, at, composer);
    actions.appendChild(reply);
    popover.appendChild(actions);

    document.body.appendChild(popover);
    this.threadPopoverEl = popover;
    popover.querySelector("textarea")?.focus();
  }

  private popoverMessage(author: Author, text: string, controls: MessageControls): HTMLDivElement {
    const row = document.createElement("div");
    row.className = `agent-thread-reply is-${author}`;
    const head = document.createElement("div");
    head.className = "agent-thread-message-head";
    const label = document.createElement("span");
    label.className = "agent-thread-reply-author";
    label.textContent = author === "owner" ? "You" : "Agent";
    head.appendChild(label);
    if (controls.onEdit) {
      const pencil = iconButton("pencil", "Edit message");
      pencil.onclick = controls.onEdit;
      head.appendChild(pencil);
    }
    row.appendChild(head);

    if (controls.editor) {
      const editing = controls.editor;
      const editor = document.createElement("textarea");
      editor.className = "agent-thread-reply-input";
      editor.rows = 3;
      editor.value = text;
      row.appendChild(editor);
      const actions = document.createElement("div");
      actions.className = "agent-threads-composer-actions";
      const cancel = document.createElement("button");
      cancel.textContent = "Cancel";
      cancel.onclick = editing.onCancel;
      const save = document.createElement("button");
      save.textContent = "Save";
      save.className = "is-primary";
      save.onclick = () => {
        const edited = editor.value.trim();
        if (edited !== "") editing.onSave(edited);
      };
      actions.append(cancel, save);
      row.appendChild(actions);
      return row;
    }

    const body = document.createElement("p");
    body.className = "agent-thread-text";
    body.textContent = text;
    row.appendChild(body);
    return row;
  }

  private async saveEditedMessage(path: string, noteId: string, at: { top: number; left: number }, replyIndex: number | null, text: string): Promise<void> {
    try {
      if (replyIndex === null) await this.editNoteFor(path, noteId, text);
      else await this.editReplyFor(path, noteId, replyIndex, text);
      this.refreshNotesView();
      await this.renderThreadPopover(path, noteId, at, { editing: null, confirmingDelete: false });
    } catch (error) {
      new Notice(`Could not save the message: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async replyFromPopover(path: string, noteId: string, at: { top: number; left: number }, composer: HTMLTextAreaElement): Promise<void> {
    const text = composer.value.trim();
    if (text === "") return;
    try {
      await this.replyToNoteFor(path, noteId, text);
      this.refreshNotesView();
      await this.renderThreadPopover(path, noteId, at, { editing: null, confirmingDelete: false });
    } catch (error) {
      new Notice(`Could not save the reply: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async deleteFromPopover(path: string, noteId: string): Promise<void> {
    try {
      await this.deleteNoteFor(path, noteId);
      this.refreshNotesView();
      this.closeThreadPopover();
    } catch (error) {
      new Notice(`Could not delete the note: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

interface PopoverState {
  /** The message being edited: the opening note (`replyIndex: null`) or one reply, else `null`. */
  editing: { replyIndex: number | null } | null;
  confirmingDelete: boolean;
}

interface MessageControls {
  /** Shows the pencil on the message when set (owner messages only). */
  onEdit: (() => void) | null;
  /** Renders the message as an editor when set. */
  editor: { onSave: (text: string) => void; onCancel: () => void } | null;
}

/** A ghost icon button carrying a lucide icon and an accessible label. */
function iconButton(icon: string, label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "agent-thread-icon-button";
  button.setAttr("aria-label", label);
  setIcon(button, icon);
  return button;
}
