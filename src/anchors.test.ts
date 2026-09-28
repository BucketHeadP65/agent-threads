import { describe, expect, it } from "vitest";

import { anchorFor, resolveAnchor } from "./anchors";

describe("anchorFor", () => {
  it("takes the exact span and up to 32 chars of context on each side", () => {
    const source = "The quick brown fox jumps over the lazy dog near the riverbank at dawn.";
    const start = source.indexOf("jumps");
    const end = start + "jumps".length;
    const anchor = anchorFor(source, start, end);
    expect(anchor.exact).toBe("jumps");
    expect(anchor.prefix).toBe(source.slice(Math.max(0, start - 32), start));
    expect(anchor.suffix).toBe(source.slice(end, end + 32));
    expect(anchor.prefix.length).toBeLessThanOrEqual(32);
    expect(anchor.suffix.length).toBeLessThanOrEqual(32);
  });

  it("truncates the prefix at the start of the source", () => {
    const source = "short prefix here jumps over";
    const start = source.indexOf("jumps");
    const anchor = anchorFor(source, start, start + "jumps".length);
    expect(anchor.prefix).toBe(source.slice(0, start));
  });

  it("truncates the suffix at the end of the source", () => {
    const source = "jumps over a short tail";
    const anchor = anchorFor(source, 0, "jumps".length);
    expect(anchor.suffix).toBe(source.slice("jumps".length));
  });
});

describe("resolveAnchor", () => {
  it("resolves a unique exact match to its offset and 1-based line", () => {
    const text = "line one\nline two has the span\nline three";
    const hit = resolveAnchor(text, { exact: "the span", prefix: "", suffix: "" });
    expect(hit).not.toBeNull();
    expect(hit?.offset).toBe(text.indexOf("the span"));
    expect(hit?.line).toBe(2);
  });

  it("returns null for an empty exact", () => {
    expect(resolveAnchor("anything", { exact: "", prefix: "", suffix: "" })).toBeNull();
  });

  it("returns null when the exact text is gone", () => {
    const hit = resolveAnchor("the text changed entirely", { exact: "gone now", prefix: "", suffix: "" });
    expect(hit).toBeNull();
  });

  it("disambiguates a repeated exact using prefix and suffix", () => {
    const text = "alpha repeat beta and gamma repeat delta";
    const anchor = { exact: "repeat", prefix: "gamma ", suffix: " delta" };
    const hit = resolveAnchor(text, anchor);
    expect(hit?.offset).toBe(text.lastIndexOf("repeat"));
  });

  it("stays orphaned when prefix/suffix cannot narrow a repeat to one", () => {
    const text = "x repeat y and x repeat y again";
    const anchor = { exact: "repeat", prefix: "not there", suffix: "not there either" };
    expect(resolveAnchor(text, anchor)).toBeNull();
  });

  it("narrows by prefix alone when the suffix changed under a repeat", () => {
    const text = "alpha repeat beta and gamma repeat delta";
    const anchor = { exact: "repeat", prefix: "gamma ", suffix: " rewritten" };
    const hit = resolveAnchor(text, anchor);
    expect(hit?.offset).toBe(text.lastIndexOf("repeat"));
  });

  it("narrows by suffix alone when the prefix changed under a repeat", () => {
    const text = "alpha repeat beta and gamma repeat delta";
    const anchor = { exact: "repeat", prefix: "rewritten ", suffix: " delta" };
    const hit = resolveAnchor(text, anchor);
    expect(hit?.offset).toBe(text.lastIndexOf("repeat"));
  });

  it("keeps a heading note on its heading when an edit above rewrote the prefix", () => {
    // The TOC repeats the heading text twice (link target and label). The note was
    // taken on the heading itself, then a paragraph landed at the end of the section
    // above it, shifting the 32 chars before the heading.
    const text = "- [[#R3. Per-asset certification|R3. Per-asset certification]]\n\nOld tail.\nAn answer was inserted here.\n\n## R3. Per-asset certification\n\nSource: the status field.";
    const anchor = { exact: "R3. Per-asset certification", prefix: "Old tail.\n\n## ", suffix: "\n\nSource: the status field." };
    const hit = resolveAnchor(text, anchor);
    expect(hit?.offset).toBe(text.lastIndexOf("R3. Per-asset certification"));
  });

  it("keeps a heading note on its heading when both prefix and suffix changed", () => {
    const text = "- [[#R3. Per-asset certification|R3. Per-asset certification]]\n\nNew tail.\n\n## R3. Per-asset certification\n\nA rewritten section body.";
    const anchor = { exact: "R3. Per-asset certification", prefix: "Old tail.\n\n## ", suffix: "\n\nSource: the status field." };
    const hit = resolveAnchor(text, anchor);
    expect(hit?.offset).toBe(text.lastIndexOf("R3. Per-asset certification"));
  });

  it("never jumps to a heading when the note was not taken on one", () => {
    const text = "## target\n\nbody target here and body target there";
    const anchor = { exact: "target", prefix: "gone ", suffix: " gone" };
    expect(resolveAnchor(text, anchor)).toBeNull();
  });

  it("stays orphaned when two headings repeat the noted text", () => {
    const text = "intro\n\n## Notes\n\nfirst\n\n## Notes\n\nsecond";
    const anchor = { exact: "Notes", prefix: "gone\n\n## ", suffix: "\n\ngone" };
    expect(resolveAnchor(text, anchor)).toBeNull();
  });

  it("falls back to a whitespace-normalized match when spacing changed", () => {
    const text = "before\n\nthe   quoted   span\n\nafter";
    const anchor = { exact: "the quoted span", prefix: "", suffix: "" };
    const hit = resolveAnchor(text, anchor);
    expect(hit).not.toBeNull();
    expect(hit?.offset).toBe(text.indexOf("the"));
  });

  it("treats regex special characters in the exact span as literal text", () => {
    const text = "cost is $5 (approx.) per unit [see note]";
    const anchor = { exact: "$5 (approx.) per unit [see note]", prefix: "", suffix: "" };
    const hit = resolveAnchor(text, anchor);
    expect(hit?.offset).toBe(text.indexOf("$5"));
  });

  it("counts lines correctly across multiple newlines", () => {
    const text = "one\ntwo\nthree\nfour target here\nfive";
    const hit = resolveAnchor(text, { exact: "target", prefix: "", suffix: "" });
    expect(hit?.line).toBe(4);
  });
});
