export interface AgentThreadsSettings {
  /** Write the agent skill into the vault on load. Off unless the owner turns it on. */
  installAgentSkill: boolean;
  /** The skills folders the owner lists, one per line, relative to the vault root. Empty lets the plugin choose. */
  skillFolders: string;
  /** Open the note whose frontmatter id or aliases match a link that matches no file name. Off unless the owner turns it on. */
  resolveLinksById: boolean;
}

export const DEFAULT_SETTINGS: AgentThreadsSettings = { installAgentSkill: false, skillFolders: "", resolveLinksById: false };

/** The settings `raw` (whatever `loadData` answered) resolves to, unknown or malformed fields at their defaults. */
export function readSettings(raw: unknown): AgentThreadsSettings {
  const settings = { ...DEFAULT_SETTINGS };
  if (typeof raw !== "object" || raw === null) return settings;
  if ("installAgentSkill" in raw) {
    const value = raw.installAgentSkill;
    if (typeof value === "boolean") settings.installAgentSkill = value;
  }
  if ("skillFolders" in raw) {
    const value = raw.skillFolders;
    if (typeof value === "string") settings.skillFolders = value;
  }
  if ("resolveLinksById" in raw) {
    const value = raw.resolveLinksById;
    if (typeof value === "boolean") settings.resolveLinksById = value;
  }
  return settings;
}
