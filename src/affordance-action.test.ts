import { describe, expect, it } from "vitest";

import { affordanceAction } from "./affordance-action";

describe("affordanceAction", () => {
  it("ignores editing mode (source) regardless of selection, ceding ownership to the CM6 extension", () => {
    expect(affordanceAction("source", { text: "some text", isCollapsed: false })).toBe("ignore");
    expect(affordanceAction("source", null)).toBe("ignore");
    expect(affordanceAction("source", { text: "", isCollapsed: true })).toBe("ignore");
  });

  it("ignores when there is no active markdown view", () => {
    expect(affordanceAction(null, { text: "some text", isCollapsed: false })).toBe("ignore");
  });

  it("hides in preview mode when there is no selection", () => {
    expect(affordanceAction("preview", null)).toBe("hide");
  });

  it("hides in preview mode when the selection is collapsed", () => {
    expect(affordanceAction("preview", { text: "some text", isCollapsed: true })).toBe("hide");
  });

  it("hides in preview mode when the selected text is blank", () => {
    expect(affordanceAction("preview", { text: "   ", isCollapsed: false })).toBe("hide");
  });

  it("shows in preview mode for a non-blank, non-collapsed selection", () => {
    expect(affordanceAction("preview", { text: "some text", isCollapsed: false })).toBe("show");
  });
});
