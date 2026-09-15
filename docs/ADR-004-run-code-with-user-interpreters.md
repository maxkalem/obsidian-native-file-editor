# ADR-004: Run code with the user's own interpreters

Status: accepted, 2026-09-05.

## Decision

The text view can run the file it shows and stream the program's output and errors into a panel below the editor. JavaScript runs inside a Web Worker created from a Blob, in Obsidian's own JavaScript engine, on every platform. Every other language runs as a child process of Obsidian, on desktop only, through an interpreter the user has installed: a per-extension runner definition names the command and its arguments as an argv array, and the plugin starts exactly that process, with `shell: false`, in the file's folder, with a timeout and an output cap.

Run is off by default. A per-device toggle enables it; the Run button, the command and the settings section are absent on mobile and absent until the toggle is on. Nothing ever runs except when the user presses Run, invokes the command or its hotkey: never on open, on save or on a timer. The plugin ships no interpreter and never downloads one.

## Why

The request: run the file in the pane, for every language, "in a sandbox". Two things had to be corrected first and shape the design:

- **There is no sandbox for a native interpreter.** A Python or Lua process started by the plugin runs with the user's full permissions, exactly as pressing Run in Notepad++ or an IDE does. Only what runs inside Obsidian's JavaScript engine can be isolated, so the feature is two features: a real sandbox for JavaScript (a Worker has no DOM, no Obsidian API and no filesystem, and `terminate()` ends it), and "run with the interpreter on this device" for the rest, said plainly.
- **Interpreters do not live in the plugin folder.** It is inside the vault: a synced or Git-tracked vault would carry hundreds of megabytes, `clean.cmd` wipes it, and paths differ between devices. Interpreter locations are device-local settings: bare command names resolved through `PATH`, or absolute paths, including one inside the vault at the user's own risk.

Precedent in the community directory: `twibiral/obsidian-execute-code` runs fenced code blocks through user-configured interpreter paths for two dozen languages, desktop only, and passed review with the process use disclosed; `Shell commands` (Taitava) is the other. The review question is therefore disclosure and argument hygiene, not permission.

This amends the project's "no shell" rule: the one exception is this feature, desktop only, off by default, argv arrays only.

## Consequences

- `src/run/process.ts` is the only module that names `child_process`, behind the same lazy `require` guard as the desktop transport, so the one `main.js` still loads on a phone.
- A runner is data: `{ ext, name, argv }` or `{ ext, name, steps: argv[] }` with the placeholders `{file}`, `{dir}`, `{stem}`, `{tmp}`. The interpreter and every argument are separate array elements; the file path is one argument, never interpolated into a command line. A file path containing a newline or NUL is refused before anything starts. The plugin never invokes `cmd.exe` or `sh -c` as a wrapper; when the runner's command is a shell (`bash file.sh`), the shell is the interpreter.
- The bundle ships default runners only for a language's own standard tool (`python`, `node`, `lua`, `ruby`, `go run`, `rustc`, ...). The user edits argv per device to point at a path or to add a runner; runners are never fetched.
- Every run has a timeout (default 30 s, per device) and a Stop button that kills the process tree; output is capped (default 1 MB) with a marker. Compiled languages use a per-run temp directory outside the vault, removed afterwards. Nothing is written to the vault by the runner except what the program itself writes.
- Output reaches the panel as text through `setText`/`appendText`, stdout and stderr distinguished by class, with the exit code and wall time. The panel is a `pre`, not an editor.
- `docs/threat-model.md` states what the feature does and does not do; `docs/submission.md` discloses the process use and the toggle; `docs/setup.md` explains installing interpreters and pointing a runner at one.
- No confirmation dialog before a run, first or otherwise: the per-device toggle is the consent, and the user pressed the button.
