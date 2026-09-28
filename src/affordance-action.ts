/**
 * The reading-view listener's ownership rule, factored out as a pure
 * decision so it can be unit-tested without a full Obsidian app: `ignore`
 * outside preview mode (ceding ownership to the CM6 extension in
 * editor-extension.ts, so the two never race to decide the button's state),
 * else `hide` for an empty or blank selection and `show` for a non-blank one.
 */

export type AffordanceAction = "show" | "hide" | "ignore";

export interface SelectionState {
  text: string;
  isCollapsed: boolean;
}

export function affordanceAction(mode: "source" | "preview" | null, selection: SelectionState | null): AffordanceAction {
  if (mode !== "preview") return "ignore";
  if (selection === null || selection.isCollapsed || selection.text.trim() === "") return "hide";
  return "show";
}
