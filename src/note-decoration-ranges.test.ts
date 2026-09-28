import { describe, expect, it } from "vitest";

import { noteDecorationRanges } from "./note-decoration-ranges";
import { addNote, emptySheet, replaceNote, setStatus } from "./sidecar";

describe("noteDecorationRanges", () => {
  it("marks an open, unarchived note whose anchor resolves in the doc text", () => {
    const text = "before jumps after";
    const { sheet } = addNote(emptySheet(), { exact: "jumps", prefix: "", suffix: "" }, "a note", "n1", "2026-01-01T00:00:00Z");
    const start = text.indexOf("jumps");
    expect(noteDecorationRanges(sheet, text)).toEqual([{ from: start, to: start + "jumps".length, noteId: "n1" }]);
  });

  it("skips a resolved note", () => {
    const text = "before jumps after";
    const { sheet } = addNote(emptySheet(), { exact: "jumps", prefix: "", suffix: "" }, "a note", "n1", "2026-01-01T00:00:00Z");
    const resolved = setStatus(sheet, "n1", "resolved").sheet;
    expect(noteDecorationRanges(resolved, text)).toEqual([]);
  });

  it("skips an archived note", () => {
    const text = "before jumps after";
    const { sheet } = addNote(emptySheet(), { exact: "jumps", prefix: "", suffix: "" }, "a note", "n1", "2026-01-01T00:00:00Z");
    const archived = replaceNote(sheet, "n1", { archived: true }).sheet;
    expect(noteDecorationRanges(archived, text)).toEqual([]);
  });

  it("skips a note whose anchor no longer resolves", () => {
    const { sheet } = addNote(emptySheet(), { exact: "gone", prefix: "", suffix: "" }, "a note", "n1", "2026-01-01T00:00:00Z");
    expect(noteDecorationRanges(sheet, "nothing matches here")).toEqual([]);
  });

  it("marks every resolving open note when several are present", () => {
    const text = "alpha beta gamma";
    const first = addNote(emptySheet(), { exact: "alpha", prefix: "", suffix: "" }, "one", "n1", "2026-01-01T00:00:00Z").sheet;
    const second = addNote(first, { exact: "gamma", prefix: "", suffix: "" }, "two", "n2", "2026-01-01T00:00:00Z").sheet;
    const ranges = noteDecorationRanges(second, text);
    expect(ranges).toEqual([
      { from: text.indexOf("alpha"), to: text.indexOf("alpha") + "alpha".length, noteId: "n1" },
      { from: text.indexOf("gamma"), to: text.indexOf("gamma") + "gamma".length, noteId: "n2" },
    ]);
  });
});
