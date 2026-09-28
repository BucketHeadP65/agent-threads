/**
 * The id-and-alias link index, factored out as a pure computation so it can
 * be unit-tested without the Obsidian runtime (see id-links.ts for the
 * resolver wrap it feeds).
 */

export interface IndexedPage {
  path: string;
  id: string | null;
  aliases: string[];
}

/** File path by frontmatter `id` and by each alias, ids winning over aliases and the first page winning a duplicate. */
export function linkIndexOf(pages: IndexedPage[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const page of pages) {
    if (page.id !== null && page.id !== "" && !index.has(page.id)) index.set(page.id, page.path);
  }
  for (const page of pages) {
    for (const alias of page.aliases) {
      if (alias !== "" && !index.has(alias)) index.set(alias, page.path);
    }
  }
  return index;
}
