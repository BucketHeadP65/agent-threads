/** The skill files the plugin carries, bundled as text from the repository's `skills/agent-threads/` folder at build time. */

import type { BundledFile } from "./skill-installer";
import { SKILL_DIR } from "./skill-installer";
import notesScript from "../skills/agent-threads/scripts/notes.py";
import skillText from "../skills/agent-threads/SKILL.md";

export const BUNDLED_SKILL: readonly BundledFile[] = [
  { path: `${SKILL_DIR}/SKILL.md`, text: skillText },
  { path: `${SKILL_DIR}/scripts/notes.py`, text: notesScript },
];
