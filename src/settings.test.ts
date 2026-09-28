import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, readSettings } from "./settings-shape";

describe("readSettings", () => {
  it("defaults to not installing the skill", () => {
    expect(readSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(readSettings(undefined)).toEqual({ installAgentSkill: false });
  });

  it("keeps a stored true", () => {
    expect(readSettings({ installAgentSkill: true })).toEqual({ installAgentSkill: true });
  });

  it("keeps a stored false", () => {
    expect(readSettings({ installAgentSkill: false })).toEqual({ installAgentSkill: false });
  });

  it("ignores anything that is not a boolean", () => {
    expect(readSettings({ installAgentSkill: "yes" })).toEqual({ installAgentSkill: false });
    expect(readSettings("junk")).toEqual({ installAgentSkill: false });
  });
});
