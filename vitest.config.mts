import { defineConfig } from "vitest/config";

// Pure logic runs under vitest: sidecar.ts, the notes.py cross-check, anchors.ts, sidecar-poller.ts, and
// the decision/mapping helpers factored out of the Obsidian-facing modules
// (reading-view.ts's affordanceAction, vault-notes.ts's path mapping,
// note-decorations.ts's range resolution). The Obsidian API wiring itself
// (main.ts, view.ts, editor-extension.ts, and the DOM/CM6/vault plumbing in the
// other three) stays thin and untested.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test-support/obsidian-dom.ts"],
  },
});
