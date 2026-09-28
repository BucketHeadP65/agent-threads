import { type App, PluginSettingTab, Setting, type SettingDefinitionItem } from "obsidian";

import type AgentThreadsPlugin from "./main";
import { type AgentThreadsSettings, DEFAULT_SETTINGS, readSettings } from "./settings-shape";
import { automaticRule, KNOWN_AGENTS, REFUSAL_MESSAGES } from "./skill-targets";

export type { AgentThreadsSettings };
export { DEFAULT_SETTINGS, readSettings };

const INSTALL_SKILL_NAME = "Install the agent skill";
const INSTALL_SKILL_DESC =
  "When on, SKILL.md and scripts/notes.py are written to each folder listed below, at every load and when you close these settings. They teach a coding agent to read and answer note threads. A hand edit to them is overwritten. Turning this off or changing the folders removes nothing, so old copies stay.";
const SKILL_FOLDERS_NAME = "Skill folders";
const SKILL_FOLDERS_DESC = `One folder per line, relative to the vault root, such as .claude/skills. The skill goes into an agent-threads folder inside each one. ${automaticRule(KNOWN_AGENTS)} A line that starts with /, ~ or a drive letter, or has a .. segment, is refused.`;
const SKILL_FOLDERS_PLACEHOLDER = ".claude/skills";
const TARGETS_NAME = "Where the skill goes";
const TARGETS_OFF = 'Nowhere. Turn on "Install the agent skill" to write it.';

export class AgentThreadsSettingTab extends PluginSettingTab {
  /** The row that lists where the skill goes, while it is on screen. */
  private targetsRow: Setting | null = null;
  /** Counts the row's refreshes, so a slow refresh never overwrites a newer one. */
  private targetsTurn = 0;

  constructor(
    app: App,
    private readonly plugin: AgentThreadsPlugin,
  ) {
    super(app, plugin);
  }

  /** The declarative settings, rendered and searchable on app versions that support them. */
  override getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      { name: INSTALL_SKILL_NAME, desc: INSTALL_SKILL_DESC, control: { type: "toggle", key: "installAgentSkill", defaultValue: DEFAULT_SETTINGS.installAgentSkill } },
      {
        name: SKILL_FOLDERS_NAME,
        desc: SKILL_FOLDERS_DESC,
        control: { type: "textarea", key: "skillFolders", defaultValue: DEFAULT_SETTINGS.skillFolders, placeholder: SKILL_FOLDERS_PLACEHOLDER, rows: 4 },
      },
      { name: TARGETS_NAME, searchable: false, render: (row) => this.showTargets(row) },
    ];
  }

  override getControlValue(key: string): unknown {
    if (key === "installAgentSkill") return this.plugin.settings.installAgentSkill;
    if (key === "skillFolders") return this.plugin.settings.skillFolders;
    return undefined;
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
    if (key === "installAgentSkill" && typeof value === "boolean") await this.setInstallAgentSkill(value);
    if (key === "skillFolders" && typeof value === "string") await this.setSkillFolders(value);
  }

  /** The same settings drawn by hand, for app versions without declarative settings. */
  override display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName(INSTALL_SKILL_NAME)
      .setDesc(INSTALL_SKILL_DESC)
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.installAgentSkill).onChange((value) => this.setInstallAgentSkill(value)));
    new Setting(this.containerEl)
      .setName(SKILL_FOLDERS_NAME)
      .setDesc(SKILL_FOLDERS_DESC)
      .addTextArea((area) => area.setPlaceholder(SKILL_FOLDERS_PLACEHOLDER).setValue(this.plugin.settings.skillFolders).onChange((value) => this.setSkillFolders(value)));
    this.showTargets(new Setting(this.containerEl));
  }

  /** Writes the skill when the owner leaves the page, because typing in the folder list writes nothing. */
  override hide(): void {
    super.hide();
    this.targetsRow = null;
    if (this.plugin.settings.installAgentSkill) void this.plugin.installAgentSkill();
  }

  private async setInstallAgentSkill(value: boolean): Promise<void> {
    this.plugin.settings.installAgentSkill = value;
    await this.plugin.saveSettings();
    await this.refreshTargets();
    if (value) await this.plugin.installAgentSkill();
  }

  private async setSkillFolders(value: string): Promise<void> {
    this.plugin.settings.skillFolders = value;
    await this.plugin.saveSettings();
    await this.refreshTargets();
  }

  /** Makes `row` the row that lists where the skill goes and fills it, answering the cleanup that lets it go. */
  private showTargets(row: Setting): () => void {
    row.setName(TARGETS_NAME);
    this.targetsRow = row;
    void this.refreshTargets();
    return () => {
      if (this.targetsRow === row) this.targetsRow = null;
    };
  }

  /** Fills the targets row with the folders the skill goes to now, or says it is off, then each refused line with its reason. */
  private async refreshTargets(): Promise<void> {
    const row = this.targetsRow;
    if (!row) return;
    const turn = ++this.targetsTurn;
    const targets = await this.plugin.skillTargets();
    if (turn !== this.targetsTurn || this.targetsRow !== row) return;
    const installOn = this.plugin.settings.installAgentSkill;
    row.setDesc(
      createFragment((fragment) => {
        if (!installOn) fragment.createDiv({ text: TARGETS_OFF });
        else for (const folder of targets.folders) fragment.createDiv({ text: folder, cls: "agent-threads-skill-folder" });
        for (const refused of targets.refused) {
          fragment.createDiv({ text: `Refused: ${refused.line}. ${REFUSAL_MESSAGES[refused.reason]}`, cls: "agent-threads-refused-folder" });
        }
      }),
    );
  }
}
