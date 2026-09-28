import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SidecarPoller } from "./sidecar-poller";

const INTERVAL_MS = 1000;

function fakeVersions(initial: Record<string, number | null>): {
  readVersion: (path: string) => Promise<number | null>;
  set: (path: string, version: number | null) => void;
} {
  const versions = new Map(Object.entries(initial));
  return {
    readVersion: (path) => Promise.resolve(versions.get(path) ?? null),
    set: (path, version) => versions.set(path, version),
  };
}

describe("SidecarPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires onChanged exactly once when the version bumps between ticks", async () => {
    const { readVersion, set } = fakeVersions({ a: 1 });
    const changes: string[] = [];
    const poller = new SidecarPoller(readVersion, (path) => changes.push(path), INTERVAL_MS);

    poller.setActivePath("a");
    await vi.advanceTimersByTimeAsync(INTERVAL_MS); // establishes the baseline, no fire
    expect(changes).toEqual([]);

    set("a", 2); // an external writer bumps the sidecar
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(changes).toEqual(["a"]);

    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3); // stays at 2, must not fire again
    expect(changes).toEqual(["a"]);

    poller.destroy();
  });

  it("never fires while the version stays the same", async () => {
    const { readVersion } = fakeVersions({ a: 1 });
    const changes: string[] = [];
    const poller = new SidecarPoller(readVersion, (path) => changes.push(path), INTERVAL_MS);

    poller.setActivePath("a");
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 5);

    expect(changes).toEqual([]);
    poller.destroy();
  });

  it("retargets to the new path on switch, dropping the old baseline and its later changes", async () => {
    const { readVersion, set } = fakeVersions({ a: 1, b: 10 });
    const changes: string[] = [];
    const poller = new SidecarPoller(readVersion, (path) => changes.push(path), INTERVAL_MS);

    poller.setActivePath("a");
    await vi.advanceTimersByTimeAsync(INTERVAL_MS); // baseline for "a"

    poller.setActivePath("b");
    set("a", 2); // "a" changes after it's no longer tracked, so it must never fire
    await vi.advanceTimersByTimeAsync(INTERVAL_MS); // baseline for "b", not a fire
    expect(changes).toEqual([]);

    set("b", 11);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(changes).toEqual(["b"]);

    poller.destroy();
  });

  it("stops polling once the active path is cleared", async () => {
    const { readVersion, set } = fakeVersions({ a: 1 });
    const changes: string[] = [];
    const poller = new SidecarPoller(readVersion, (path) => changes.push(path), INTERVAL_MS);

    poller.setActivePath("a");
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    poller.setActivePath(null);
    set("a", 2);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 5);

    expect(changes).toEqual([]);
    poller.destroy();
  });

  it("re-establishes a fresh baseline (no fire) when a path becomes active again after going idle", async () => {
    const { readVersion, set } = fakeVersions({ a: 1 });
    const changes: string[] = [];
    const poller = new SidecarPoller(readVersion, (path) => changes.push(path), INTERVAL_MS);

    poller.setActivePath("a");
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    poller.setActivePath(null);

    set("a", 2); // changes while idle
    poller.setActivePath("a"); // re-activate: this is the new baseline, not a fire
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(changes).toEqual([]);

    set("a", 3);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(changes).toEqual(["a"]);

    poller.destroy();
  });
});
