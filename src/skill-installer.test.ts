import { describe, expect, it } from "vitest";

import { installSkill, SKILL_DIR } from "./skill-installer";
import type { SidecarAdapter } from "./vault-notes";

/**
 * An in-memory `SidecarAdapter` fake. Files, dirs, and call logs are public,
 * scriptable state. Mirrors the real `DataAdapter.mkdir`, which throws when
 * the target directory already exists rather than silently succeeding.
 */
class FakeSidecarAdapter implements SidecarAdapter {
  readonly files = new Map<string, string>();
  readonly dirs = new Set<string>();
  readonly mkdirCalls: string[] = [];
  readonly writeCalls: string[] = [];
  readonly statCalls: string[] = [];
  readonly mtimes = new Map<string, number>();
  private clock = 0;

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path);
  }

  async read(path: string): Promise<string> {
    const data = this.files.get(path);
    if (data === undefined) throw new Error(`no such file: ${path}`);
    return data;
  }

  async write(path: string, data: string): Promise<void> {
    this.writeCalls.push(path);
    this.files.set(path, data);
    this.mtimes.set(path, ++this.clock);
  }

  async rename(path: string, newPath: string): Promise<void> {
    const data = this.files.get(path);
    if (data === undefined) throw new Error(`no such file: ${path}`);
    this.files.delete(path);
    this.files.set(newPath, data);
    this.mtimes.delete(path);
    this.mtimes.set(newPath, ++this.clock);
  }

  async remove(path: string): Promise<void> {
    if (!this.files.delete(path)) throw new Error(`no such file: ${path}`);
    this.mtimes.delete(path);
  }

  async mkdir(path: string): Promise<void> {
    this.mkdirCalls.push(path);
    if (this.dirs.has(path)) throw new Error(`EEXIST: file already exists, mkdir '${path}'`);
    this.dirs.add(path);
  }

  async stat(path: string): Promise<{ mtime: number } | null> {
    this.statCalls.push(path);
    const mtime = this.mtimes.get(path);
    return mtime === undefined ? null : { mtime };
  }
}

const FILES = [
  { path: `${SKILL_DIR}/SKILL.md`, text: "---\nname: agent-threads\n---\nbody\n" },
  { path: `${SKILL_DIR}/scripts/notes.py`, text: "print('hi')\n" },
];

describe("installSkill", () => {
  it("writes every file and its folders into an empty vault", async () => {
    const adapter = new FakeSidecarAdapter();

    expect(await installSkill(adapter, FILES)).toEqual(FILES.map((file) => file.path));
    expect(adapter.files.get(`${SKILL_DIR}/SKILL.md`)).toBe(FILES[0]?.text);
    expect(adapter.dirs.has(".claude")).toBe(true);
    expect(adapter.dirs.has(`${SKILL_DIR}/scripts`)).toBe(true);
  });

  it("writes nothing when every file already matches", async () => {
    const adapter = new FakeSidecarAdapter();
    await installSkill(adapter, FILES);
    adapter.writeCalls.length = 0;

    expect(await installSkill(adapter, FILES)).toEqual([]);
    expect(adapter.writeCalls).toEqual([]);
  });

  it("rewrites a file whose text differs, and only that one", async () => {
    const adapter = new FakeSidecarAdapter();
    await installSkill(adapter, FILES);
    adapter.files.set(`${SKILL_DIR}/SKILL.md`, "edited by hand");
    adapter.writeCalls.length = 0;

    expect(await installSkill(adapter, FILES)).toEqual([`${SKILL_DIR}/SKILL.md`]);
    expect(adapter.files.get(`${SKILL_DIR}/SKILL.md`)).toBe(FILES[0]?.text);
  });
});
