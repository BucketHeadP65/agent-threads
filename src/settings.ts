import { type App, PluginSettingTab, Setting, type SettingDefinitionItem } from "obsidian";

import type AgentThreadsPlugin from "./main";
import { type AgentThreadsSettings, DEFAULT_SETTINGS, readSettings } from "./settings-shape";

export type { AgentThreadsSettings };
export { DEFAULT_SETTINGS, readSettings };

const INSTALL_SKILL_NAME = "Install the agent skill";
const INSTALL_SKILL_DESC =
  "When on, every load writes two files into this vault: SKILL.md and scripts/notes.py in the folder .claude/skills/agent-threads. They teach a coding agent opened at the vault root to read and answer note threads. A hand edit to them is overwritten. Turning this off removes nothing.";

export class AgentThreadsSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: AgentThreadsPlugin,
  ) {
    super(app, plugin);
  }

  /** The declarative settings, rendered and searchable on app versions that support them. */
  override getSettingDefinitions(): SettingDefinitionItem[] {
    return [{ name: INSTALL_SKILL_NAME, desc: INSTALL_SKILL_DESC, control: { type: "toggle", key: "installAgentSkill", defaultValue: DEFAULT_SETTINGS.installAgentSkill } }];
  }

  override getControlValue(key: string): unknown {
    return key === "installAgentSkill" ? this.plugin.settings.installAgentSkill : undefined;
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
    if (key === "installAgentSkill" && typeof value === "boolean") await this.setInstallAgentSkill(value);
  }

  /** The same setting drawn by hand, for app versions without declarative settings. */
  override display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName(INSTALL_SKILL_NAME)
      .setDesc(INSTALL_SKILL_DESC)
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.installAgentSkill).onChange((value) => this.setInstallAgentSkill(value)));
  }

  private async setInstallAgentSkill(value: boolean): Promise<void> {
    this.plugin.settings.installAgentSkill = value;
    await this.plugin.saveSettings();
    if (value) await this.plugin.installAgentSkill();
  }
}
