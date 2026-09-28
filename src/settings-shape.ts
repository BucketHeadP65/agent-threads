export interface AgentThreadsSettings {
  /** Write the agent skill into the vault's `.claude/skills/agent-threads/` on load. Off unless the owner turns it on. */
  installAgentSkill: boolean;
}

export const DEFAULT_SETTINGS: AgentThreadsSettings = { installAgentSkill: false };

/** The settings `raw` (whatever `loadData` answered) resolves to, unknown or malformed fields at their defaults. */
export function readSettings(raw: unknown): AgentThreadsSettings {
  const settings = { ...DEFAULT_SETTINGS };
  if (typeof raw === "object" && raw !== null && "installAgentSkill" in raw) {
    const value = raw.installAgentSkill;
    if (typeof value === "boolean") settings.installAgentSkill = value;
  }
  return settings;
}
