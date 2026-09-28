import { describe, expect, it } from "vitest";

import { lineSpan, sectionMarkRanges } from "./section-marks";
import { addNote, emptySheet } from "./sidecar";
import type { NoteAnchor } from "./anchors";

function sheetWith(anchor: NoteAnchor) {
  return addNote(emptySheet(), anchor, "note", "n1", "2026-01-01T00:00:00Z").sheet;
}

describe("lineSpan", () => {
  it("covers the given source lines, inclusive, without the trailing newline", () => {
    const source = "one\ntwo\nthree\nfour\n";
    expect(lineSpan(source, 1, 2)).toEqual({ start: 4, end: 13 });
    expect(source.slice(4, 13)).toBe("two\nthree");
  });

  it("runs to the end of the source when the last line has no newline", () => {
    expect(lineSpan("one\ntwo", 1, 1)).toEqual({ start: 4, end: 7 });
  });
});

describe("sectionMarkRanges", () => {
  it("marks a note spanning a bold close and a list item in each section's rendered text", () => {
    const source = "Intro para.\n\n**Verify at work.**\n\n1. Graph delta semantics per item: does it?\n2. Delta token lifetime.\n";
    const sheet = sheetWith({
      exact: "Verify at work.**\n\n1. Graph delta semantics per item: does it?",
      prefix: "Intro para.\n\n**",
      suffix: "\n2. Delta token",
    });
    // Rendered text nodes carry no markers, no list numbers and no whitespace between list items.
    const sections = [
      { lineStart: 0, lineEnd: 0, text: "Intro para." },
      { lineStart: 2, lineEnd: 2, text: "Verify at work." },
      { lineStart: 4, lineEnd: 5, text: "Graph delta semantics per item: does it?Delta token lifetime." },
    ];

    expect(sectionMarkRanges(sheet, source, sections)).toEqual([
      { section: 1, from: 0, to: "Verify at work.".length, noteId: "n1" },
      { section: 2, from: 0, to: "Graph delta semantics per item: does it?".length, noteId: "n1" },
    ]);
  });

  it("marks only the section holding the resolved span when the text repeats elsewhere", () => {
    const source = "alpha beta\n\nalpha beta\n\ngamma\n";
    const sheet = sheetWith({ exact: "alpha beta", prefix: "", suffix: "\n\ngamma" });
    const sections = [
      { lineStart: 0, lineEnd: 0, text: "alpha beta" },
      { lineStart: 2, lineEnd: 2, text: "alpha beta" },
      { lineStart: 4, lineEnd: 4, text: "gamma" },
    ];

    expect(sectionMarkRanges(sheet, source, sections)).toEqual([{ section: 1, from: 0, to: 10, noteId: "n1" }]);
  });

  it("marks nothing when the anchor does not resolve to one place in the source", () => {
    const source = "alpha beta\n\nalpha beta\n";
    const sheet = sheetWith({ exact: "alpha beta", prefix: "", suffix: "" });
    const sections = [
      { lineStart: 0, lineEnd: 0, text: "alpha beta" },
      { lineStart: 2, lineEnd: 2, text: "alpha beta" },
    ];

    expect(sectionMarkRanges(sheet, source, sections)).toEqual([]);
  });

  it("picks the right occurrence when the span repeats inside one section", () => {
    const source = "x y x y\n";
    const sheet = sheetWith({ exact: "x y", prefix: "x y ", suffix: "" });

    expect(sectionMarkRanges(sheet, source, [{ lineStart: 0, lineEnd: 0, text: "x y x y" }])).toEqual([{ section: 0, from: 4, to: 7, noteId: "n1" }]);
  });

  it("matches across a soft line break the renderer turned into nothing", () => {
    const source = "first line\nsecond line\n";
    const sheet = sheetWith({ exact: "line\nsecond", prefix: "first ", suffix: " line" });

    expect(sectionMarkRanges(sheet, source, [{ lineStart: 0, lineEnd: 1, text: "first linesecond line" }])).toEqual([
      { section: 0, from: 6, to: 16, noteId: "n1" },
    ]);
  });

  it("marks through bold marks inside one paragraph", () => {
    const source = "before **bold middle** after\n";
    const sheet = sheetWith({ exact: "fore **bold mid", prefix: "be", suffix: "dle** after" });

    expect(sectionMarkRanges(sheet, source, [{ lineStart: 0, lineEnd: 0, text: "before bold middle after" }])).toEqual([
      { section: 0, from: 2, to: 15, noteId: "n1" },
    ]);
  });

  it("skips resolved, archived and unresolvable notes", () => {
    const source = "keep this\n";
    const open = sheetWith({ exact: "gone", prefix: "", suffix: "" });
    const resolved = addNote(emptySheet(), { exact: "keep", prefix: "", suffix: "" }, "note", "n2", "2026-01-01T00:00:00Z").sheet;
    const note = resolved.notes[0];
    if (!note) throw new Error("addNote did not produce a note");
    const sheet = { version: 1 as const, notes: [...open.notes, { ...note, status: "resolved" as const }] };

    expect(sectionMarkRanges(sheet, source, [{ lineStart: 0, lineEnd: 0, text: "keep this" }])).toEqual([]);
  });
});
