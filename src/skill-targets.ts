/**
 * Where the agent skill is written. With an empty folder list, the skill goes to the
 * shared skills folder and to the skills folder of each known agent whose own folder
 * is already in the vault. A folder list with a usable line replaces that choice. A
 * line that could reach outside the vault is refused and never written to.
 */

import type { SidecarAdapter } from "./vault-notes";

/** The folder inside each skills folder that holds the skill's files. */
export const SKILL_NAME = "agent-threads";

/** The project skills folder of the Agent Skills standard, which most coding agents read. */
export const SHARED_SKILLS_FOLDER = ".agents/skills";

/** A coding agent that reads project skills from its own folder and not from the shared one. */
export interface KnownAgent {
  /** The agent's name as its makers write it. */
  name: string;
  /** The folder at the vault root whose presence means the agent is used in the vault. */
  marker: string;
  /** The folder the agent reads project skills from, relative to the vault root. */
  skillsFolder: string;
}

/** The agents that get a copy in their own skills folder. An agent that reads the shared folder has no row. */
export const KNOWN_AGENTS: readonly KnownAgent[] = [{ name: "Claude Code", marker: ".claude", skillsFolder: ".claude/skills" }];

/** Why a line of the folder list is refused. */
export type RefusalReason = "absolute" | "home" | "drive" | "parent" | "vault-root";

/** The sentence the settings page shows after a refused line, one per reason. */
export const REFUSAL_MESSAGES: Readonly<Record<RefusalReason, string>> = {
  absolute: "It is an absolute path.",
  home: "It starts at the home folder.",
  drive: "It starts with a drive letter.",
  parent: "It has a .. segment.",
  "vault-root": "It names the vault root, not a folder in it.",
};

/** A line of the folder list that is refused. */
export interface RefusedLine {
  /** The line as typed, without the spaces around it. */
  line: string;
  reason: RefusalReason;
}

/** The folder list, read one line at a time. */
export interface FolderList {
  /** The usable folders, cleaned up, in the order they first appear, without repeats. */
  folders: string[];
  /** The refused lines, in the order they appear. */
  refused: RefusedLine[];
}

/** Where the skill goes under the current folder list and vault. */
export interface SkillTargets {
  /** The folders the skill's files are written into, each ending in `/agent-threads`, without repeats. */
  folders: string[];
  /** The refused lines of the folder list, in the order they appear. */
  refused: RefusedLine[];
}

/**
 * Reads the folder list, one folder per line, relative to the vault root. Blank lines are
 * skipped. Runs of `/` and `\` become one `/`, and `.` segments are dropped. A line that
 * starts with `/`, `\`, `~` or a drive letter, has a `..` segment, or names the vault
 * root itself is refused.
 */
export function readFolderList(text: string): FolderList {
  const folders: string[] = [];
  const refused: RefusedLine[] = [];
  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (line === "") continue;
    const cleaned = cleanFolder(line);
    if ("reason" in cleaned) refused.push({ line, reason: cleaned.reason });
    else folders.push(cleaned.folder);
  }
  return { folders: unique(folders), refused };
}

/**
 * Resolves the folders the skill is written into. A usable line in `folderList` replaces
 * the automatic folders entirely. Otherwise the skill goes to the shared folder and to the
 * skills folder of each agent in `agents` whose marker folder exists in `vault`.
 */
export async function resolveSkillTargets(folderList: string, vault: Pick<SidecarAdapter, "exists">, agents: readonly KnownAgent[]): Promise<SkillTargets> {
  const { folders, refused } = readFolderList(folderList);
  if (folders.length > 0) return { folders: folders.map(skillFolderIn), refused };
  const automatic = [SHARED_SKILLS_FOLDER];
  for (const agent of agents) {
    if (await vault.exists(agent.marker)) automatic.push(agent.skillsFolder);
  }
  return { folders: unique(automatic).map(skillFolderIn), refused };
}

/** The sentence that says where the skill goes when the folder list is empty, built from `agents`. */
export function automaticRule(agents: readonly KnownAgent[]): string {
  const own = agents.map((agent) => `, and to ${agent.skillsFolder} for ${agent.name} when the vault has a ${agent.marker} folder`);
  return `When the list is empty, the skill goes to ${SHARED_SKILLS_FOLDER}, which most coding agents read${own.join("")}.`;
}

/** The cleaned up folder `line` names, or why it is refused. */
function cleanFolder(line: string): { folder: string } | { reason: RefusalReason } {
  if (/^[\\/]/.test(line)) return { reason: "absolute" };
  if (line.startsWith("~")) return { reason: "home" };
  if (/^[A-Za-z]:/.test(line)) return { reason: "drive" };
  const segments = line.split(/[\\/]+/);
  if (segments.some((segment) => segment.trim() === "..")) return { reason: "parent" };
  const kept = segments.filter((segment) => segment !== "" && segment !== ".");
  if (kept.length === 0) return { reason: "vault-root" };
  return { folder: kept.join("/").replace(/[\u00A0\u202F]/g, " ").normalize("NFC") };
}

function skillFolderIn(skillsFolder: string): string {
  return `${skillsFolder}/${SKILL_NAME}`;
}

function unique(folders: readonly string[]): string[] {
  return [...new Set(folders)];
}
