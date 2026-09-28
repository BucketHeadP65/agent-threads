// @vitest-environment jsdom
import type { MarkdownPostProcessor, MarkdownPostProcessorContext, MarkdownSectionInformation } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { refreshReadingMarks, registerReadingMarks } from "./reading-marks";
import type { ReadingMarksPlugin, ReadingPane } from "./reading-marks";
import { sectionLines, stampSection } from "./section-stamps";
import { addNote, emptySheet } from "./sidecar";
import type { NoteAnchor } from "./anchors";

const SOURCE = "alpha beta\n\nalpha beta\n\ngamma\n";

function sheetWith(anchor: NoteAnchor, id = "n1") {
  return addNote(emptySheet(), anchor, "note", id, "2026-01-01T00:00:00Z").sheet;
}

function fakeContext(sourcePath: string, info: MarkdownSectionInformation | null): MarkdownPostProcessorContext {
  return { docId: "doc", sourcePath, frontmatter: null, addChild: () => undefined, getSectionInfo: () => info };
}

function fakePlugin(overrides: Partial<ReadingMarksPlugin> = {}): ReadingMarksPlugin {
  return {
    loadNotesFor: () => Promise.resolve(emptySheet()),
    revealNotesView: () => Promise.resolve(),
    registerMarkdownPostProcessor: () => undefined,
    readingPanes: () => [],
    openThread: () => undefined,
    ...overrides,
  };
}

/** A fake plugin that captures the post processor `registerReadingMarks` registers, so a test can run it per section. */
function capturingPlugin(overrides: Partial<ReadingMarksPlugin> = {}): {
  plugin: ReadingMarksPlugin;
  run: (element: HTMLElement, sourcePath: string, info: MarkdownSectionInformation | null) => Promise<void>;
} {
  const captured: { processor: MarkdownPostProcessor | null } = { processor: null };
  const plugin = fakePlugin({
    registerMarkdownPostProcessor: (processor) => {
      captured.processor = processor;
    },
    ...overrides,
  });
  return {
    plugin,
    run: async (element, sourcePath, info) => {
      await captured.processor?.(element, fakeContext(sourcePath, info));
    },
  };
}

function paragraphSection(text: string): HTMLElement {
  const section = createDiv();
  const p = createEl("p");
  p.textContent = text;
  section.append(p);
  return section;
}

function marksOf(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll(".agent-thread-mark")).map((mark) => mark.textContent ?? "");
}

describe("registerReadingMarks", () => {
  it("stamps each section with the source lines it renders", async () => {
    const { plugin, run } = capturingPlugin();
    registerReadingMarks(plugin);
    const section = paragraphSection("alpha beta");

    await run(section, "notes.md", { text: SOURCE, lineStart: 2, lineEnd: 2 });

    expect(sectionLines(section)).toEqual({ lineStart: 2, lineEnd: 2 });
  });

  it("marks only the section whose source lines hold the note when its text repeats in another section", async () => {
    const sheet = sheetWith({ exact: "alpha beta", prefix: "", suffix: "\n\ngamma" });
    const { plugin, run } = capturingPlugin({ loadNotesFor: () => Promise.resolve(sheet) });
    registerReadingMarks(plugin);
    const first = paragraphSection("alpha beta");
    const second = paragraphSection("alpha beta");

    await run(first, "notes.md", { text: SOURCE, lineStart: 0, lineEnd: 0 });
    await run(second, "notes.md", { text: SOURCE, lineStart: 2, lineEnd: 2 });

    expect(marksOf(first)).toEqual([]);
    expect(marksOf(second)).toEqual(["alpha beta"]);
  });

  it("marks a note through a bold close and into a list item, section by section", async () => {
    const source = "Intro.\n\n**Verify at work.**\n\n1. Graph delta semantics per item: does it?\n2. Delta token lifetime.\n";
    const sheet = sheetWith({ exact: "Verify at work.**\n\n1. Graph delta semantics per item: does it?", prefix: "Intro.\n\n**", suffix: "\n2. Delta token" });
    const { plugin, run } = capturingPlugin({ loadNotesFor: () => Promise.resolve(sheet) });
    registerReadingMarks(plugin);
    const boldSection = createDiv();
    const p = createEl("p");
    const strong = createEl("strong");
    strong.textContent = "Verify at work.";
    p.append(strong);
    boldSection.append(p);
    const listSection = createDiv();
    const ol = createEl("ol");
    for (const item of ["Graph delta semantics per item: does it?", "Delta token lifetime."]) {
      const li = createEl("li");
      li.textContent = item;
      ol.append(li);
    }
    listSection.append(ol);

    await run(boldSection, "notes.md", { text: source, lineStart: 2, lineEnd: 2 });
    await run(listSection, "notes.md", { text: source, lineStart: 4, lineEnd: 5 });

    expect(marksOf(boldSection)).toEqual(["Verify at work."]);
    expect(marksOf(listSection)).toEqual(["Graph delta semantics per item: does it?"]);
    expect(listSection.textContent).toBe("Graph delta semantics per item: does it?Delta token lifetime.");
  });

  it("leaves a section without source information untouched", async () => {
    const sheet = sheetWith({ exact: "alpha beta", prefix: "", suffix: "\n\ngamma" });
    const { plugin, run } = capturingPlugin({ loadNotesFor: () => Promise.resolve(sheet) });
    registerReadingMarks(plugin);
    const section = paragraphSection("alpha beta");

    await run(section, "notes.md", null);

    expect(marksOf(section)).toEqual([]);
    expect(sectionLines(section)).toBeNull();
  });

  it("leaves the section untouched when the file has no notes", async () => {
    const { plugin, run } = capturingPlugin({ loadNotesFor: () => Promise.resolve(emptySheet()) });
    registerReadingMarks(plugin);
    const section = paragraphSection("alpha beta");

    await run(section, "empty.md", { text: SOURCE, lineStart: 0, lineEnd: 0 });

    expect(marksOf(section)).toEqual([]);
  });

  it("opens the notes view and the note's thread when a mark is clicked", async () => {
    const sheet = sheetWith({ exact: "gamma", prefix: "", suffix: "" });
    const reveal = vi.fn(() => Promise.resolve());
    const openThread = vi.fn();
    const { plugin, run } = capturingPlugin({ loadNotesFor: () => Promise.resolve(sheet), revealNotesView: reveal, openThread });
    registerReadingMarks(plugin);
    const section = paragraphSection("gamma");

    await run(section, "notes.md", { text: SOURCE, lineStart: 4, lineEnd: 4 });
    const mark = section.querySelector<HTMLElement>(".agent-thread-mark");
    expect(mark?.dataset.agentThreadId).toBe("n1");
    mark?.click();

    expect(reveal).toHaveBeenCalledOnce();
    expect(openThread).toHaveBeenCalledOnce();
    expect(openThread.mock.calls[0]?.[0]).toBe("notes.md");
    expect(openThread.mock.calls[0]?.[1]).toBe("n1");
  });
});

describe("refreshReadingMarks", () => {
  /** A preview pane whose three sections were rendered (and stamped) from SOURCE. */
  function fakePane(overrides: Partial<ReadingPane> = {}): { pane: ReadingPane; root: HTMLElement; rerender: ReturnType<typeof vi.fn> } {
    const root = createDiv();
    const lines: [number, number, string][] = [
      [0, 0, "alpha beta"],
      [2, 2, "alpha beta"],
      [4, 4, "gamma"],
    ];
    for (const [lineStart, lineEnd, text] of lines) {
      const section = paragraphSection(text);
      stampSection(section, lineStart, lineEnd);
      root.append(section);
    }
    const rerender = vi.fn();
    const pane: ReadingPane = {
      getMode: () => "preview",
      file: { path: "notes.md" },
      data: SOURCE,
      previewMode: { containerEl: root, rerender },
      ...overrides,
    };
    return { pane, root, rerender };
  }

  const tick = () => new Promise((resolve) => window.setTimeout(resolve, 0));

  it("marks a fresh note in place, in every pane showing the path, on the one section that holds it", async () => {
    const sheet = sheetWith({ exact: "alpha beta", prefix: "", suffix: "\n\ngamma" });
    const first = fakePane();
    const second = fakePane();
    const plugin = fakePlugin({ readingPanes: () => [first.pane, second.pane], loadNotesFor: () => Promise.resolve(sheet) });

    refreshReadingMarks(plugin, "notes.md");
    await tick();

    for (const { root, rerender } of [first, second]) {
      expect(marksOf(root)).toEqual(["alpha beta"]);
      expect(root.querySelector<HTMLElement>(".agent-thread-mark")?.closest("div")).toBe(root.children[1]);
      expect(root.textContent).toBe("alpha betaalpha betagamma");
      expect(rerender).not.toHaveBeenCalled();
    }
  });

  it("unwraps the mark of a deleted note and leaves the text intact", async () => {
    const sheet = sheetWith({ exact: "gamma", prefix: "", suffix: "" });
    const { pane, root } = fakePane();
    const seeded = fakePlugin({ readingPanes: () => [pane], loadNotesFor: () => Promise.resolve(sheet) });
    refreshReadingMarks(seeded, "notes.md");
    await tick();
    expect(marksOf(root)).toEqual(["gamma"]);
    const plugin = fakePlugin({ readingPanes: () => [pane], loadNotesFor: () => Promise.resolve(emptySheet()) });

    refreshReadingMarks(plugin, "notes.md");
    await tick();

    expect(marksOf(root)).toEqual([]);
    expect(root.textContent).toBe("alpha betaalpha betagamma");
  });

  it("clicking a refreshed mark opens the panel and the thread", async () => {
    const sheet = sheetWith({ exact: "gamma", prefix: "", suffix: "" });
    const { pane, root } = fakePane();
    const reveal = vi.fn(() => Promise.resolve());
    const openThread = vi.fn();
    const plugin = fakePlugin({ readingPanes: () => [pane], loadNotesFor: () => Promise.resolve(sheet), revealNotesView: reveal, openThread });

    refreshReadingMarks(plugin, "notes.md");
    await tick();
    root.querySelector<HTMLElement>(".agent-thread-mark")?.click();

    expect(reveal).toHaveBeenCalledOnce();
    expect(openThread.mock.calls[0]?.[0]).toBe("notes.md");
    expect(openThread.mock.calls[0]?.[1]).toBe("n1");
  });

  it("rerenders a pane whose rendered sections carry no source lines instead of guessing", async () => {
    const sheet = sheetWith({ exact: "gamma", prefix: "", suffix: "" });
    const root = createDiv();
    root.append(paragraphSection("alpha beta"), paragraphSection("gamma"));
    const rerender = vi.fn();
    const pane: ReadingPane = { getMode: () => "preview", file: { path: "notes.md" }, data: SOURCE, previewMode: { containerEl: root, rerender } };
    const plugin = fakePlugin({ readingPanes: () => [pane], loadNotesFor: () => Promise.resolve(sheet) });

    refreshReadingMarks(plugin, "notes.md");
    await tick();

    expect(rerender).toHaveBeenCalledWith(true);
    expect(marksOf(root)).toEqual([]);
  });

  it("does not rerender an unstamped pane when the file has no notes", async () => {
    const root = createDiv();
    root.append(paragraphSection("alpha beta"));
    const rerender = vi.fn();
    const pane: ReadingPane = { getMode: () => "preview", file: { path: "notes.md" }, data: SOURCE, previewMode: { containerEl: root, rerender } };
    const plugin = fakePlugin({ readingPanes: () => [pane], loadNotesFor: () => Promise.resolve(emptySheet()) });

    refreshReadingMarks(plugin, "notes.md");
    await tick();

    expect(rerender).not.toHaveBeenCalled();
  });

  it("skips a pane in source mode", async () => {
    const { pane, root } = fakePane({ getMode: () => "source" });
    const sheet = sheetWith({ exact: "gamma", prefix: "", suffix: "" });
    const plugin = fakePlugin({ readingPanes: () => [pane], loadNotesFor: () => Promise.resolve(sheet) });

    refreshReadingMarks(plugin, "notes.md");
    await tick();

    expect(marksOf(root)).toEqual([]);
  });

  it("skips a pane showing a different file", async () => {
    const { pane, root } = fakePane({ file: { path: "other.md" } });
    const sheet = sheetWith({ exact: "gamma", prefix: "", suffix: "" });
    const plugin = fakePlugin({ readingPanes: () => [pane], loadNotesFor: () => Promise.resolve(sheet) });

    refreshReadingMarks(plugin, "notes.md");
    await tick();

    expect(marksOf(root)).toEqual([]);
  });
});
