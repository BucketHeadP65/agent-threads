export interface AgentThreadsSettings {
  /** Write the agent skill into the vault's `.claude/skills/agent-threads/` on load. */
  installAgentSkill: boolean;
}

export const DEFAULT_SETTINGS: AgentThreadsSettings = { installAgentSkill: true };

/** The settings `raw` (whatever `loadData` answered) resolves to, unknown or malformed fields at their defaults. */
export function readSettings(raw: unknown): AgentThreadsSettings {
  const settings = { ...DEFAULT_SETTINGS };
  if (typeof raw === "object" && raw !== null && "installAgentSkill" in raw) {
    const value = (raw as { installAgentSkill: unknown }).installAgentSkill;
    if (typeof value === "boolean") settings.installAgentSkill = value;
  }
  return settings;
}
