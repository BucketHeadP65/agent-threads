/// <reference types="node" />

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { automaticRule, KNOWN_AGENTS, type KnownAgent, readFolderList, type RefusalReason, resolveSkillTargets, SHARED_SKILLS_FOLDER, SKILL_NAME } from "./skill-targets";

/** A vault that holds exactly the folders in `folders`, logging every `exists` call. */
class FakeVault {
  readonly existsCalls: string[] = [];

  constructor(readonly folders: ReadonlySet<string> = new Set()) {}

  async exists(path: string): Promise<boolean> {
    this.existsCalls.push(path);
    return this.folders.has(path);
  }
}

const AGENTS: readonly KnownAgent[] = [
  { name: "Claude Code", marker: ".claude", skillsFolder: ".claude/skills" },
  { name: "Agent B", marker: ".agent-b", skillsFolder: ".agent-b/skills" },
  { name: "Agent C", marker: ".agent-c", skillsFolder: ".agent-c/skills" },
];

const SHARED = ".agents/skills/agent-threads";

describe("resolveSkillTargets with an empty folder list", () => {
  it("writes only to the shared folder when no agent folder exists", async () => {
    const vault = new FakeVault();

    expect(await resolveSkillTargets("", vault, AGENTS)).toEqual({ folders: [SHARED], refused: [] });
    expect(vault.existsCalls).toEqual([".claude", ".agent-b", ".agent-c"]);
  });

  it("adds the skills folder of the one agent whose folder exists", async () => {
    const targets = await resolveSkillTargets("", new FakeVault(new Set([".claude"])), AGENTS);

    expect(targets.folders).toEqual([SHARED, ".claude/skills/agent-threads"]);
  });

  it("adds the skills folder of every agent whose folder exists, in table order", async () => {
    const targets = await resolveSkillTargets("", new FakeVault(new Set([".agent-c", ".claude"])), AGENTS);

    expect(targets.folders).toEqual([SHARED, ".claude/skills/agent-threads", ".agent-c/skills/agent-threads"]);
  });

  it("names each folder once when two sources name it", async () => {
    const agents: KnownAgent[] = [
      { name: "Shared reader", marker: ".shared-reader", skillsFolder: SHARED_SKILLS_FOLDER },
      { name: "Agent B", marker: ".agent-b", skillsFolder: ".agent-b/skills" },
      { name: "Agent B fork", marker: ".agent-b-fork", skillsFolder: ".agent-b/skills" },
    ];
    const targets = await resolveSkillTargets("", new FakeVault(new Set([".shared-reader", ".agent-b", ".agent-b-fork"])), agents);

    expect(targets.folders).toEqual([SHARED, ".agent-b/skills/agent-threads"]);
  });

  it("gives Claude Code its own copy only when the vault has .claude", async () => {
    expect((await resolveSkillTargets("", new FakeVault(), KNOWN_AGENTS)).folders).toEqual([SHARED]);
    expect((await resolveSkillTargets("", new FakeVault(new Set([".claude"])), KNOWN_AGENTS)).folders).toEqual([SHARED, ".claude/skills/agent-threads"]);
  });

  it("treats a list of blank lines as empty", async () => {
    expect(await resolveSkillTargets("\n   \n\t\n", new FakeVault(new Set([".claude"])), AGENTS)).toEqual({
      folders: [SHARED, ".claude/skills/agent-threads"],
      refused: [],
    });
  });
});

describe("resolveSkillTargets with a folder list", () => {
  it("replaces the automatic folders entirely, without looking for agent folders", async () => {
    const vault = new FakeVault(new Set([".claude", ".agent-b"]));

    expect(await resolveSkillTargets("tools/skills", vault, AGENTS)).toEqual({ folders: ["tools/skills/agent-threads"], refused: [] });
    expect(vault.existsCalls).toEqual([]);
  });

  it("skips blank lines and keeps the order of the others", async () => {
    const targets = await resolveSkillTargets("\n  \n.claude/skills\n\n\t\n.agents/skills\n", new FakeVault(), AGENTS);

    expect(targets).toEqual({ folders: [".claude/skills/agent-threads", SHARED], refused: [] });
  });

  it("names a folder once when the list names it more than once", async () => {
    const targets = await resolveSkillTargets(".claude/skills\n./.claude//skills/\n.claude\\skills\n.claude/skills", new FakeVault(), AGENTS);

    expect(targets.folders).toEqual([".claude/skills/agent-threads"]);
  });

  it("falls back to the automatic folders when every line is refused, and still reports the refused lines", async () => {
    const targets = await resolveSkillTargets("/etc/skills\n../skills", new FakeVault(new Set([".claude"])), AGENTS);

    expect(targets).toEqual({
      folders: [SHARED, ".claude/skills/agent-threads"],
      refused: [
        { line: "/etc/skills", reason: "absolute" },
        { line: "../skills", reason: "parent" },
      ],
    });
  });

  it("writes to the usable lines and reports the refused ones", async () => {
    const targets = await resolveSkillTargets("tools/skills\n~/skills\nC:\\skills", new FakeVault(), AGENTS);

    expect(targets).toEqual({
      folders: ["tools/skills/agent-threads"],
      refused: [
        { line: "~/skills", reason: "home" },
        { line: "C:\\skills", reason: "drive" },
      ],
    });
  });
});

describe("readFolderList", () => {
  it("cleans up separators and . segments", () => {
    expect(readFolderList("./.claude//skills/").folders).toEqual([".claude/skills"]);
    expect(readFolderList("  .agents\\skills\\  ").folders).toEqual([".agents/skills"]);
    expect(readFolderList("tools/./skills/.").folders).toEqual(["tools/skills"]);
  });

  it("reads Windows line endings", () => {
    expect(readFolderList(".claude/skills\r\ntools/skills\r\n")).toEqual({ folders: [".claude/skills", "tools/skills"], refused: [] });
  });

  it("replaces a non-breaking space and composes accents the way normalizePath does", () => {
    expect(readFolderList("my\u00A0skills/cafe\u0301").folders).toEqual(["my skills/caf\u00E9"]);
  });

  it.each<[string, RefusalReason]>([
    ["/etc/skills", "absolute"],
    ["/", "absolute"],
    ["//server/share/skills", "absolute"],
    ["\\skills", "absolute"],
    ["\\\\server\\share", "absolute"],
    ["~", "home"],
    ["~/skills", "home"],
    ["~other/skills", "home"],
    ["C:", "drive"],
    ["C:/skills", "drive"],
    ["c:\\skills", "drive"],
    ["D:skills", "drive"],
    ["..", "parent"],
    ["../skills", "parent"],
    ["..\\skills", "parent"],
    [".claude/../../skills", "parent"],
    [".claude\\..\\skills", "parent"],
    ["skills/..", "parent"],
    ["skills/ .. /other", "parent"],
    [".", "vault-root"],
    ["./", "vault-root"],
    ["./.", "vault-root"],
  ])("refuses %j as %s", (line, reason) => {
    expect(readFolderList(line)).toEqual({ folders: [], refused: [{ line, reason }] });
  });

  it("keeps names that only contain dots", () => {
    expect(readFolderList("...\n..skills\nskills..\n.agents/skills").folders).toEqual(["...", "..skills", "skills..", ".agents/skills"]);
  });

  it("reports each refused line without the spaces around it, in list order", () => {
    expect(readFolderList("  /abs  \ntools/skills\n\t../up\t")).toEqual({
      folders: ["tools/skills"],
      refused: [
        { line: "/abs", reason: "absolute" },
        { line: "../up", reason: "parent" },
      ],
    });
  });
});

describe("automaticRule", () => {
  it("names only the shared folder when no agent has a row", () => {
    expect(automaticRule([])).toBe("When the list is empty, the skill goes to .agents/skills, which most coding agents read.");
  });

  it("names each agent's folder and marker from the table", () => {
    expect(automaticRule(KNOWN_AGENTS)).toBe(
      "When the list is empty, the skill goes to .agents/skills, which most coding agents read, and to .claude/skills for Claude Code when the vault has a .claude folder.",
    );
  });
});

describe("the README's table of automatic folders", () => {
  const header = "| Folder | When it is written | Read by |";

  function tableRows(): string[] {
    const lines = readFileSync(resolve(__dirname, "../README.md"), "utf-8").split("\n");
    const start = lines.indexOf(header);
    if (start === -1) return [];
    const rows: string[] = [];
    for (const line of lines.slice(start + 2)) {
      if (!line.startsWith("|")) break;
      rows.push(line);
    }
    return rows;
  }

  /** The README row for `agent`, rendered from the same table the plugin reads. */
  function agentRow(agent: KnownAgent): string {
    return `| \`${agent.skillsFolder}/${SKILL_NAME}/\` | When \`${agent.marker}/\` exists at the vault root | ${agent.name} |`;
  }

  it("lists the shared folder first, then one row per known agent", () => {
    const rows = tableRows();

    expect(rows).toHaveLength(1 + KNOWN_AGENTS.length);
    expect(rows[0]?.startsWith(`| \`${SHARED_SKILLS_FOLDER}/${SKILL_NAME}/\` | Always | `)).toBe(true);
    expect(rows.slice(1)).toEqual(KNOWN_AGENTS.map(agentRow));
  });
});
