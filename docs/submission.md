# Submission notes

Written for the community-plugins reviewer, and kept true to the shipped code. Submission happens once, when the whole plan is built; this document grows with each milestone.

## Network

The plugin makes no network requests, ever. It has no updater for languages, themes or anything else: every language mode and every example palette arrives inside a release. Import features read local files only.

## Dependencies

`package.json` declares no runtime dependencies. The CodeMirror core packages Obsidian exposes to plugins (`@codemirror/state`, `view`, `language`, `commands`, `search`) are used through Obsidian and are not bundled. Anything that is bundled into `main.js` is listed in `THIRD_PARTY_NOTICES.md` with its licence; at this milestone nothing is.

## Filesystem

The plugin reads and writes the files the user opens in it, and nothing else. On desktop it writes through Node's filesystem to a dot-prefixed temp file beside the target and renames it over the target, so a failed write leaves the original in place. On mobile it writes through the vault adapter with the same temp-file scheme. Deletions of the plugin's own files, when backups arrive, go through Obsidian's trash.

## Generated code and HTML

Nothing executes generated code. No `innerHTML` is used with document content; DOM is built with `createEl`, `createDiv` and `setText`.

## Coexistence

At load the plugin registers only the file extensions no other plugin has claimed, shows a notice naming what it left alone, and offers a per-extension toggle to take any of them over deliberately. This avoids duplicating `CM Code Editor`'s functionality on a vault where it is installed.

## Settings

The settings tab uses the declarative API (`getSettingDefinitions`), so `minAppVersion` is 1.13.0. Shared preferences live in `data.json`; device-local state (last mode per file, the large-file limit) lives in `localStorage` scoped by vault, so nothing device-specific travels with a synced vault.

## Licence

GPL-3.0-only for the plugin as a whole, stated identically in `LICENSE`, `package.json` and the README. `src/format/` and `src/model/` are additionally offered under MIT, each with its own `LICENSE`; a test asserts that those directories import nothing from the rest of the plugin.

## Tests

`npm test` runs the unit suite (pure modules, the view against a fake DOM, the settings tab's definitions), `npm run test:e2e` runs real fixture files through both transports and the text model. CI fails when the committed `main.js` differs from a fresh build or when the three version files disagree.
