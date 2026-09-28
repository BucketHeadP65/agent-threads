import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, readSettings } from "./settings-shape";

describe("readSettings", () => {
  it("defaults to installing the skill", () => {
    expect(readSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(readSettings(undefined)).toEqual({ installAgentSkill: true });
  });

  it("keeps a stored false", () => {
    expect(readSettings({ installAgentSkill: false })).toEqual({ installAgentSkill: false });
  });

  it("ignores anything that is not a boolean", () => {
    expect(readSettings({ installAgentSkill: "no" })).toEqual({ installAgentSkill: true });
    expect(readSettings("junk")).toEqual({ installAgentSkill: true });
  });
});
