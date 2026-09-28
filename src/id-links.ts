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
 * The wrap is removed on plugin unload.
 */

import { parseFrontMatterAliases, TFile } from "obsidian";

import type AgentThreadsPlugin from "./main";

import { linkIndexOf } from "./link-index";

import type { IndexedPage } from "./link-index";

function indexedPages(plugin: AgentThreadsPlugin): IndexedPage[] {
  return plugin.app.vault.getMarkdownFiles().map((file) => {
    const frontmatter = plugin.app.metadataCache.getFileCache(file)?.frontmatter;
    const id: unknown = frontmatter?.id;
    return {
      path: file.path,
      id: typeof id === "string" ? id : null,
      aliases: frontmatter ? (parseFrontMatterAliases(frontmatter) ?? []) : [],
    };
  });
}

/**
 * Wraps `metadataCache.getFirstLinkpathDest` so a linkpath naming a note's
 * id or alias resolves to that note whenever Obsidian's own lookup misses.
 * The index is rebuilt lazily after any metadata change, delete, or rename.
 */
export function installIdLinkResolution(plugin: AgentThreadsPlugin): void {
  const cache = plugin.app.metadataCache;
  let index: Map<string, string> | null = null;
  const invalidate = (): void => {
    index = null;
  };
  plugin.registerEvent(cache.on("changed", invalidate));
  plugin.registerEvent(cache.on("deleted", invalidate));
  plugin.registerEvent(plugin.app.vault.on("rename", invalidate));
  plugin.registerEvent(plugin.app.vault.on("delete", invalidate));

  const original = cache.getFirstLinkpathDest.bind(cache);
  cache.getFirstLinkpathDest = (linkpath: string, sourcePath: string): TFile | null => {
    const direct = original(linkpath, sourcePath);
    if (direct !== null) return direct;
    index ??= linkIndexOf(indexedPages(plugin));
    const path = index.get(linkpath);
    if (path === undefined) return null;
    const file = plugin.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? file : null;
  };
  plugin.register(() => {
    cache.getFirstLinkpathDest = original;
  });
}
