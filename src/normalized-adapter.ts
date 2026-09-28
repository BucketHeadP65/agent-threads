/**
 * The vault's file adapter with every path passed through `normalizePath`.
 * The plugin reads and writes thread files through the adapter because the
 * vault API does not index dot folders such as `.agent-threads/`.
 */

import { type DataAdapter, normalizePath } from "obsidian";

import type { SidecarAdapter } from "./vault-notes";

/** `adapter` narrowed to what the thread store needs, normalizing each path before the call. */
export function normalizedAdapter(adapter: DataAdapter): SidecarAdapter {
  return {
    exists: (path) => adapter.exists(normalizePath(path)),
    read: (path) => adapter.read(normalizePath(path)),
    write: (path, data) => adapter.write(normalizePath(path), data),
    rename: (path, newPath) => adapter.rename(normalizePath(path), normalizePath(newPath)),
    remove: (path) => adapter.remove(normalizePath(path)),
    mkdir: (path) => adapter.mkdir(normalizePath(path)),
    stat: (path) => adapter.stat(normalizePath(path)),
  };
}
