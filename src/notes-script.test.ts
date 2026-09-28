/// <reference types="node" />

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { addNote, emptySheet, parseSheet, serializeSheet } from "./sidecar";
import { notesPath } from "./vault-notes";

const SCRIPT = resolve(__dirname, "../skills/agent-threads/scripts/notes.py");
const HAS_PYTHON = spawnSync("python3", ["--version"]).status === 0;

/** Runs the skill's script with `args` and `--root root`, answering its exit code and output. */
function runScript(root: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("python3", [SCRIPT, ...args, "--root", root], { encoding: "utf-8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe.skipIf(!HAS_PYTHON)("notes.py and the TypeScript reader agree on the thread file", () => {
  let root = "";
  const file = "docs/design.md";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "agent-threads-"));
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, file), "# Design\n\nThe cache stays warm between runs.\n");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function seed(text: string): string {
    const { sheet, note } = addNote(
      emptySheet(),
      { exact: "The cache stays warm", prefix: "# Design\n\n", suffix: " between runs." },
      text,
      "0b5c6f7e-1d2a-4c3b-9e8f-7a6b5c4d3e2f",
      "2026-09-28T10:00:00.000Z",
    );
    const path = join(root, notesPath(file));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, serializeSheet(sheet));
    return note.id;
  }

  it("writes where the plugin reads, in a shape the plugin parses", () => {
    const noteId = seed("Why warm? Say it in the design.");
    const reply = runScript(root, ["reply", file, noteId, "Added a paragraph on the warm-up cost."]);
    expect(reply.status).toBe(0);
    expect(reply.stdout).toContain(`written to ${notesPath(file)}`);

    const sheet = parseSheet(readFileSync(join(root, notesPath(file)), "utf-8"));
    expect(sheet.notes).toHaveLength(1);
    const [note] = sheet.notes;
    expect(note?.id).toBe(noteId);
    expect(note?.replies.map((entry) => [entry.author, entry.text])).toEqual([["agent", "Added a paragraph on the warm-up cost."]]);
    expect(note?.status).toBe("open");

    expect(runScript(root, ["resolve", file, noteId]).status).toBe(0);
    expect(parseSheet(readFileSync(join(root, notesPath(file)), "utf-8")).notes[0]?.status).toBe("resolved");
  });

  it("writes the same bytes the TypeScript serializer writes for the same content", () => {
    const noteId = seed('Quotes " and a backslash \\, a tab\t, a newline\n, non-ASCII é 日本 🙂, and a control \u0001.');
    expect(runScript(root, ["reply", file, noteId, "Ünïcode reply with </script> and \"quotes\"."]).status).toBe(0);

    const written = readFileSync(join(root, notesPath(file)), "utf-8");
    expect(serializeSheet(parseSheet(written))).toBe(written);
  });

  it("fills absent optional fields with the defaults the plugin reads", () => {
    const path = join(root, notesPath(file));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '{"notes":[{"id":"n1","anchor":{"exact":"The cache"},"text":"t","created_at":"2026-09-28T10:00:00Z"}]}');
    expect(runScript(root, ["reopen", file, "n1"]).status).toBe(0);

    const written = readFileSync(path, "utf-8");
    expect(written).toBe(
      '{"version":1,"notes":[{"id":"n1","anchor":{"exact":"The cache","prefix":"","suffix":""},"text":"t","created_at":"2026-09-28T10:00:00Z","archived":false,"replies":[],"status":"open"}]}',
    );
    expect(serializeSheet(parseSheet(written))).toBe(written);
  });
});
