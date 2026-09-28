import { describe, expect, it } from "vitest";

import { installSkill } from "./skill-installer";
import { KNOWN_AGENTS, resolveSkillTargets } from "./skill-targets";
import type { SidecarAdapter } from "./vault-notes";

/**
 * An in-memory `SidecarAdapter` fake. Files, dirs, and call logs are public,
 * scriptable state. Mirrors the real `DataAdapter.mkdir`, which throws when
 * the target directory already exists rather than silently succeeding. A
 * write under a folder in `failingFolders` throws.
 */
class FakeSidecarAdapter implements SidecarAdapter {
  readonly files = new Map<string, string>();
  readonly dirs = new Set<string>();
  readonly failingFolders = new Set<string>();
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
    for (const folder of this.failingFolders) {
      if (path.startsWith(`${folder}/`)) throw new Error(`EACCES: permission denied, open '${path}'`);
    }
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

const FOLDER = ".agents/skills/agent-threads";

const FILES = [
  { path: "SKILL.md", text: "---\nname: agent-threads\n---\nbody\n" },
  { path: "scripts/notes.py", text: "print('hi')\n" },
];

describe("installSkill", () => {
  it("writes every file and its folders into an empty vault", async () => {
    const adapter = new FakeSidecarAdapter();

    expect(await installSkill(adapter, [FOLDER], FILES)).toEqual({ written: [FOLDER], failed: [] });
    expect(adapter.writeCalls).toEqual([`${FOLDER}/SKILL.md`, `${FOLDER}/scripts/notes.py`]);
    expect(adapter.files.get(`${FOLDER}/SKILL.md`)).toBe(FILES[0]?.text);
    expect(adapter.dirs.has(".agents")).toBe(true);
    expect(adapter.dirs.has(`${FOLDER}/scripts`)).toBe(true);
  });

  it("writes nothing when every file already matches", async () => {
    const adapter = new FakeSidecarAdapter();
    await installSkill(adapter, [FOLDER], FILES);
    adapter.writeCalls.length = 0;

    expect(await installSkill(adapter, [FOLDER], FILES)).toEqual({ written: [], failed: [] });
    expect(adapter.writeCalls).toEqual([]);
  });

  it("rewrites a file whose text differs, and only that one", async () => {
    const adapter = new FakeSidecarAdapter();
    await installSkill(adapter, [FOLDER], FILES);
    adapter.files.set(`${FOLDER}/SKILL.md`, "edited by hand");
    adapter.writeCalls.length = 0;

    expect(await installSkill(adapter, [FOLDER], FILES)).toEqual({ written: [FOLDER], failed: [] });
    expect(adapter.writeCalls).toEqual([`${FOLDER}/SKILL.md`]);
    expect(adapter.files.get(`${FOLDER}/SKILL.md`)).toBe(FILES[0]?.text);
  });

  it("writes both files into every resolved folder and nowhere else", async () => {
    const adapter = new FakeSidecarAdapter();
    adapter.dirs.add(".claude");
    const targets = await resolveSkillTargets("", adapter, KNOWN_AGENTS);

    expect(await installSkill(adapter, targets.folders, FILES)).toEqual({ written: [FOLDER, ".claude/skills/agent-threads"], failed: [] });
    expect([...adapter.files.keys()].sort()).toEqual([
      ".agents/skills/agent-threads/SKILL.md",
      ".agents/skills/agent-threads/scripts/notes.py",
      ".claude/skills/agent-threads/SKILL.md",
      ".claude/skills/agent-threads/scripts/notes.py",
    ]);
    expect([...adapter.dirs].sort()).toEqual([
      ".agents",
      ".agents/skills",
      ".agents/skills/agent-threads",
      ".agents/skills/agent-threads/scripts",
      ".claude",
      ".claude/skills",
      ".claude/skills/agent-threads",
      ".claude/skills/agent-threads/scripts",
    ]);
  });

  it("writes only into the listed folders when the list has a usable line", async () => {
    const adapter = new FakeSidecarAdapter();
    adapter.dirs.add(".claude");
    const targets = await resolveSkillTargets("tools/skills\n../outside", adapter, KNOWN_AGENTS);

    expect(await installSkill(adapter, targets.folders, FILES)).toEqual({ written: ["tools/skills/agent-threads"], failed: [] });
    expect([...adapter.files.keys()].sort()).toEqual(["tools/skills/agent-threads/SKILL.md", "tools/skills/agent-threads/scripts/notes.py"]);
    expect(adapter.mkdirCalls).toEqual(["tools", "tools/skills", "tools/skills/agent-threads", "tools/skills/agent-threads/scripts"]);
  });

  it("keeps writing the other folders when one folder fails", async () => {
    const adapter = new FakeSidecarAdapter();
    adapter.failingFolders.add(".claude/skills/agent-threads");

    expect(await installSkill(adapter, [".claude/skills/agent-threads", FOLDER], FILES)).toEqual({
      written: [FOLDER],
      failed: [{ folder: ".claude/skills/agent-threads", message: "EACCES: permission denied, open '.claude/skills/agent-threads/SKILL.md'" }],
    });
    expect([...adapter.files.keys()].sort()).toEqual([`${FOLDER}/SKILL.md`, `${FOLDER}/scripts/notes.py`]);
  });
});
