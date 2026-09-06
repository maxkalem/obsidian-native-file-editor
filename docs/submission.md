# Submission notes

Written for the community-plugins reviewer, and kept true to the shipped code. Submission happens once, when the whole plan is built; this document grows with each milestone.

## Network

The plugin makes no network requests, ever. It has no updater for languages, themes or anything else: every language mode arrives inside a release; palettes and language definitions are local files the user dropped into a vault folder. Import features read local files only.

## Dependencies

`package.json` declares no runtime dependencies. The CodeMirror core packages Obsidian exposes to plugins (`@codemirror/state`, `view`, `language`, `commands`, `search`) are used through Obsidian and are not bundled. Anything that is bundled into `main.js` is listed in `THIRD_PARTY_NOTICES.md` with its licence: the CodeMirror language packages and the legacy modes, all MIT.

## Filesystem

The plugin reads and writes the files the user opens in it, and, of its own under its plugin folder, the log below and the example files the user asks for from settings ("Create example…": a palette or a language definition, written into the configured folder, never unasked). It reads the palette and language folders (configurable, default under the plugin folder) at start, on the Reread button and command, and when the user switches those features on. On desktop it writes through Node's filesystem to a dot-prefixed temp file beside the target and renames it over the target, so a failed write leaves the original in place. On mobile it writes through the vault adapter with the same temp-file scheme. Deletions of the plugin's own files, when backups arrive, go through Obsidian's trash.

## Processes: the Run feature

`src/run/process.ts` is the one module that names `child_process`, resolved lazily through Electron's `require` so the same `main.js` loads on mobile, where the feature does not exist. It is used only when the user has turned on the per-device toggle "Enable Run" (off by default) and then presses the Run button or invokes the "Run file" command: nothing runs on open, save or a timer. A run is `spawn(command, args, { shell: false, cwd: <the file's folder> })` with an argv array from a per-device runner definition in which the file's absolute path is one element; the plugin never builds a command line and never invokes `cmd.exe` or `sh -c` as a wrapper. The interpreter is the user's own (`python`, `node`, ... on `PATH`, or an absolute path they typed); the plugin ships none and downloads nothing. Every run has a timeout, a Stop that kills the process tree, and an output cap. JavaScript runs in a Web Worker instead, with the network removed from its global scope. The full account is `docs/ADR-004-run-code-with-user-interpreters.md` and `docs/threat-model.md`. Precedent in the directory: `obsidian-execute-code`, `Shell commands`.

## Log file

The plugin keeps a diagnostic log at `<config>/plugins/native-file-editor/nfe.log` (rotated at 1 MB), written through the vault adapter. It records file paths, sizes, encodings, error stacks, which palettes were read, and which runner was started on which file with its exit; nothing from file contents or program output.

## Generated code and HTML

Nothing executes generated code, and nothing from the vault is executed: a CodeMirror theme module dropped into the palette folder is scanned as text for its colour literals (see `src/palette/codemirrorTheme.ts`), never evaluated. Web pages are rendered inside Obsidian only in a sandboxed `iframe` (empty `sandbox`, a `default-src 'none'` policy injected into the document). The native open dialogs in settings are Electron's own, desktop only, on a click. Palette CSS reaches the page through the `textContent` of one `<style>` element. No `innerHTML` is used with document content; DOM is built with `createEl`, `createDiv` and `setText`.

## Coexistence

At load the plugin registers only the file extensions no other plugin has claimed, shows a notice naming what it left alone, and offers a per-extension toggle to take any of them over deliberately. This avoids duplicating `CM Code Editor`'s functionality on a vault where it is installed.

## Settings

The settings tab uses the declarative API (`getSettingDefinitions`), so `minAppVersion` is 1.13.0. Shared preferences live in `data.json`; device-local state (last mode per file, the large-file limit, the Run toggle and runner definitions with their interpreter paths) lives in `localStorage` scoped by vault, so nothing device-specific travels with a synced vault.

## Licence

GPL-3.0-only for the plugin as a whole, stated identically in `LICENSE`, `package.json` and the README. `src/format/` and `src/model/` are additionally offered under MIT, each with its own `LICENSE`; a test asserts that those directories import nothing from the rest of the plugin.

## Tests

`npm test` runs the unit suite (pure modules, the view against a fake DOM, the settings tab's definitions), `npm run test:e2e` runs real fixture files through both transports and the text model. CI fails when the committed `main.js` differs from a fresh build or when the three version files disagree.
