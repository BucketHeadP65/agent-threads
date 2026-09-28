// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { sectionLines, selectionPlacement, stampSection, stampedSections } from "./section-stamps";

describe("section stamps", () => {
  it("round-trips the source lines a section renders", () => {
    const section = document.createElement("div");
    stampSection(section, 4, 7);
    expect(sectionLines(section)).toEqual({ lineStart: 4, lineEnd: 7 });
  });

  it("reads nothing from an unstamped element", () => {
    expect(sectionLines(document.createElement("div"))).toBeNull();
  });

  it("lists the stamped sections under a root in document order", () => {
    const root = document.createElement("div");
    const first = document.createElement("div");
    const plain = document.createElement("div");
    const second = document.createElement("div");
    stampSection(first, 0, 0);
    stampSection(second, 2, 3);
    root.append(first, plain, second);

    expect(stampedSections(root)).toEqual([
      { element: first, lineStart: 0, lineEnd: 0 },
      { element: second, lineStart: 2, lineEnd: 3 },
    ]);
  });
});

describe("selectionPlacement", () => {
  function twoSections(): { root: HTMLElement; a: Text; b: Text } {
    const root = document.createElement("div");
    const first = document.createElement("div");
    const second = document.createElement("div");
    stampSection(first, 2, 2);
    stampSection(second, 4, 5);
    const a = document.createTextNode("Verify at work.");
    const b = document.createTextNode("Graph delta semantics");
    const p = document.createElement("p");
    p.append(a);
    first.append(p);
    const li = document.createElement("li");
    li.append(b);
    second.append(li);
    root.append(first, second);
    return { root, a, b };
  }

  it("covers the sections at both ends and places the selection start in their rendered text", () => {
    const { a, b } = twoSections();
    const range = document.createRange();
    range.setStart(a, 7);
    range.setEnd(b, 5);

    expect(selectionPlacement(range)).toEqual({ lineStart: 2, lineEnd: 5, renderedText: "Verify at work.Graph delta semantics", renderedOffset: 7 });
  });

  it("places a selection inside one section against that section's text alone", () => {
    const { b } = twoSections();
    const range = document.createRange();
    range.setStart(b, 6);
    range.setEnd(b, 11);

    expect(selectionPlacement(range)).toEqual({ lineStart: 4, lineEnd: 5, renderedText: "Graph delta semantics", renderedOffset: 6 });
  });

  it("is null when an end of the selection sits outside any stamped section", () => {
    const { root, a } = twoSections();
    const loose = document.createTextNode("elsewhere");
    root.append(loose);
    const range = document.createRange();
    range.setStart(a, 0);
    range.setEnd(loose, 3);

    expect(selectionPlacement(range)).toBeNull();
  });
});
