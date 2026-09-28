import { type App, PluginSettingTab, Setting } from "obsidian";

import type AgentThreadsPlugin from "./main";
import { type AgentThreadsSettings, DEFAULT_SETTINGS, readSettings } from "./settings-shape";

export type { AgentThreadsSettings };
export { DEFAULT_SETTINGS, readSettings };

export class AgentThreadsSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: AgentThreadsPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName("Install the agent skill")
      .setDesc("Writes the agent-threads skill into this vault's .claude/skills folder, so a coding agent opened here knows how to read and answer note threads. The written files are refreshed on every load, edits to them do not survive.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.installAgentSkill).onChange(async (value) => {
          this.plugin.settings.installAgentSkill = value;
          await this.plugin.saveSettings();
          if (value) await this.plugin.installAgentSkill();
        }),
      );
  }
}
