import { describe, expect, it } from "vitest";

import { DecorationReloader } from "./decoration-reloader";
import { addNote, emptySheet } from "./sidecar";
import type { NoteSheet } from "./sidecar";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("DecorationReloader", () => {
  it("drops a reload whose path went stale before its load resolved, even though it started first", async () => {
    const sheetA = addNote(emptySheet(), { exact: "alpha", prefix: "", suffix: "" }, "note a", "n-a", "2026-01-01T00:00:00Z").sheet;
    const sheetB = addNote(emptySheet(), { exact: "beta", prefix: "", suffix: "" }, "note b", "n-b", "2026-01-01T00:00:00Z").sheet;

    const pending = new Map<string, { promise: Promise<NoteSheet>; resolve: (sheet: NoteSheet) => void }>();
    const reloader = new DecorationReloader((path) => {
      const entry = deferred<NoteSheet>();
      pending.set(path, entry);
      return entry.promise;
    });

    const docText = "alpha beta";

    // First call: tracks "a", starts loading, does not resolve yet.
    reloader.trackedPath = "a";
    const first = reloader.reload(() => docText);

    // Second call: the path moves on to "b" before "a" ever resolves.
    reloader.trackedPath = "b";
    const second = reloader.reload(() => docText);

    // The second call's load resolves first, and commits "beta"'s decoration.
    pending.get("b")?.resolve(sheetB);
    expect(await second).toBe(true);

    // The first call's load resolves after. "a" is stale now, so it must be dropped.
    pending.get("a")?.resolve(sheetA);
    expect(await first).toBe(false);

    const betaStart = docText.indexOf("beta");
    const ranges: Array<{ from: number; to: number }> = [];
    reloader.decorations.between(0, docText.length, (from, to) => {
      ranges.push({ from, to });
    });
    expect(ranges).toEqual([{ from: betaStart, to: betaStart + "beta".length }]);
  });

  it("commits normally when a single reload resolves without a path change", async () => {
    const sheet = addNote(emptySheet(), { exact: "alpha", prefix: "", suffix: "" }, "note a", "n-a", "2026-01-01T00:00:00Z").sheet;
    const reloader = new DecorationReloader(() => Promise.resolve(sheet));
    const docText = "alpha beta";

    reloader.trackedPath = "a";
    expect(await reloader.reload(() => docText)).toBe(true);

    const alphaStart = docText.indexOf("alpha");
    const ranges: Array<{ from: number; to: number }> = [];
    reloader.decorations.between(0, docText.length, (from, to) => {
      ranges.push({ from, to });
    });
    expect(ranges).toEqual([{ from: alphaStart, to: alphaStart + "alpha".length }]);
  });

  it("drops a reload that resolves after destroy", async () => {
    const sheet = addNote(emptySheet(), { exact: "alpha", prefix: "", suffix: "" }, "note a", "n-a", "2026-01-01T00:00:00Z").sheet;
    const entry = deferred<NoteSheet>();
    const reloader = new DecorationReloader(() => entry.promise);
    reloader.trackedPath = "a";

    const pending = reloader.reload(() => "alpha beta");
    reloader.destroy();
    entry.resolve(sheet);

    expect(await pending).toBe(false);
    expect(reloader.decorations.size).toBe(0);
  });
});
