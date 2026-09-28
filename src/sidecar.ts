/**
 * The thread file's shape and mutations, byte-compatible with the agent
 * skill's `notes.py`. Both write the same field names in the same order (so a
 * rewritten file reads as the same shape under `git diff`), as compact JSON
 * with no whitespace and no trailing newline. The parse is all or nothing. Any
 * structural violation, not just malformed JSON, reads back as an empty sheet
 * rather than a partially recovered one.
 */

import type { NoteAnchor } from "./anchors";

export type Author = "owner" | "agent";
export type Status = "open" | "resolved";

export interface Reply {
  author: Author;
  text: string;
  at: string;
}

export interface Note {
  id: string;
  anchor: NoteAnchor;
  text: string;
  created_at: string;
  archived: boolean;
  replies: Reply[];
  status: Status;
}

export interface NoteSheet {
  version: 1;
  notes: Note[];
}

export function emptySheet(): NoteSheet {
  return { version: 1, notes: [] };
}

class SidecarFormatError extends Error {}

/** `raw`'s note sheet. Malformed JSON or a structural violation reads back as an empty sheet. */
export function parseSheet(raw: string): NoteSheet {
  try {
    return decodeSheet(JSON.parse(raw));
  } catch {
    return emptySheet();
  }
}

/** `sheet` as the sidecar's exact on-disk text: compact JSON, no trailing newline. */
export function serializeSheet(sheet: NoteSheet): string {
  return JSON.stringify({
    version: 1,
    notes: sheet.notes.map((note) => ({
      id: note.id,
      anchor: { exact: note.anchor.exact, prefix: note.anchor.prefix, suffix: note.anchor.suffix },
      text: note.text,
      created_at: note.created_at,
      archived: note.archived,
      replies: note.replies.map((reply) => ({ author: reply.author, text: reply.text, at: reply.at })),
      status: note.status,
    })),
  });
}

/** A uuid4 string, minted the same way `notes.py`'s `add_note` mints a note id. */
export function mintId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

/** An ISO 8601 UTC timestamp for "now", the same shape `created_at`/`at` already carry. */
export function mintTimestamp(): string {
  return new Date().toISOString();
}

/** `sheet` with a new note appended. The id and timestamp default to freshly minted ones. */
export function addNote(
  sheet: NoteSheet,
  anchor: NoteAnchor,
  text: string,
  id: string = mintId(),
  createdAt: string = mintTimestamp(),
): { sheet: NoteSheet; note: Note } {
  const note: Note = { id, anchor, text, created_at: createdAt, archived: false, replies: [], status: "open" };
  return { sheet: { version: 1, notes: [...sheet.notes, note] }, note };
}

/** `sheet` with `noteId`'s `text` and/or `archived` updated. Throws if no note has `noteId`. */
export function replaceNote(sheet: NoteSheet, noteId: string, patch: { text?: string; archived?: boolean }): { sheet: NoteSheet; note: Note } {
  return withUpdatedNote(sheet, noteId, (note) => ({
    ...note,
    text: patch.text ?? note.text,
    archived: patch.archived ?? note.archived,
  }));
}

/** `sheet` with `noteId` gone. Throws if no note has `noteId`. */
export function removeNote(sheet: NoteSheet, noteId: string): NoteSheet {
  const remaining = sheet.notes.filter((note) => note.id !== noteId);
  if (remaining.length === sheet.notes.length) throw noSuchNote(noteId);
  return { version: 1, notes: remaining };
}

/** `sheet` with a reply appended to `noteId`'s thread. Throws if no note has `noteId`. */
export function addReply(sheet: NoteSheet, noteId: string, author: Author, text: string, at: string = mintTimestamp()): { sheet: NoteSheet; note: Note } {
  return withUpdatedNote(sheet, noteId, (note) => ({ ...note, replies: [...note.replies, { author, text, at }] }));
}

/** `sheet` with reply `replyIndex` of `noteId` reworded. Throws if no note has `noteId` or no reply sits at that index. */
export function editReply(sheet: NoteSheet, noteId: string, replyIndex: number, text: string): { sheet: NoteSheet; note: Note } {
  return withUpdatedNote(sheet, noteId, (note) => {
    if (note.replies[replyIndex] === undefined) throw new Error(`no reply at index ${replyIndex}`);
    return { ...note, replies: note.replies.map((reply, index) => (index === replyIndex ? { ...reply, text } : reply)) };
  });
}

/** `sheet` with `noteId`'s thread status changed. Throws if no note has `noteId`. */
export function setStatus(sheet: NoteSheet, noteId: string, status: Status): { sheet: NoteSheet; note: Note } {
  return withUpdatedNote(sheet, noteId, (note) => ({ ...note, status }));
}

function withUpdatedNote(sheet: NoteSheet, noteId: string, update: (note: Note) => Note): { sheet: NoteSheet; note: Note } {
  let updated: Note | null = null;
  const notes = sheet.notes.map((note) => {
    if (note.id !== noteId) return note;
    updated = update(note);
    return updated;
  });
  if (updated === null) throw noSuchNote(noteId);
  return { sheet: { version: 1, notes }, note: updated };
}

function noSuchNote(noteId: string): Error {
  return new Error(`no note with id ${noteId}`);
}

function decodeSheet(data: unknown): NoteSheet {
  if (!isRecord(data)) throw new SidecarFormatError("sidecar root is not an object");
  if ("version" in data && data.version !== 1) throw new SidecarFormatError("unsupported sidecar version");
  const rawNotes = "notes" in data ? data.notes : [];
  if (!Array.isArray(rawNotes)) throw new SidecarFormatError("notes is not an array");
  return { version: 1, notes: rawNotes.map(decodeNote) };
}

function decodeNote(data: unknown): Note {
  if (!isRecord(data)) throw new SidecarFormatError("note is not an object");
  const id = requireString(data.id, "id");
  const text = requireString(data.text, "text");
  const createdAt = requireString(data.created_at, "created_at");
  const anchor = decodeAnchor(data.anchor);
  const archived = "archived" in data ? requireBoolean(data.archived, "archived") : false;
  const rawReplies = "replies" in data ? data.replies : [];
  if (!Array.isArray(rawReplies)) throw new SidecarFormatError("replies is not an array");
  const status = "status" in data ? requireStatus(data.status) : "open";
  return { id, anchor, text, created_at: createdAt, archived, replies: rawReplies.map(decodeReply), status };
}

function decodeAnchor(data: unknown): NoteAnchor {
  if (!isRecord(data)) throw new SidecarFormatError("anchor is not an object");
  const exact = requireString(data.exact, "exact");
  const prefix = "prefix" in data ? requireString(data.prefix, "prefix") : "";
  const suffix = "suffix" in data ? requireString(data.suffix, "suffix") : "";
  return { exact, prefix, suffix };
}

function decodeReply(data: unknown): Reply {
  if (!isRecord(data)) throw new SidecarFormatError("reply is not an object");
  const author = requireAuthor(data.author);
  const text = requireString(data.text, "text");
  const at = requireString(data.at, "at");
  return { author, text, at };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new SidecarFormatError(`${field} is not a string`);
  return value;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new SidecarFormatError(`${field} is not a boolean`);
  return value;
}

function requireAuthor(value: unknown): Author {
  if (value !== "owner" && value !== "agent") throw new SidecarFormatError("author is not owner or agent");
  return value;
}

function requireStatus(value: unknown): Status {
  if (value !== "open" && value !== "resolved") throw new SidecarFormatError("status is not open or resolved");
  return value;
}
