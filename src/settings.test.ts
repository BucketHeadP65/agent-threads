import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, readSettings } from "./settings-shape";

describe("readSettings", () => {
  it("defaults to not installing the skill", () => {
    expect(readSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(readSettings(undefined)).toEqual({ installAgentSkill: false, skillFolders: "" });
  });

  it("keeps a stored true", () => {
    expect(readSettings({ installAgentSkill: true })).toEqual({ installAgentSkill: true, skillFolders: "" });
  });

  it("keeps a stored false", () => {
    expect(readSettings({ installAgentSkill: false })).toEqual({ installAgentSkill: false, skillFolders: "" });
  });

  it("ignores anything that is not a boolean", () => {
    expect(readSettings({ installAgentSkill: "yes" })).toEqual({ installAgentSkill: false, skillFolders: "" });
    expect(readSettings("junk")).toEqual({ installAgentSkill: false, skillFolders: "" });
  });

  it("keeps a stored folder list", () => {
    expect(readSettings({ installAgentSkill: true, skillFolders: ".claude/skills\ntools/skills" })).toEqual({
      installAgentSkill: true,
      skillFolders: ".claude/skills\ntools/skills",
    });
  });

  it("ignores a folder list that is not a string", () => {
    expect(readSettings({ skillFolders: [".claude/skills"] })).toEqual({ installAgentSkill: false, skillFolders: "" });
  });
});
