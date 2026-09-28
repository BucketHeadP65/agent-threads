# The thread file format

This page is the whole contract between the Agent Threads plugin, the agent skill's `notes.py`, and any other tool that reads or writes threads.
The reference implementations are `src/sidecar.ts`, `src/anchors.ts` and `src/vault-notes.ts` in the plugin, and `skills/agent-threads/scripts/notes.py`.
A test runs the script and checks that both sides read and write the same bytes.

## Where a file's threads live

The threads for one markdown file live in one JSON file, the thread file:

```text
<home>/.agent-threads/<path under home>.threads.json
```

`<path under home>` is the markdown file's path relative to the home, with its full name kept.
The thread file name is that name with `.threads.json` appended.
So the threads for `docs/adr/x.md` under a home at the root live at `.agent-threads/docs/adr/x.md.threads.json`.

## Which folder is the home

The home is the nearest ancestor folder of the markdown file that holds a `.agent-threads/` folder.
The search starts at the file's own folder and stops at the root.
When no folder on the way holds one, the home is the root.
The root is the vault root for the plugin, and the folder the script runs in (or `--root`) for the script.

This lets a project inside a vault keep its own `.agent-threads/` folder.
A tool opened at that project and the plugin opened at the vault then read and write the very same thread file.

A read consults the resolved home first.
When no thread file is there, it tries every other candidate home, nearest first, and uses the first thread file it finds.
This finds a thread file written before a nearer `.agent-threads/` folder appeared.
A write always goes to the resolved home.

## The JSON

A thread file holds one object.

| Field | Type | Meaning |
| --- | --- | --- |
| `version` | integer, always `1` | The format version. |
| `notes` | array of notes | Every note on the file, in the order they were added. |

A note:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | The note's id. New notes get a random UUID version 4. |
| `anchor` | anchor object | Where in the markdown source the note points. |
| `text` | string | The owner's comment that opens the thread. |
| `created_at` | string, ISO 8601 UTC | When the note was taken. |
| `archived` | boolean | An archived note is hidden. Readers skip it and writers leave it alone. |
| `replies` | array of replies | The thread's replies, oldest first. |
| `status` | `"open"` or `"resolved"` | Whether the thread still asks for something. |

An anchor:

| Field | Type | Meaning |
| --- | --- | --- |
| `exact` | string | The annotated span, copied from the raw markdown source (not the rendered text). |
| `prefix` | string | Up to 32 source characters right before the span. |
| `suffix` | string | Up to 32 source characters right after the span. |

A reply:

| Field | Type | Meaning |
| --- | --- | --- |
| `author` | `"owner"` or `"agent"` | Who wrote the reply. |
| `text` | string | The reply. |
| `at` | string, ISO 8601 UTC | When the reply was written. |

Timestamps end in `Z`.
The plugin writes milliseconds (`2026-09-28T09:12:03.512Z`) and the script writes microseconds (`2026-09-28T18:48:58.649231Z`).
Both are valid.

### How a file is written

Every writer produces the same bytes for the same content:

1. Fields appear in the order of the tables above, at every level.
2. The JSON is compact. There is no whitespace between tokens and no trailing newline.
3. Non-ASCII characters are written as UTF-8, not as `\u` escapes.
4. Every field is written, with its default filled in when the content lacks it.

An example, as the script wrote it:

```json
{"version":1,"notes":[{"id":"e5bfe9de-6e3e-4ef0-8db1-f21d6ec027d9","anchor":{"exact":"stays raw TypeScript","prefix":" TypeScript\n\nThe client library ","suffix":", with no build step.\n\n## Ration"},"text":"Why raw and not a build step? Say it in the ADR.","created_at":"2026-09-28T09:12:03.512Z","archived":false,"replies":[{"author":"agent","text":"Added a paragraph under Rationale, every consumer compiles it.","at":"2026-09-28T18:48:58.649231Z"}],"status":"open"}]}
```

### How a file is read

A reader fills in absent fields with their defaults:

| Field | Default when absent |
| --- | --- |
| `version` | `1` |
| `notes` | `[]` |
| `anchor.prefix`, `anchor.suffix` | `""` |
| `archived` | `false` |
| `replies` | `[]` |
| `status` | `"open"` |

`id`, `text`, `created_at`, `anchor.exact`, and a reply's `author`, `text` and `at` are required.
The plugin reads a file that breaks any rule (malformed JSON, a wrong type, a `version` other than `1`, an unknown `author` or `status`) as a file with no notes.
It never recovers part of a broken file.
The script refuses a file whose root is not an object with a `notes` array. It exits with code 2.

## Finding the span again

A note's span is found again in the current source text like this:

1. Find every literal occurrence of `exact`.
2. One occurrence is the answer.
3. Several occurrences are narrowed, in order, to those that match both `prefix` and `suffix`, then to the one at the start of a heading line (only when `prefix` ends with a heading marker such as `## `), then to those matching `prefix` alone, then to those matching `suffix` alone. The first narrowing that leaves exactly one occurrence wins.
4. When the literal pass finds no answer, the same steps run again with a pattern where any run of whitespace in `exact` matches any run of whitespace in the text.
5. When neither pass finds exactly one place, the note is orphaned. The plugin labels it "Anchor lost".

## Write rules

1. **Read, change, write.** Read the freshest thread file from disk right before each change, apply the one change, and write the result. Never write from a copy read earlier.
2. **Temp file, then rename.** Write the new text to a temp file in the same folder, then rename it onto the thread file. A reader never sees a half-written file.
3. **Create folders as needed.** Create `.agent-threads/` and the folders under it when they are missing.
4. **One change at a time per file.** The plugin queues its own changes to one file so two quick actions never overwrite each other.

The plugin writes a new thread file through a temp file and a rename.
It overwrites an existing thread file in place, because Obsidian's file adapter refuses to rename onto a file that exists.
The script always writes through a temp file and a rename.

Obsidian does not report changes inside dot folders.
The plugin checks the open file's thread file for a new modification time every three seconds, so a write from another tool shows up within that time.
