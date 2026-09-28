/**
 * Writes the agent skill into the vault so a coding agent opened at the vault
 * root finds it under `.claude/skills/agent-threads/`. A file is written when it
 * is missing or its text differs from the bundled text, so an upgrade of the
 * plugin refreshes it and a hand edit does not survive. Nothing is ever removed.
 */

import { ensureDirs, type SidecarAdapter } from "./vault-notes";

export const SKILL_DIR = ".claude/skills/agent-threads";

export interface BundledFile {
  /** Vault-relative path the file is written to. */
  path: string;
  text: string;
}

function parentDir(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/** Writes every file of `files` whose on-disk text differs, answering the paths written. */
export async function installSkill(adapter: SidecarAdapter, files: readonly BundledFile[]): Promise<string[]> {
  const written: string[] = [];
  for (const file of files) {
    if ((await adapter.exists(file.path)) && (await adapter.read(file.path)) === file.text) continue;
    await ensureDirs(adapter, parentDir(file.path));
    await adapter.write(file.path, file.text);
    written.push(file.path);
  }
  return written;
}
