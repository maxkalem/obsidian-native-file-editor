# Threat model

What the plugin can touch, what it does with it, and what it never does. Written for the community-plugins reviewer and kept true to the shipped code; every claim names the module that makes it so.

## Network

Nothing. The plugin makes no request of any kind and has no updater (`docs/ADR-001-no-network-languages-ship-with-releases.md`). Language modes, palettes and runner defaults arrive inside `main.js`; anything the user adds is a local file.

## Filesystem

The plugin reads and writes the files the user opens in it, through one transport (`src/platform/`): Node's `fs` on desktop, the vault adapter on mobile. Writes go to a dot-prefixed temp file beside the target and are renamed over it, so a failed write leaves the original in place. Of its own the plugin writes, under its plugin folder, the diagnostic log (`nfe.log`, paths and error stacks, never file contents) and, once per vault, the example palette; it reads the palette folder the user configured. Backups, when they arrive, are written under a configurable vault folder and removed through Obsidian's trash.

## Code from the vault

None of it is executed. A CodeMirror theme module dropped into the palette folder is scanned as text for its colour literals (`src/palette/codemirrorTheme.ts`) and never evaluated; palette CSS reaches the page as the `textContent` of one `<style>` element. Document content never goes through `innerHTML`.

## Processes: the Run feature (ADR-004)

The one place the plugin starts anything is `src/run/process.ts`, and it does so only when the user presses Run, invokes the command or its hotkey, and only after the per-device toggle "Enable Run" has been turned on. It is desktop only: on mobile the module is never loaded and the button, the command and the settings section do not exist.

What a run is: the interpreter named by the runner for the file's extension (a bare command resolved through `PATH`, or an absolute path the user typed), started with `child_process.spawn`, `shell: false`, an argv array in which the file's absolute path is one element, in the file's folder as working directory, with the user's own permissions. The process is the user's, exactly as if they had typed the same command in a terminal; the plugin adds a timeout (default 30 s), a Stop button that kills the process tree, and an output cap (default 1 MB). A runner with several steps (compile, then run) uses a temp directory outside the vault that is removed afterwards.

What a run is not: the plugin never runs anything on open, save, sync or a timer; never builds a command line by string concatenation; never invokes `cmd.exe` or `sh -c` as a wrapper; never passes a path containing a newline or NUL (`src/run/runners.ts` refuses it); never downloads, installs or updates an interpreter; never writes into the vault on the program's behalf. Runner definitions are device-local data in `localStorage`, editable in settings; the defaults are the languages' own standard tools and nothing else.

A web page (`.html`, `.mht`) with no interpreter of the user's is rendered INSIDE Obsidian: an `iframe` with an empty `sandbox` attribute (no scripts, no forms, no same-origin access) and the document as `srcdoc`, into which `src/run/mhtml.ts` injects `Content-Security-Policy: default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:`, so the page can load nothing from anywhere. The native dialogs in settings (choose a folder, choose an interpreter) are Electron's own (`src/platform/desktopShell.ts`); a chosen folder must lie inside the vault. No interpreter ships with the plugin and none is configured until the user adds one.

JavaScript is the exception that has a real sandbox: the file runs in a Web Worker created from a Blob (`src/run/worker.ts`), with no DOM, no Obsidian API, no `require` and no filesystem, `console.*` and uncaught errors forwarded to the panel, and `terminate()` on timeout or Stop. Node is offered as a second runner for scripts that need it, under the same rules as every other interpreter.

## Output

Program output is text, appended to a `pre` with `appendText`, stdout and stderr in separate classes, truncated at the cap with a marker. It is not parsed, not rendered as HTML and not written anywhere.

## Settings and state

`data.json` (shared through sync) holds preferences only. Everything that names this device (interpreter paths, the Run toggle, the timeout, the large-file limit, last modes) lives in `localStorage` scoped by vault, so an interpreter path never travels to another machine.
