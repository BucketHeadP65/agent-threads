# Agent Threads

An Obsidian plugin for note threads that you and your coding agents share on markdown files.
You leave a note on a passage in Obsidian. An agent working in the same folder reads it, answers in the thread and resolves it.
The threads live in plain JSON files beside your notes, so there is no server and no account.

## What it does

- Select text in the editor (Live Preview or source mode) or in reading view. Click the "Add note" button that appears near the end of the selection and save a comment anchored to that span.
- A side panel lists the active file's threads. Open threads come first. Resolved ones are collapsed and dimmed.
- Each thread shows the comment, its replies (yours and the agent's styled apart), a reply box, resolve and reopen, and delete behind a confirm step.
- An open note's span is underlined and tinted in the editor and in reading view. Clicking it opens the thread.
- Clicking a thread's quoted span scrolls the editor to it. When the text no longer exists, the thread is labeled "Anchor lost".
- When an agent or any other tool changes a thread file on disk, the panel refreshes within three seconds.
- Links resolve by a note's frontmatter `id` and `aliases` when no file name matches. So `[[design-2026-q3]]` opens the note whose frontmatter says `id: design-2026-q3`, whatever its file is called.

## Install

With [BRAT](https://github.com/TfTHacker/obsidian42-brat): add the beta plugin `BucketHeadP65/agent-threads`, then enable "Agent Threads" under Community plugins.

By hand: download `main.js`, `manifest.json` and `styles.css` from a release and copy them into:

```text
<vault>/.obsidian/plugins/agent-threads/
```

Then enable "Agent Threads" under Community plugins.
It does not run on mobile.

## The agent skill

On load the plugin writes an agent skill into the vault at `.claude/skills/agent-threads/`: a `SKILL.md` and a `scripts/notes.py`.
A coding agent that reads skills from `.claude/skills/` and is opened at the vault root then knows what the threads are.
It gets verbs to list, show, reply to, resolve and reopen them, so it never edits a thread file by hand.
The script needs only `python3` and its standard library.

The plugin rewrites the files whenever they differ from the copy it carries, so a hand edit does not survive.
The setting "Install the agent skill" turns the write off. An installed copy is never removed.

To use the skill without the plugin, copy `skills/agent-threads/` from this repository into your project's `.claude/skills/`.

## The format

A file's threads live at `<home>/.agent-threads/<path under home>.threads.json`.
The home is the nearest ancestor folder that holds a `.agent-threads/` folder, else the vault root.
Each thread file is one compact JSON object with a `version` and a list of notes, and every writer produces the same bytes for the same content.
[FORMAT.md](FORMAT.md) has every field, the read and write rules, and how a note's span is found again after edits.

## Build and test

```bash
npm install     # a .npmrc sets legacy-peer-deps for the obsidian and @codemirror peer ranges
npm test        # vitest, including a check that runs notes.py and compares its bytes with the plugin's
npm run build   # tsc --noEmit, then esbuild to main.js
npm run dev     # esbuild in watch mode
```

The `notes.py` check is skipped when `python3` is not on the path.

## License

MIT. See [LICENSE](LICENSE).
