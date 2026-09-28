import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, readSettings } from "./settings-shape";

describe("readSettings", () => {
  it("defaults to not installing the skill", () => {
    expect(readSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(readSettings(undefined)).toEqual({ installAgentSkill: false, skillFolders: "", resolveLinksById: false });
  });

  it("keeps a stored true", () => {
    expect(readSettings({ installAgentSkill: true })).toEqual({ installAgentSkill: true, skillFolders: "", resolveLinksById: false });
  });

  it("keeps a stored false", () => {
    expect(readSettings({ installAgentSkill: false })).toEqual({ installAgentSkill: false, skillFolders: "", resolveLinksById: false });
  });

  it("ignores anything that is not a boolean", () => {
    expect(readSettings({ installAgentSkill: "yes" })).toEqual({ installAgentSkill: false, skillFolders: "", resolveLinksById: false });
    expect(readSettings("junk")).toEqual({ installAgentSkill: false, skillFolders: "", resolveLinksById: false });
  });

  it("keeps a stored folder list", () => {
    expect(readSettings({ installAgentSkill: true, skillFolders: ".claude/skills\ntools/skills" })).toEqual({
      installAgentSkill: true,
      skillFolders: ".claude/skills\ntools/skills",
      resolveLinksById: false,
    });
  });

  it("ignores a folder list that is not a string", () => {
    expect(readSettings({ skillFolders: [".claude/skills"] })).toEqual({ installAgentSkill: false, skillFolders: "", resolveLinksById: false });
  });

  it("defaults to not resolving links by frontmatter id", () => {
    expect(DEFAULT_SETTINGS.resolveLinksById).toBe(false);
    expect(readSettings({}).resolveLinksById).toBe(false);
  });

  it("keeps a stored true for resolving links by frontmatter id", () => {
    expect(readSettings({ resolveLinksById: true })).toEqual({ installAgentSkill: false, skillFolders: "", resolveLinksById: true });
  });

  it("ignores a link resolution value that is not a boolean", () => {
    expect(readSettings({ resolveLinksById: "yes" }).resolveLinksById).toBe(false);
    expect(readSettings({ resolveLinksById: 1 }).resolveLinksById).toBe(false);
  });
});
