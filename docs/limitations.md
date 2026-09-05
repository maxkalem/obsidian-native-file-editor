# Limitations

What the current build does not do, and why. Items leave this list when the code changes, not before.

## Text and code

- Highlighting covers the fourteen official CodeMirror grammars and the legacy stream modes (over 200 extensions). Extensions outside that set (`.bat`, `.cmd`, `.makefile`, `.graphql`, `.svelte`, `.vue` among them) are not registered yet: the community packages and the keyword-table fallback are the next milestone items.
- A legacy stream mode highlights keywords, strings, comments and numbers; it has no grammar, so nesting, folding and indentation are coarser than in a lezer language.
- The `.log` mode is this plugin's own and knows the common shapes (ISO timestamps, `LEVEL`, `[thread]`, `key=value`, stack frames). A log in another shape highlights less.
- Every bundled grammar is parsed when Obsidian loads the plugin (about 1 MB of `main.js`, 40% of it the legacy modes); there is no code splitting in an Obsidian plugin. `npm run size` prints the per-package cost.
- A file that is not valid UTF-8 and has no byte order mark is decoded as a guess between windows-1251 and windows-1252 and opened read-only. There is no encoder for those code pages in the platform, and writing a guess back would rewrite bytes the user never touched. Convert such a file to UTF-8 with another tool if it needs editing here.
- A file with no line breaks, or an empty file, is written back with LF line endings when edited.
- A per-extension toggle in settings applies at the next plugin reload, not immediately. Taking an extension over at runtime would mean re-registering it under another plugin's nose, which is exactly the load-order race the yield rule exists to avoid.
- The large-file threshold gates the editing mode (undo history and the write path), not the preview, which is a read-only CodeMirror view and renders only what is visible.

## Platform

- Whether the mobile vault adapter's `rename` replaces an existing file has not been confirmed on a device. When it refuses, the transport falls back to overwriting the file in place after the complete new bytes are on disk under a temp name, so a failure leaves a recovery copy rather than a truncated file.
- The desktop transport writes through Node's filesystem, so Obsidian learns of the change through its file watcher rather than through its own write path. Other panes showing the same file update when the watcher fires.

## Not yet built

Office documents, backups and restore, palettes, the formula engine and the legacy formats are all planned and none of it exists yet; the README carries the order.
