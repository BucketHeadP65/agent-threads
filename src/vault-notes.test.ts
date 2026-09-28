import { describe, expect, it } from "vitest";

import { emptySheet } from "./sidecar";
import { createNote, editNote, isSidecarFor, loadNotes, notesPath, resolveNotesPath, sidecarMtime, type SidecarAdapter } from "./vault-notes";

/**
 * An in-memory `SidecarAdapter` fake. Files, dirs, mtimes, and call logs
 * are public, scriptable state. Mirrors the real `DataAdapter.mkdir`, which
 * throws when the target directory already exists rather than silently
 * succeeding, so a fix that just re-issues `mkdir` on every write cannot
 * pass against it. Mtimes are a monotonic counter, not wall-clock time, so
 * ordering assertions stay deterministic.
 */
class FakeSidecarAdapter implements SidecarAdapter {
  readonly files = new Map<string, string>();
  readonly dirs = new Set<string>();
  readonly mkdirCalls: string[] = [];
  readonly writeCalls: string[] = [];
  readonly statCalls: string[] = [];
  readonly mtimes = new Map<string, number>();
  private clock = 0;

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path);
  }

  async read(path: string): Promise<string> {
    const data = this.files.get(path);
    if (data === undefined) throw new Error(`no such file: ${path}`);
    return data;
  }

  async write(path: string, data: string): Promise<void> {
    this.writeCalls.push(path);
    this.files.set(path, data);
    this.mtimes.set(path, ++this.clock);
  }

  async rename(path: string, newPath: string): Promise<void> {
    const data = this.files.get(path);
    if (data === undefined) throw new Error(`no such file: ${path}`);
    this.files.delete(path);
    this.files.set(newPath, data);
    this.mtimes.delete(path);
    this.mtimes.set(newPath, ++this.clock);
  }

  async remove(path: string): Promise<void> {
    if (!this.files.delete(path)) throw new Error(`no such file: ${path}`);
    this.mtimes.delete(path);
  }

  async mkdir(path: string): Promise<void> {
    this.mkdirCalls.push(path);
    if (this.dirs.has(path)) throw new Error(`EEXIST: file already exists, mkdir '${path}'`);
    this.dirs.add(path);
  }

  async stat(path: string): Promise<{ mtime: number } | null> {
    this.statCalls.push(path);
    const mtime = this.mtimes.get(path);
    return mtime === undefined ? null : { mtime };
  }
}

/** A `FakeSidecarAdapter` whose `rename` refuses to replace an existing destination, like a stricter adapter would. */
class RenameRefusingAdapter extends FakeSidecarAdapter {
  override async rename(path: string, newPath: string): Promise<void> {
    if (this.files.has(newPath)) throw new Error(`EEXIST: file already exists, rename '${path}' -> '${newPath}'`);
    await super.rename(path, newPath);
  }
}

describe("notesPath", () => {
  it("mirrors a nested file's relative path under .agent-threads", () => {
    expect(notesPath("docs/adr/x.md")).toBe(".agent-threads/docs/adr/x.md.threads.json");
  });

  it("mirrors a vault-root file the same way", () => {
    expect(notesPath("readme.md")).toBe(".agent-threads/readme.md.threads.json");
  });
});

describe("isSidecarFor", () => {
  it("matches the new location", () => {
    expect(isSidecarFor("docs/x.md", ".agent-threads/docs/x.md.threads.json")).toBe(true);
  });

  it("does not match an unrelated path", () => {
    expect(isSidecarFor("docs/x.md", "docs/y.md.threads.json")).toBe(false);
  });

  it("matches the sidecar under a nearer ancestor's own .agent-threads home", () => {
    expect(isSidecarFor("project/docs/adr/x.md", "project/.agent-threads/docs/adr/x.md.threads.json")).toBe(true);
    expect(isSidecarFor("project/docs/adr/x.md", "project/docs/.agent-threads/adr/x.md.threads.json")).toBe(true);
  });

  it("does not treat a file beside the note as its sidecar", () => {
    expect(isSidecarFor("notes/design.md", "notes/design.md.threads.json")).toBe(false);
  });
});

describe("resolveNotesPath", () => {
  it("lands under the vault root when no ancestor holds a .agent-threads folder", async () => {
    const adapter = new FakeSidecarAdapter();
    expect(await resolveNotesPath(adapter, "project/docs/adr/x.md")).toBe(".agent-threads/project/docs/adr/x.md.threads.json");
  });

  it("lands under the nearest ancestor that holds a .agent-threads folder, a project inside the vault", async () => {
    const adapter = new FakeSidecarAdapter();
    adapter.dirs.add(".agent-threads");
    adapter.dirs.add("project/.agent-threads");
    expect(await resolveNotesPath(adapter, "project/docs/adr/x.md")).toBe("project/.agent-threads/docs/adr/x.md.threads.json");
  });

  it("prefers the nearest of several ancestors that own one", async () => {
    const adapter = new FakeSidecarAdapter();
    adapter.dirs.add("project/.agent-threads");
    adapter.dirs.add("project/docs/.agent-threads");
    expect(await resolveNotesPath(adapter, "project/docs/adr/x.md")).toBe("project/docs/.agent-threads/adr/x.md.threads.json");
  });
});

describe("loadNotes", () => {
  it("reads the new location when present", () => {
    const adapter = new FakeSidecarAdapter();
    adapter.files.set(".agent-threads/docs/x.md.threads.json", '{"version":1,"notes":[]}');
    return loadNotes(adapter, "docs/x.md").then((sheet) => {
      expect(sheet).toEqual(emptySheet());
    });
  });

  it("returns an empty sheet when neither location exists", async () => {
    const adapter = new FakeSidecarAdapter();
    expect(await loadNotes(adapter, "docs/x.md")).toEqual(emptySheet());
  });

  it("reads the thread file another tool wrote under a project's own .agent-threads home", async () => {
    const adapter = new FakeSidecarAdapter();
    adapter.dirs.add("project/.agent-threads");
    adapter.files.set(
      "project/.agent-threads/docs/adr/x.md.threads.json",
      '{"version":1,"notes":[{"id":"n1","anchor":{"exact":"x","prefix":"","suffix":""},"text":"t","created_at":"2026-01-01T00:00:00Z","archived":false,"replies":[],"status":"open"}]}',
    );
    const sheet = await loadNotes(adapter, "project/docs/adr/x.md");
    expect(sheet.notes.map((note) => note.id)).toEqual(["n1"]);
  });

  it("still finds a sidecar written under the vault root before a nearer .agent-threads home appeared", async () => {
    const adapter = new FakeSidecarAdapter();
    adapter.files.set(".agent-threads/project/docs/adr/x.md.threads.json", '{"version":1,"notes":[]}');
    adapter.dirs.add("project/.agent-threads");
    expect(await loadNotes(adapter, "project/docs/adr/x.md")).toEqual(emptySheet());
  });

  it("ignores a sidecar beside the file", async () => {
    const adapter = new FakeSidecarAdapter();
    adapter.files.set("notes/design.md.threads.json", JSON.stringify({ version: 1, notes: [{ id: "n1", anchor: { exact: "x", prefix: "", suffix: "" }, text: "t", created_at: "2026-08-28T10:00:00Z", archived: false, replies: [], status: "open" }] }));

    expect(await loadNotes(adapter, "notes/design.md")).toEqual(emptySheet());
    expect(await sidecarMtime(adapter, "notes/design.md")).toBeNull();
  });
});

describe("createNote (write path)", () => {
  it("writes the new location and creates its parent folder", async () => {
    const adapter = new FakeSidecarAdapter();
    await createNote(adapter, "docs/adr/x.md", { exact: "span", prefix: "", suffix: "" }, "a note");
    expect(adapter.files.has(".agent-threads/docs/adr/x.md.threads.json")).toBe(true);
    expect(adapter.mkdirCalls).toEqual([".agent-threads", ".agent-threads/docs", ".agent-threads/docs/adr"]);
  });

  it("adds a second note to the same file without tripping over the sidecar directory the first note created", async () => {
    const adapter = new FakeSidecarAdapter();
    await createNote(adapter, "docs/adr/x.md", { exact: "one", prefix: "", suffix: "" }, "first note");
    const second = await createNote(adapter, "docs/adr/x.md", { exact: "two", prefix: "", suffix: "" }, "second note");

    expect(second.text).toBe("second note");
    const sheet = await loadNotes(adapter, "docs/adr/x.md");
    expect(sheet.notes.map((note) => note.text)).toEqual(["first note", "second note"]);
  });

  it("only calls mkdir once across two notes on the same file, the directory already exists on the second", async () => {
    const adapter = new FakeSidecarAdapter();
    await createNote(adapter, "docs/adr/x.md", { exact: "one", prefix: "", suffix: "" }, "first note");
    await createNote(adapter, "docs/adr/x.md", { exact: "two", prefix: "", suffix: "" }, "second note");

    expect(adapter.mkdirCalls).toEqual([".agent-threads", ".agent-threads/docs", ".agent-threads/docs/adr"]);
  });

  it("still succeeds when a racing mkdir throws even though the directory now exists", async () => {
    class RacingMkdirAdapter extends FakeSidecarAdapter {
      override async mkdir(path: string): Promise<void> {
        this.dirs.add(path);
        throw new Error(`EEXIST: file already exists, mkdir '${path}'`);
      }
    }
    const adapter = new RacingMkdirAdapter();
    const note = await createNote(adapter, "docs/adr/x.md", { exact: "span", prefix: "", suffix: "" }, "a note");
    expect(note.text).toBe("a note");
  });

  it("replaces an existing sidecar even when the adapter's rename refuses to overwrite one", async () => {
    const adapter = new RenameRefusingAdapter();
    await createNote(adapter, "docs/adr/x.md", { exact: "one", prefix: "", suffix: "" }, "first note");
    const second = await createNote(adapter, "docs/adr/x.md", { exact: "two", prefix: "", suffix: "" }, "second note");

    expect(second.text).toBe("second note");
    const sheet = await loadNotes(adapter, "docs/adr/x.md");
    expect(sheet.notes.map((note) => note.text)).toEqual(["first note", "second note"]);
  });

  it("creates a new sidecar through a temp file and overwrites an existing one in place, never renaming over it", async () => {
    const adapter = new FakeSidecarAdapter();
    await createNote(adapter, "docs/x.md", { exact: "one", prefix: "", suffix: "" }, "first note");
    await createNote(adapter, "docs/x.md", { exact: "two", prefix: "", suffix: "" }, "second note");

    expect(adapter.writeCalls).toHaveLength(2);
    expect(adapter.writeCalls[0]).toMatch(/\.threads\.json\.[^/]+\.tmp$/);
    expect(adapter.writeCalls[1]).toBe(".agent-threads/docs/x.md.threads.json");
    expect([...adapter.files.keys()].filter((path) => path.endsWith(".tmp"))).toEqual([]);
  });

  it("writes under a project's own home when the file lives under one, so every tool shares the thread file", async () => {
    const adapter = new FakeSidecarAdapter();
    adapter.dirs.add("project");
    adapter.dirs.add("project/.agent-threads");
    await createNote(adapter, "project/docs/adr/x.md", { exact: "span", prefix: "", suffix: "" }, "a note");
    expect(adapter.files.has("project/.agent-threads/docs/adr/x.md.threads.json")).toBe(true);
    expect(adapter.files.has(".agent-threads/project/docs/adr/x.md.threads.json")).toBe(false);
    expect(adapter.mkdirCalls).toEqual(["project/.agent-threads/docs", "project/.agent-threads/docs/adr"]);
  });
});

describe("sidecarMtime", () => {
  it("reads the new location's mtime once the sidecar lives there", async () => {
    const adapter = new FakeSidecarAdapter();
    await createNote(adapter, "docs/x.md", { exact: "span", prefix: "", suffix: "" }, "a note");
    expect(await sidecarMtime(adapter, "docs/x.md")).toBe(adapter.mtimes.get(".agent-threads/docs/x.md.threads.json"));
  });

  it("stats only the resolved home once the sidecar is there", async () => {
    const adapter = new FakeSidecarAdapter();
    await createNote(adapter, "docs/x.md", { exact: "span", prefix: "", suffix: "" }, "a note");
    adapter.statCalls.length = 0;

    await sidecarMtime(adapter, "docs/x.md");

    expect(adapter.statCalls).toEqual([".agent-threads/docs/x.md.threads.json"]);
  });

  it("returns null when neither location exists", async () => {
    const adapter = new FakeSidecarAdapter();
    expect(await sidecarMtime(adapter, "docs/x.md")).toBeNull();
  });
});

describe("editNote", () => {
  it("rewrites the note's text and keeps everything else", async () => {
    const adapter = new FakeSidecarAdapter();
    const created = await createNote(adapter, "doc.md", { exact: "spot", prefix: "", suffix: "" }, "first wording");

    const edited = await editNote(adapter, "doc.md", created.id, "second wording");

    expect(edited.text).toBe("second wording");
    expect(edited.id).toBe(created.id);
    expect(edited.anchor).toEqual(created.anchor);
    const sheet = await loadNotes(adapter, "doc.md");
    expect(sheet.notes.map((note) => note.text)).toEqual(["second wording"]);
  });

  it("throws for an unknown note id", async () => {
    const adapter = new FakeSidecarAdapter();
    await createNote(adapter, "doc.md", { exact: "spot", prefix: "", suffix: "" }, "wording");
    await expect(editNote(adapter, "doc.md", "missing", "new")).rejects.toThrow("no note with id missing");
  });
});
