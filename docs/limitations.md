# Limitations

What the current build does not do, and why. Items leave this list when the code changes, not before.

## Text and code

- Highlighting covers the fourteen official CodeMirror grammars, seven community grammars (Svelte, Astro, Elixir, HCL, Nix, Solidity, Prisma), an own GraphQL keyword mode, the legacy stream modes, and 27 Notepad++ keyword tables (over 330 extensions). `.vue` is a decision still to take (tier 1 `lang-vue` exists). A file with no extension (`Makefile`, `Dockerfile` without a dot) has no extension for Obsidian and cannot be claimed by extension.
- A keyword-table language (tier 4, and any vault definition) is keywords, strings, numbers, comments and punctuation: no nesting, no folding by structure, no distinction between a call and a variable. Notepad++'s tables carry no word for whether the language is case-insensitive; the converter's list decides (Batch, the BASICs, Ada, Inno Setup, ... are), and a language wrongly cased highlights nothing until the list is fixed.
- `inc` is not registered although Notepad++ lists it for Pascal: too ambiguous (PHP includes, assembler includes). Every other extension Notepad++ names is taken.
- The GraphQL mode is keywords, strings, comments, numbers and names (types capitalised, fields otherwise); it knows no schema.
- The Elixir grammar (`lezer-elixir`) is 145 KB of parse tables, a tenth of `main.js`, parsed at every start like every other grammar (`npm run size`). It stays because the user asked for Elixir; it is the first candidate if the device measurements ask for a smaller bundle.
- A legacy stream mode highlights keywords, strings, comments and numbers; it has no grammar, so nesting, folding and indentation are coarser than in a lezer language.
- The `.log` mode is this plugin's own and knows the common shapes (ISO timestamps, `LEVEL`, `[thread]`, `key=value`, stack frames). A log in another shape highlights less.
- Every bundled grammar is parsed when Obsidian loads the plugin (about 1 MB of `main.js`, 40% of it the legacy modes); there is no code splitting in an Obsidian plugin. `npm run size` prints the per-package cost.
- A file that is not valid UTF-8 and has no byte order mark is decoded as a guess between windows-1251 and windows-1252 and opened read-only. There is no encoder for those code pages in the platform, and writing a guess back would rewrite bytes the user never touched. Convert such a file to UTF-8 with another tool if it needs editing here.
- A file with no line breaks, or an empty file, is written back with LF line endings when edited.
- A per-extension toggle in settings applies at the next plugin reload, not immediately. Taking an extension over at runtime would mean re-registering it under another plugin's nose, which is exactly the load-order race the yield rule exists to avoid.
- The large-file threshold gates the editing mode (undo history and the write path), not the preview, which is a read-only CodeMirror view and renders only what is visible.

## Palettes

- A CodeMirror theme module is read as data, never executed. Colours that are computed in the file (a function call, a template string, a colour library) are skipped and named in the log; the rest of the theme still applies. A module that defines a light and a dark theme contributes both, each under Obsidian's `theme-light` / `theme-dark` body class, when each `createTheme` call names its variant (`theme`, `variant` or `dark`); otherwise the last group wins, and deleting the other from your copy gets the first.
- A theme's tag that the plugin's token table does not name is mapped to its nearest relative (`t.name` to every name-like token the theme does not style itself, `t.paren` to brackets, `t.character` to strings); a tag with no relative is skipped and named in the log.
- A Notepad++ theme becomes one palette, not one per lexer: the first colour found for a role (keyword, string, comment, ...) reading the C++ lexer first is the theme's colour for that role. Notepad++ themes use the same colours across lexers, so the result looks like the theme; per-lexer differences are lost. Put the same file into a language folder to get a per-language palette.
- A plain `.css` palette relies on CSS nesting (Chromium 120, Safari 17.2). A stray closing brace in the file ends the wrapper early and the rest of the file applies to the whole app, which is the file's problem; the plugin does not parse CSS.
- The palette folder and one level of subfolders are read; deeper folders are ignored and named in the log.
- Palettes are read at start, on Reread (button or command), and when a palette file is saved from this plugin. An edit made with another program needs Reread.
- "Create example…" reads the theme's colours for the other variant by swapping the body's theme class for one synchronous style computation; a theme that keys its colours on something else than `.theme-dark` / `.theme-light` yields the current variant's colours for both files.
- A vault language definition replaces the bundled one for its extensions while the file is there, grammars included: a `python.json` in the folder turns Python into a keyword-highlighted language until it is removed. That is the rule asked for ("from the folder while it is there"); the log's `[languages]` line names every replacement.
- Native folder and file dialogs exist on the desktop only; on mobile the folder rows show the path with Reread and Create example, and Run does not exist.
- The in-pane page view renders the HTML alone: scripts do not run, nothing loads from the network or the vault (images and stylesheets referenced by path stay blank; `data:` images and inline styles show). An MHTML archive contributes its HTML part only; its packed images are not resolved yet.

## Run

- Desktop only: no process API exists on mobile, and the JavaScript sandbox, which would work there, is not offered on mobile either in this version (spec constraint; open item).
- The plugin runs what the runner names. Whether `python` is Python 3, whether `node` is new enough for `--experimental-strip-types`, whether `cc` exists, is the machine's business; a missing tool is reported as "not found" in the panel.
- Errors are not mapped back to editor lines: the panel shows the interpreter's text as it is.
- The JavaScript sandbox counts `setTimeout`/`setInterval` to know when a script is done; a script that keeps an interval alive runs until the timeout. Promises resolve before the check, so `await`ed work is included. `import`/`export` syntax is not accepted (a classic worker); scripts needing modules or Node APIs go to the Node runner.
- Killing on POSIX signals the process group (`detached: true`); an interpreter that changes its own group escapes it. On Windows `taskkill /T` is used. A process that survives both is not this plugin's to fix.
- The panel's open/closed state is remembered per file on this device; its output is not.

## Platform

- Whether the mobile vault adapter's `rename` replaces an existing file has not been confirmed on a device. When it refuses, the transport falls back to overwriting the file in place after the complete new bytes are on disk under a temp name, so a failure leaves a recovery copy rather than a truncated file.
- The desktop transport writes through Node's filesystem, so Obsidian learns of the change through its file watcher rather than through its own write path. Other panes showing the same file update when the watcher fires.

## Not yet built

Office documents, backups and restore, the Style Settings block for palettes, the formula engine and the legacy formats are all planned and none of it exists yet; the README carries the order.
