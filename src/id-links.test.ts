import { describe, expect, it } from "vitest";

import { IdLinkResolution } from "./id-links";
import type { IdLinkHost } from "./id-links";
import type { IndexedPage } from "./link-index";

interface FakeFile {
  path: string;
}

type FakeCache = IdLinkHost<FakeFile>["cache"];
type Resolver = FakeCache["getFirstLinkpathDest"];

const PAGES: readonly IndexedPage[] = [
  { path: "q3.md", id: "design-2026-q3", aliases: ["q3-design"] },
  { path: "lineage.md", id: null, aliases: [] },
];

/** A metadata cache that resolves file names only, with its resolver on the prototype as in Obsidian. */
class FileNameCache {
  constructor(private readonly paths: readonly string[]) {}

  getFirstLinkpathDest(linkpath: string): FakeFile | null {
    const path = `${linkpath}.md`;
    return this.paths.includes(path) ? { path } : null;
  }
}

/** A host over `PAGES` that counts how often the notes are listed and holds the listeners attached to it. */
class FakeHost implements IdLinkHost<FakeFile> {
  listings = 0;
  readonly listeners = new Set<() => void>();

  constructor(readonly cache: FakeCache = new FileNameCache(PAGES.map((page) => page.path))) {}

  indexedPages(): IndexedPage[] {
    this.listings += 1;
    return [...PAGES];
  }

  fileAt(path: string): FakeFile | null {
    return PAGES.some((page) => page.path === path) ? { path } : null;
  }

  onIndexStale(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Calls every attached listener, the way a metadata change or a rename does. */
  change(): void {
    for (const listener of this.listeners) listener();
  }

  resolve(linkpath: string): FakeFile | null {
    return this.cache.getFirstLinkpathDest(linkpath, "source.md");
  }
}

function hasOwnResolver(cache: FakeCache): boolean {
  return Object.prototype.hasOwnProperty.call(cache, "getFirstLinkpathDest");
}

describe("IdLinkResolution", () => {
  it("lists no notes, wraps nothing and listens to nothing while off", () => {
    const host = new FakeHost();
    const before = host.cache.getFirstLinkpathDest;
    const resolution = new IdLinkResolution(host);

    resolution.setEnabled(false);

    expect(host.cache.getFirstLinkpathDest).toBe(before);
    expect(hasOwnResolver(host.cache)).toBe(false);
    expect(host.resolve("design-2026-q3")).toBeNull();
    expect(host.listings).toBe(0);
    expect(host.listeners.size).toBe(0);
  });

  it("resolves a link by frontmatter id or alias once on, listing the notes only when no file name matches", () => {
    const host = new FakeHost();
    new IdLinkResolution(host).setEnabled(true);

    expect(host.resolve("q3")).toEqual({ path: "q3.md" });
    expect(host.listings).toBe(0);
    expect(host.resolve("design-2026-q3")).toEqual({ path: "q3.md" });
    expect(host.resolve("q3-design")).toEqual({ path: "q3.md" });
    expect(host.resolve("missing")).toBeNull();
    expect(host.listings).toBe(1);
    expect(host.listeners.size).toBe(1);
  });

  it("lists the notes again after a change", () => {
    const host = new FakeHost();
    new IdLinkResolution(host).setEnabled(true);
    host.resolve("design-2026-q3");

    host.change();
    host.resolve("design-2026-q3");

    expect(host.listings).toBe(2);
  });

  it("puts back the resolver it found, drops the index and stops listening when turned off", () => {
    const host = new FakeHost();
    const before = host.cache.getFirstLinkpathDest;
    const resolution = new IdLinkResolution(host);
    resolution.setEnabled(true);
    host.resolve("design-2026-q3");

    resolution.setEnabled(false);

    expect(host.cache.getFirstLinkpathDest).toBe(before);
    expect(hasOwnResolver(host.cache)).toBe(false);
    expect(host.listeners.size).toBe(0);
    expect(host.resolve("design-2026-q3")).toBeNull();
    expect(host.listings).toBe(1);

    resolution.setEnabled(true);
    host.resolve("design-2026-q3");
    expect(host.listings).toBe(2);
  });

  it("puts back a resolver the cache held as its own property", () => {
    const own: Resolver = () => null;
    const host = new FakeHost({ getFirstLinkpathDest: own });
    const resolution = new IdLinkResolution(host);

    resolution.setEnabled(true);
    resolution.setEnabled(false);

    expect(host.cache.getFirstLinkpathDest).toBe(own);
    expect(hasOwnResolver(host.cache)).toBe(true);
  });

  it("wraps once however often it is turned on", () => {
    const host = new FakeHost();
    const before = host.cache.getFirstLinkpathDest;
    const resolution = new IdLinkResolution(host);

    resolution.setEnabled(true);
    resolution.setEnabled(true);
    expect(host.listeners.size).toBe(1);

    resolution.setEnabled(false);
    expect(host.cache.getFirstLinkpathDest).toBe(before);
  });

  it("leaves a wrap added after its own in place and stops answering ids when turned off", () => {
    const host = new FakeHost();
    const resolution = new IdLinkResolution(host);
    resolution.setEnabled(true);
    const inner = host.cache.getFirstLinkpathDest;
    const outer: Resolver = (linkpath, sourcePath) => inner(linkpath, sourcePath);
    host.cache.getFirstLinkpathDest = outer;

    resolution.setEnabled(false);

    expect(host.cache.getFirstLinkpathDest).toBe(outer);
    expect(host.resolve("q3")).toEqual({ path: "q3.md" });
    expect(host.resolve("design-2026-q3")).toBeNull();
    expect(host.listings).toBe(0);
  });
});
