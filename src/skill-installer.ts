/**
 * Writes the agent skill into folders of the vault. A file is written when it is missing
 * or its text differs from the bundled text, so an upgrade of the plugin refreshes it and
 * a hand edit does not survive. Nothing is ever removed.
 */

import { ensureDirs, type SidecarAdapter } from "./vault-notes";

export interface BundledFile {
  /** Where the file sits inside the skill's folder, such as `scripts/notes.py`. */
  path: string;
  text: string;
}

/** What one install wrote and what it could not write. */
export interface InstallReport {
  /** The folders where at least one file was written. */
  written: string[];
  /** The folders a write failed in, each with the error's message. */
  failed: { folder: string; message: string }[];
}

function parentDir(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/** Writes every file of `files` into every folder of `folders` where its text differs. A failure in one folder does not stop the others. */
export async function installSkill(adapter: SidecarAdapter, folders: readonly string[], files: readonly BundledFile[]): Promise<InstallReport> {
  const report: InstallReport = { written: [], failed: [] };
  for (const folder of folders) {
    try {
      if (await writeChangedFiles(adapter, folder, files)) report.written.push(folder);
    } catch (error) {
      report.failed.push({ folder, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return report;
}

/** Writes each file of `files` under `folder` whose text differs, answering whether any was written. */
async function writeChangedFiles(adapter: SidecarAdapter, folder: string, files: readonly BundledFile[]): Promise<boolean> {
  let wrote = false;
  for (const file of files) {
    const path = `${folder}/${file.path}`;
    if ((await adapter.exists(path)) && (await adapter.read(path)) === file.text) continue;
    await ensureDirs(adapter, parentDir(path));
    await adapter.write(path, file.text);
    wrote = true;
  }
  return wrote;
}
