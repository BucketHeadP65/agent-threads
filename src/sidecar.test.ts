import { describe, expect, it } from "vitest";

import {
  addNote,
  addReply,
  editReply,
  emptySheet,
  mintId,
  mintTimestamp,
  parseSheet,
  removeNote,
  replaceNote,
  serializeSheet,
  setStatus,
} from "./sidecar";

describe("serializeSheet", () => {
  it("round-trips through parseSheet unchanged", () => {
    const sheet = addNote(emptySheet(), { exact: "x", prefix: "", suffix: "" }, "hi", "id-1", "2026-01-01T00:00:00Z").sheet;
    const raw = serializeSheet(sheet);
    expect(parseSheet(raw)).toEqual(sheet);
  });
});

describe("parseSheet", () => {
  it("reads a thread file with absent fields using the same defaults notes.py applies", () => {
    const raw = '{"notes":[{"id":"n1","anchor":{"exact":"x"},"text":"t","created_at":"2026-01-01T00:00:00Z"}]}';
    const sheet = parseSheet(raw);
    expect(sheet.notes).toHaveLength(1);
    const note = sheet.notes[0];
    expect(note?.archived).toBe(false);
    expect(note?.replies).toEqual([]);
    expect(note?.status).toBe("open");
    expect(note?.anchor.prefix).toBe("");
    expect(note?.anchor.suffix).toBe("");
  });

  it("treats malformed JSON as an unannotated (empty) sheet", () => {
    expect(parseSheet("not json")).toEqual(emptySheet());
  });

  it("treats one structurally invalid note as an unannotated sheet, all-or-nothing", () => {
    const raw = '{"notes":[{"id":"n1","anchor":{"exact":"x"},"text":"t","created_at":"2026-01-01T00:00:00Z"},{"id":"n2"}]}';
    expect(parseSheet(raw)).toEqual(emptySheet());
  });

  it("rejects an unsupported version as an unannotated sheet", () => {
    expect(parseSheet('{"version":2,"notes":[]}')).toEqual(emptySheet());
  });
});

describe("mutations", () => {
  function seedNote() {
    return addNote(emptySheet(), { exact: "span", prefix: "", suffix: "" }, "comment", "note-1", "2026-01-01T00:00:00Z");
  }

  it("addNote appends a note with the given id and timestamp, open, unarchived, no replies", () => {
    const { sheet, note } = seedNote();
    expect(sheet.notes).toEqual([note]);
    expect(note).toEqual({
      id: "note-1",
      anchor: { exact: "span", prefix: "", suffix: "" },
      text: "comment",
      created_at: "2026-01-01T00:00:00Z",
      archived: false,
      replies: [],
      status: "open",
    });
  });

  it("replaceNote updates text and archived without touching other fields", () => {
    const { sheet } = seedNote();
    const { note } = replaceNote(sheet, "note-1", { text: "edited", archived: true });
    expect(note.text).toBe("edited");
    expect(note.archived).toBe(true);
    expect(note.status).toBe("open");
  });

  it("replaceNote throws for an unknown id", () => {
    const { sheet } = seedNote();
    expect(() => replaceNote(sheet, "missing", { text: "x" })).toThrow();
  });

  it("removeNote drops the note and throws for an unknown id", () => {
    const { sheet } = seedNote();
    expect(removeNote(sheet, "note-1").notes).toEqual([]);
    expect(() => removeNote(sheet, "missing")).toThrow();
  });

  it("addReply appends to the thread in order and throws for an unknown id", () => {
    const { sheet } = seedNote();
    const first = addReply(sheet, "note-1", "owner", "first reply", "2026-01-01T00:01:00Z");
    const second = addReply(first.sheet, "note-1", "agent", "second reply", "2026-01-01T00:02:00Z");
    expect(second.note.replies).toEqual([
      { author: "owner", text: "first reply", at: "2026-01-01T00:01:00Z" },
      { author: "agent", text: "second reply", at: "2026-01-01T00:02:00Z" },
    ]);
    expect(() => addReply(sheet, "missing", "owner", "x")).toThrow();
  });

  it("setStatus toggles open/resolved and throws for an unknown id", () => {
    const { sheet } = seedNote();
    const resolved = setStatus(sheet, "note-1", "resolved");
    expect(resolved.note.status).toBe("resolved");
    const reopened = setStatus(resolved.sheet, "note-1", "open");
    expect(reopened.note.status).toBe("open");
    expect(() => setStatus(sheet, "missing", "resolved")).toThrow();
  });
});

describe("editReply", () => {
  it("rewords one reply and keeps the rest, the author and the timestamp", () => {
    const seeded = addNote(emptySheet(), { exact: "span", prefix: "", suffix: "" }, "comment", "note-1", "2026-01-01T00:00:00Z").sheet;
    const withFirst = addReply(seeded, "note-1", "owner", "first", "2026-01-01T01:00:00Z").sheet;
    const withBoth = addReply(withFirst, "note-1", "agent", "second", "2026-01-01T02:00:00Z").sheet;

    const { note } = editReply(withBoth, "note-1", 0, "first reworded");

    expect(note.replies).toEqual([
      { author: "owner", text: "first reworded", at: "2026-01-01T01:00:00Z" },
      { author: "agent", text: "second", at: "2026-01-01T02:00:00Z" },
    ]);
    expect(note.text).toBe("comment");
  });

  it("throws for an index with no reply", () => {
    const seeded = addNote(emptySheet(), { exact: "span", prefix: "", suffix: "" }, "comment", "note-1", "2026-01-01T00:00:00Z").sheet;
    expect(() => editReply(seeded, "note-1", 0, "text")).toThrow("no reply at index 0");
  });

  it("throws for an unknown note id", () => {
    const seeded = addNote(emptySheet(), { exact: "span", prefix: "", suffix: "" }, "comment", "note-1", "2026-01-01T00:00:00Z").sheet;
    expect(() => editReply(seeded, "missing", 0, "text")).toThrow("no note with id missing");
  });
});

describe("minting", () => {
  it("mintId produces a uuid4-shaped string", () => {
    expect(mintId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("mintTimestamp produces a UTC ISO 8601 string", () => {
    expect(mintTimestamp()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
