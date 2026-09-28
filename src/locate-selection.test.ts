import { describe, expect, it } from "vitest";

import { locateSelection, occurrenceIndex } from "./locate-selection";

describe("locateSelection", () => {
  it("finds a plain paragraph selection literally", () => {
    const source = "one two three\n\nfour five six\n";
    expect(locateSelection(source, "four five six")).toEqual({ start: source.indexOf("four"), end: source.indexOf("six") + 3 });
  });

  it("trims the trailing newline a triple click carries", () => {
    const source = "alpha beta\n\ngamma delta\n";
    expect(locateSelection(source, "alpha beta\n")).toEqual({ start: 0, end: "alpha beta".length });
  });

  it("finds heading text behind its # marker", () => {
    const source = "intro line\n\n## Review Requests\n\nbody text\n";
    const start = source.indexOf("Review Requests");
    expect(locateSelection(source, "Review Requests")).toEqual({ start, end: start + "Review Requests".length });
  });

  it("narrows repeated heading text to the heading line when the selection sat in a heading", () => {
    const source = "the Speed Dial idea came first\n\n## Speed Dial\n\nmore prose\n";
    const headingStart = source.indexOf("Speed Dial", source.indexOf("##"));
    expect(locateSelection(source, "Speed Dial", 2)).toEqual({ start: headingStart, end: headingStart + "Speed Dial".length });
  });

  it("refuses repeated text with no heading hint", () => {
    const source = "same words here\n\nsame words here\n";
    expect(locateSelection(source, "same words here")).toBeNull();
  });

  it("finds a selection whose source carries bold marks", () => {
    const source = "the **quick brown** fox jumps\n";
    const span = locateSelection(source, "quick brown fox");
    expect(span).not.toBeNull();
    expect(source.slice(span?.start, span?.end)).toBe("quick brown** fox");
  });

  it("finds a selection through a markdown link's label", () => {
    const source = "read the [full spec](https://example.test/spec) before starting\n";
    const span = locateSelection(source, "the full spec before");
    expect(span).not.toBeNull();
    expect(source.slice(span?.start, span?.end)).toBe("the [full spec](https://example.test/spec) before");
  });

  it("finds a selection through a wikilink alias", () => {
    const source = "see [[docs/target-note|the target]] for details\n";
    const span = locateSelection(source, "see the target for");
    expect(span).not.toBeNull();
    expect(source.slice(span?.start, span?.end)).toBe("see [[docs/target-note|the target]] for");
  });

  it("finds a list item's text behind its marker", () => {
    const source = "steps:\n\n- first step taken\n- second step taken\n";
    const start = source.indexOf("first step taken");
    expect(locateSelection(source, "first step taken")).toEqual({ start, end: start + "first step taken".length });
  });

  it("finds text inside a code span without its backticks", () => {
    const source = "run `make build` to sync\n";
    const span = locateSelection(source, "run make build to");
    expect(span).not.toBeNull();
    expect(source.slice(span?.start, span?.end)).toBe("run `make build` to");
  });

  it("finds blockquoted text behind its > marker", () => {
    const source = "context:\n\n> the quoted claim stands\n";
    const start = source.indexOf("the quoted claim");
    expect(locateSelection(source, "the quoted claim stands")).toEqual({ start, end: start + "the quoted claim stands".length });
  });

  it("returns null for an empty or whitespace selection", () => {
    expect(locateSelection("anything\n", "   \n")).toBeNull();
  });
});

describe("locateSelection within a source span", () => {
  it("pins repeated text to the occurrence inside the given span, reporting whole-source offsets", () => {
    const source = "same text\n\n## H\n\nsame text\n";
    expect(locateSelection(source, "same text", null)).toBeNull();
    expect(locateSelection(source, "same text", null, { start: 17, end: 26 })).toEqual({ start: 17, end: 26 });
  });

  it("still refuses text that repeats inside the span", () => {
    const source = "same text same text\n";
    expect(locateSelection(source, "same text", null, { start: 0, end: 19 })).toBeNull();
  });
});

describe("locateSelection with the occurrence the reader selected", () => {
  const table = "| Table | Written by |\n|---|---|\n| `events` | lifecycle events and publication events |\n| `cursors` | one handler |\n";
  const within = { start: 0, end: table.length };

  it("picks the occurrence at the reader's position when the text repeats inside the span", () => {
    const cell = table.indexOf("`events`") + 1;
    const lifecycle = table.indexOf("lifecycle events") + "lifecycle ".length;
    expect(locateSelection(table, "events", null, within, 0)).toEqual({ start: cell, end: cell + 6 });
    expect(locateSelection(table, "events", null, within, 1)).toEqual({ start: lifecycle, end: lifecycle + 6 });
  });

  it("still finds a unique text when the occurrence index does not line up", () => {
    const cursors = table.indexOf("`cursors`") + 1;
    expect(locateSelection(table, "cursors", null, within, 3)).toEqual({ start: cursors, end: cursors + 7 });
  });

  it("refuses when the occurrence is out of range and the text repeats", () => {
    expect(locateSelection(table, "events", null, within, 9)).toBeNull();
  });
});

describe("occurrenceIndex", () => {
  it("counts how many matches of the selected text start before the selection", () => {
    const rendered = "eventslifecycle events and publication eventscursorsone handler";
    expect(occurrenceIndex(rendered, "events", 0)).toBe(0);
    expect(occurrenceIndex(rendered, "events", rendered.indexOf("lifecycle events") + 10)).toBe(1);
    expect(occurrenceIndex(rendered, "events ", rendered.lastIndexOf("events"))).toBe(2);
    expect(occurrenceIndex(rendered, "cursors", rendered.indexOf("cursors"))).toBe(0);
  });
});
