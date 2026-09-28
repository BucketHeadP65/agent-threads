/**
 * The Obsidian side of link resolution by frontmatter id (see id-links.ts):
 * the vault's Markdown notes with their ids and aliases, a file by its path,
 * and the events after which the index is dropped. Building the host lists
 * nothing. The notes are listed only when `indexedPages` is called.
 */

import { type App, parseFrontMatterAliases, TFile } from "obsidian";

import type { IdLinkHost } from "./id-links";
import type { IndexedPage } from "./link-index";

/** Every Markdown note of the vault with its frontmatter `id` and `aliases`, read from the metadata cache. */
function indexedPages(app: App): IndexedPage[] {
  return app.vault.getMarkdownFiles().map((file) => {
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
    const id: unknown = frontmatter?.id;
    return {
      path: file.path,
      id: typeof id === "string" ? id : null,
      aliases: frontmatter ? (parseFrontMatterAliases(frontmatter) ?? []) : [],
    };
  });
}

/** The host that link resolution by frontmatter id runs against in `app`. */
export function idLinkHost(app: App): IdLinkHost<TFile> {
  const { metadataCache, vault } = app;
  return {
    cache: metadataCache,
    indexedPages: () => indexedPages(app),
    fileAt: (path) => {
      const file = vault.getAbstractFileByPath(path);
      return file instanceof TFile ? file : null;
    },
    onIndexStale: (listener) => {
      const cacheRefs = [metadataCache.on("changed", listener), metadataCache.on("deleted", listener)];
      const vaultRefs = [vault.on("rename", listener), vault.on("delete", listener)];
      return () => {
        for (const ref of cacheRefs) metadataCache.offref(ref);
        for (const ref of vaultRefs) vault.offref(ref);
      };
    },
  };
}
