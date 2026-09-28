/**
 * Resolution for links written as a note's id. A link can name a note by its
 * frontmatter `id` or one of its `aliases` rather than by its file name
 * (`[[design-2026-q3]]` for a file named `q3.md`). Obsidian's resolver consults
 * file names only. Frontmatter ids and aliases feed the suggester and search,
 * never resolution. So such a link reads as "not found" and a click creates a
 * blank note.
 * Every surface (clicks in every mode, hover preview, the unresolved
 * styling, the graph) asks one function, `MetadataCache.getFirstLinkpathDest`,
 * so that is what this module wraps: a linkpath Obsidian cannot resolve is
 * answered from an index of every note's frontmatter `id` and `aliases`.
 * The wrap exists only while the owner's setting is on. While it is off, the
 * vault's notes are never listed, nothing is wrapped and nothing listens.
 * The Obsidian side of the host lives in id-link-host.ts.
 */

import { linkIndexOf } from "./link-index";

import type { IndexedPage } from "./link-index";

/** What the resolution needs from Obsidian, narrow enough for a hand-written fake in tests. */
export interface IdLinkHost<F> {
  /** The metadata cache whose `getFirstLinkpathDest` is wrapped. */
  cache: { getFirstLinkpathDest: (linkpath: string, sourcePath: string) => F | null };
  /** Every Markdown note's path, frontmatter `id` and `aliases`. This is the one call that lists the vault's notes. */
  indexedPages(): IndexedPage[];
  /** The file at `path`, or `null` when there is none. */
  fileAt(path: string): F | null;
  /** Calls `listener` after every change that can add, move or remove an id or an alias. Answers the function that stops the calls. */
  onIndexStale(listener: () => void): () => void;
}

/** Link resolution by frontmatter id that can be turned on and off at any time. It does nothing until it is turned on. */
export class IdLinkResolution<F> {
  /** Removes the installed wrap and its listener, or `null` while the resolution is off. */
  private uninstall: (() => void) | null = null;

  constructor(private readonly host: IdLinkHost<F>) {}

  /** Installs the resolution when `enabled` is true and removes it when it is false. A call that matches the current state does nothing. */
  setEnabled(enabled: boolean): void {
    if (enabled && this.uninstall === null) {
      this.uninstall = install(this.host);
    } else if (!enabled && this.uninstall !== null) {
      this.uninstall();
      this.uninstall = null;
    }
  }
}

/**
 * Wraps the host's `getFirstLinkpathDest` so a linkpath naming a note's id or
 * alias resolves to that note whenever Obsidian's own lookup misses. The index
 * is built at the first miss and dropped after every change the host reports.
 * Answers the function that removes the wrap, drops the index and stops listening.
 */
function install<F>(host: IdLinkHost<F>): () => void {
  const cache = host.cache;
  const hadOwnResolver = Object.prototype.hasOwnProperty.call(cache, "getFirstLinkpathDest");
  const previous = cache.getFirstLinkpathDest;
  let installed = true;
  let index: Map<string, string> | null = null;
  const stopListening = host.onIndexStale(() => {
    index = null;
  });
  const wrapped = (linkpath: string, sourcePath: string): F | null => {
    const direct = previous.call(cache, linkpath, sourcePath);
    if (direct !== null || !installed) return direct;
    index ??= linkIndexOf(host.indexedPages());
    const path = index.get(linkpath);
    return path === undefined ? null : host.fileAt(path);
  };
  cache.getFirstLinkpathDest = wrapped;
  return () => {
    installed = false;
    index = null;
    stopListening();
    // A wrap added after this one still calls it, so it stays in that chain and only passes through.
    if (cache.getFirstLinkpathDest !== wrapped) return;
    if (hadOwnResolver) cache.getFirstLinkpathDest = previous;
    else Reflect.deleteProperty(cache, "getFirstLinkpathDest");
  };
}
