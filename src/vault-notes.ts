/**
 * The Obsidian-facing sidecar store: read-modify-write against the freshest
 * on-disk sidecar, one mutation at a time per file.
 *
 * A thread file lives at `<home>/.agent-threads/<path-under-home>.threads.json`.
 * The home is the nearest ancestor folder of the file that holds a
 * `.agent-threads` folder, or the vault root when no ancestor holds one. A
 * project inside the vault can hold its own `.agent-threads` folder, so a tool
 * opened at that project reads and writes the very same file. A read tries the
 * resolved home first, then every other possible home (a thread file written
 * before a nearer `.agent-threads` appeared). A write always lands at the
 * resolved home.
 *
 * A brand-new thread file is written through a temp file renamed into place. An
 * existing one is overwritten in place, because the vault adapter refuses to
 * rename over a file that exists.
 *
 * Every mutation for a given file is queued behind the previous one so two
 * owner actions in quick succession (e.g. resolve then delete) can never race
 * each other's read-modify-write.
 */

import type { NoteAnchor } from "./anchors";
import type { Author, Note, NoteSheet, Status } from "./sidecar";
import { addNote, addReply, editReply, emptySheet, mintId, parseSheet, removeNote, replaceNote, serializeSheet, setStatus } from "./sidecar";

/** The slice of Obsidian's `DataAdapter` this module needs, narrow enough for a hand-written fake in tests. */
export interface SidecarAdapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  rename(path: string, newPath: string): Promise<void>;
  remove(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  stat(path: string): Promise<{ mtime: number } | null>;
}

const THREADS_DIR = ".agent-threads";
const THREADS_SUFFIX = ".threads.json";

interface SidecarHome {
  /** The `.agent-threads` folder that marks this home, vault-relative (`.agent-threads` at the root). */
  threadsDir: string;
  /** Where the file's sidecar sits under this home. */
  path: string;
}

/** Every home that could hold `filePath`'s sidecar, nearest ancestor first, the vault root last. */
function homesFor(filePath: string): SidecarHome[] {
  const segments = filePath.split("/");
  const homes: SidecarHome[] = [];
  for (let depth = segments.length - 1; depth >= 0; depth -= 1) {
    const base = segments.slice(0, depth).join("/");
    const rel = segments.slice(depth).join("/");
    const prefix = base === "" ? "" : `${base}/`;
    homes.push({ threadsDir: `${prefix}${THREADS_DIR}`, path: `${prefix}${THREADS_DIR}/${rel}${THREADS_SUFFIX}` });
  }
  return homes;
}

/** `<vault-root>/.agent-threads/<file-path>.threads.json`, the vault-root home, mirroring the file's own relative path. */
export function notesPath(filePath: string): string {
  return `${THREADS_DIR}/${filePath}${THREADS_SUFFIX}`;
}

/**
 * The sidecar path `filePath` resolves to: under the nearest ancestor that
 * holds a `.agent-threads` folder, else under the vault root.
 */
export async function resolveNotesPath(adapter: SidecarAdapter, filePath: string): Promise<string> {
  for (const home of homesFor(filePath)) {
    if (await adapter.exists(home.threadsDir)) return home.path;
  }
  return notesPath(filePath);
}

/** True when `modifiedPath` is `filePath`'s sidecar at any possible home. */
export function isSidecarFor(filePath: string, modifiedPath: string): boolean {
  return homesFor(filePath).some((home) => home.path === modifiedPath);
}

/**
 * `filePath`'s sidecar's last-modified time, for polling an external writer
 * (the vault's own "modify" event never fires under `.agent-threads/`): the resolved
 * home's mtime when the sidecar is there, else the first other home that
 * holds one, else `null`.
 */
export async function sidecarMtime(adapter: SidecarAdapter, filePath: string): Promise<number | null> {
  for (const path of await readOrder(adapter, filePath)) {
    const found = await adapter.stat(path);
    if (found !== null) return found.mtime;
  }
  return null;
}

/** The paths a read consults, in order: the resolved home, every other home. */
async function readOrder(adapter: SidecarAdapter, filePath: string): Promise<string[]> {
  const resolved = await resolveNotesPath(adapter, filePath);
  const others = homesFor(filePath)
    .map((home) => home.path)
    .filter((path) => path !== resolved);
  return [resolved, ...others];
}

function parentDir(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

const pendingByPath = new Map<string, Promise<unknown>>();

async function readSheet(adapter: SidecarAdapter, filePath: string): Promise<NoteSheet> {
  for (const path of await readOrder(adapter, filePath)) {
    if (await adapter.exists(path)) return parseSheet(await adapter.read(path));
  }
  return emptySheet();
}

async function writeSheet(adapter: SidecarAdapter, filePath: string, sheet: NoteSheet): Promise<void> {
  const path = await resolveNotesPath(adapter, filePath);
  const data = serializeSheet(sheet);
  if (await adapter.exists(path)) {
    await adapter.write(path, data);
  } else {
    await ensureDirs(adapter, parentDir(path));
    const tempPath = `${path}.${mintId()}.tmp`;
    try {
      await adapter.write(tempPath, data);
      await renameOnto(adapter, tempPath, path);
    } catch (error) {
      await adapter.remove(tempPath).catch(() => undefined);
      throw error;
    }
  }
}

/**
 * Creates `dir` and every missing ancestor, root-most first. `DataAdapter.mkdir`
 * throws on a directory that already exists, so each level is checked first
 * and a throw is swallowed as long as the directory exists afterward.
 */
export async function ensureDirs(adapter: SidecarAdapter, dir: string): Promise<void> {
  if (dir === "") return;
  const segments = dir.split("/");
  for (let depth = 1; depth <= segments.length; depth += 1) {
    const level = segments.slice(0, depth).join("/");
    if (await adapter.exists(level)) continue;
    try {
      await adapter.mkdir(level);
    } catch (error) {
      if (!(await adapter.exists(level))) throw error;
    }
  }
}

/**
 * Renames `tempPath` onto `path`, clearing an existing `path` first if the
 * adapter refuses to rename over one rather than replacing it in place.
 */
async function renameOnto(adapter: SidecarAdapter, tempPath: string, path: string): Promise<void> {
  try {
    await adapter.rename(tempPath, path);
  } catch (error) {
    if (!(await adapter.exists(path))) throw error;
    await adapter.remove(path);
    await adapter.rename(tempPath, path);
  }
}

/** Runs `mutate` against `filePath`'s freshest sheet and writes the result back, one at a time per path. */
function withSheet<T>(adapter: SidecarAdapter, filePath: string, mutate: (sheet: NoteSheet) => { sheet: NoteSheet; result: T }): Promise<T> {
  const previous = pendingByPath.get(filePath) ?? Promise.resolve();
  const next = previous.then(async () => {
    const current = await readSheet(adapter, filePath);
    const { sheet, result } = mutate(current);
    await writeSheet(adapter, filePath, sheet);
    return result;
  });
  pendingByPath.set(
    filePath,
    next.catch(() => undefined),
  );
  return next;
}

export function loadNotes(adapter: SidecarAdapter, filePath: string): Promise<NoteSheet> {
  return readSheet(adapter, filePath);
}

export function createNote(adapter: SidecarAdapter, filePath: string, anchor: NoteAnchor, text: string): Promise<Note> {
  return withSheet(adapter, filePath, (sheet) => {
    const { sheet: next, note } = addNote(sheet, anchor, text);
    return { sheet: next, result: note };
  });
}

export function editNote(adapter: SidecarAdapter, filePath: string, noteId: string, text: string): Promise<Note> {
  return withSheet(adapter, filePath, (sheet) => {
    const { sheet: next, note } = replaceNote(sheet, noteId, { text });
    return { sheet: next, result: note };
  });
}

export function editNoteReply(adapter: SidecarAdapter, filePath: string, noteId: string, replyIndex: number, text: string): Promise<Note> {
  return withSheet(adapter, filePath, (sheet) => {
    const { sheet: next, note } = editReply(sheet, noteId, replyIndex, text);
    return { sheet: next, result: note };
  });
}

export function deleteNote(adapter: SidecarAdapter, filePath: string, noteId: string): Promise<void> {
  return withSheet(adapter, filePath, (sheet) => ({ sheet: removeNote(sheet, noteId), result: undefined }));
}

export function replyToNote(adapter: SidecarAdapter, filePath: string, noteId: string, author: Author, text: string): Promise<Note> {
  return withSheet(adapter, filePath, (sheet) => {
    const { sheet: next, note } = addReply(sheet, noteId, author, text);
    return { sheet: next, result: note };
  });
}

export function setNoteStatus(adapter: SidecarAdapter, filePath: string, noteId: string, status: Status): Promise<Note> {
  return withSheet(adapter, filePath, (sheet) => {
    const { sheet: next, note } = setStatus(sheet, noteId, status);
    return { sheet: next, result: note };
  });
}
