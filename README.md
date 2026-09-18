# Native File Editor

An Obsidian plugin that makes every text-like file in the vault, and Office documents, first-class: they open in a tab, look like the rest of Obsidian, and can be edited in place.

**Status: in development, not released.** Nothing is published to the community directory until the whole plan below is built and judged on a device. The current build opens text and code files (over 200 extensions: the fourteen official CodeMirror grammars, seven community grammars for Svelte, Astro, Elixir, HCL, Nix, Solidity and Prisma, an own GraphQL mode, plus the legacy stream modes) in a CodeMirror 6 view (read-only preview or editor) with the highlighting of Obsidian's own code blocks, folding, autosave, and palettes read from CSS, Notepad++ or CodeMirror theme files. Everything else is still to come.

## What "native" means here

Files are read from their own bytes and rendered into Obsidian's DOM. There is no conversion through PDF, no LibreOffice, no WPS, no Office COM, and no network: the plugin never fetches anything after it is installed, and language modes, themes and palettes arrive only with a release. The editor core and its language modes come from CodeMirror; every format reader and writer is this plugin's own code.

## Plan

1. Text and code: a CodeMirror 6 editor for every extension named in Notepad++'s language list, with bundled grammars for the common languages and a keyword-based fallback for the rest, autosave, a preview-first mode, and per-extension toggles.
2. Palettes as plain CSS, following the active theme by default, with importers for Notepad++ and CodeMirror themes.
3. `.xlsx` read-only, as a grid in the Bases idiom.
4. `.xlsx` editing through a minimal patch of the original archive, with a backup before every write and a restore modal.
5. `.docx` read, then WYSIWYG edit.
6. `.pptx` and `.ppsx` read, then text edit.
7. A formula engine and Recalculate.
8. Legacy `.xls`, `.doc`, `.ppt` and `.pps`, read-only, with "Create editable copy" to the OOXML sibling.
9. Further export targets.

## Coexistence with other plugins

On load the plugin asks which extensions already have an owner and leaves those alone, with one notice naming what it left and a per-extension toggle in settings to take any of them over deliberately. `CM Code Editor` by @gapmiss does the code half well today, with more lezer grammars, folding, autocomplete and search; Native File Editor adds Office documents, fallback highlighting for extensions no grammar package covers, palettes as editable CSS, and one editor with one backup model across every file type.

Obsidian's file explorer only lists files whose extension is registered by some plugin, or all files when "Detect all file extensions" is on in Files and links. Obsidian's own index can also keep files that a batch rename outside Obsidian removed, and a plugin registering this many extensions makes every such ghost visible; after load, two seconds after a burst of new files (what a batch rename looks like from inside) and on **Reread** the plugin compares its files with the disk and asks Obsidian to drop the ones that no longer exist (`[vault]` lines in the log).

## Languages

Highlighting comes in four tiers, and a file gets the best one available for its extension. Tier 1: the fourteen official CodeMirror grammars (JavaScript and TypeScript, Python, HTML, CSS, JSON, XML, YAML, SQL, Markdown, Rust, Go, Java, PHP, C and C++). Tier 3: eight community grammars (Svelte, Astro, Elixir, HCL and Terraform, Nix, Solidity, Prisma, Assembly) and own modes for GraphQL, Makefile, txt2tags, MHTML and the hex-record formats. Tier 2: the CodeMirror legacy stream modes for a hundred more (Shell, Ruby, Lua, C#, Kotlin, Swift, PowerShell, Dockerfile, TOML, ...). Tier 4: keyword tables converted from Notepad++'s `langs.model.xml` for 25 languages nothing else covers (Batch, AutoIt, Inno Setup, GDScript, Raku, Ada, Nim, PostScript, ...), highlighted by one generic mode: comments, strings, numbers and the keyword sets. The bundled set covers every extension `CM Code Editor` and `obsidian-code-editor` register, plus every extension Notepad++ names, except `.svg`, which Obsidian owns.

A language can also arrive without a release. Settings, Languages, **Use custom languages** shows the language folder row (default `.obsidian/plugins/native-file-editor/languages/`), with the same **Choose folder…** / **Reread** / **Create example…** buttons as the palette folder. **Create example…** lists the keyword-based languages and writes the plugin's own table for the one you pick as `<lexer>.json`, ready to edit; a definition has a `name`, `extensions`, optional `commentLine` / `commentStart` / `commentEnd`, `caseInsensitive`, and `sets` of `[role, words]` where the role is one of `keyword`, `builtin`, `type`, `constant`, `property`, `meta`, `special` ([docs/languages/hollywood.json](docs/languages/hollywood.json) is the Hollywood table in that shape, kept out of the bundle for its size). While a file is in the folder its definition is used for its extensions, in place of the plugin's own; remove it and the bundled one is back. New extensions are registered at **Reread**; an extension another plugin serves stays with it until the plugin reloads.

**Dictionaries.** Prose commands need a different kind of word list: which hyphen belongs to a word (кое-що, self-evident, linja-auto) and which one a printer left at the end of a line. Fifteen text languages ship with the plugin — Ukrainian, Russian, English, French, German, Italian, Spanish, Finnish, Irish, Scottish Gaelic, Welsh, Arabic, Crimean Tatar, Norwegian, Swedish — and Settings, Dictionaries, **Use custom dictionaries** shows a folder row with the same buttons (default `.obsidian/plugins/native-file-editor/dictionaries/`). A dictionary is `{ "name": …, "prefixes": [], "suffixes": [], "words": [] }`: particles without their hyphen, words with a hyphen kept as they are and words without one saying that the word exists. A file named after a bundled language adds to it, `"replace": true` replaces it, any other name is a language of its own. Right-click a word in the editor or in a note and pick **Add to dictionary…** to put it into a text language's lists, or into a keyword-based language's definition with the element it should be.

**Language.** The plugin speaks English. One file next to it — `localization.json` in its own folder — replaces that text with your language; there is nothing to choose and nothing to configure, and anything the file leaves out stays English, key by key. [`locales/english.json`](locales/english.json) is the whole plugin in English, ready to translate over, and [`locales/uk.json`](locales/uk.json) is a finished Ukrainian one. [docs/localization.md](docs/localization.md) has the four steps.

**Custom file types.** Settings, File types (a page that also holds the on/off switch for every known extension), **Custom file types**, **Add**: type an extension, pick the language that opens it. This is how a file type gets into the plugin when you have written a definition or a palette for it, or want `.foo` opened as plain text.

**Reload plugin.** Settings, Plugin, **Reload plugin** restarts Native File Editor, which applies file-type changes and rereads everything. The settings window closes for the restart and reopens on this plugin's page. Which build is running: the `Build:` line in the comment at the head of `main.js` and the first `[plugin] load … build …` line of `nfe.log` carry the build stamp (UTC, `yyMMdd.HHmm` plus milliseconds), which tells two builds of the same version apart.

## Palettes

With no palette the editor follows the active Obsidian theme: tokens carry Obsidian's own `cm-*` classes and are coloured exactly like a code block in a note, in light and dark, by every community theme that sets the `--code-*` variables. A palette overrides that for the files it names.

**Switch it on.** Settings, Native File Editor, Palettes, **Use custom palettes**. The folder row appears under it: the folder's path, **Choose folder…** (creates the current folder if missing and opens the native folder dialog there; the choice must be inside the vault), **Reread**, and **Create example…**. The default folder is `.obsidian/plugins/native-file-editor/palettes/`.

**Create example…** asks for a language and writes two working files, `<Language>_light.css` and `<Language>_dark.css`, made of the colours the current theme actually uses for each variant: the `--code-*` variables with their real values, the editor background and text, the gutter, the active line, the selection. Nothing changes on screen until you edit a value; from then on that language follows the file, and while the file is in the folder it is used instead of the theme (delete it and the theme is back). The command "Create example palette for a language" does the same from the command palette.

**Names decide what a file applies to.** `<Scope>_light.css` applies in the light theme, `<Scope>_dark.css` in the dark one, `<Scope>.css` in both; the scope is a language as shown in the head bar (`JavaScript`, `C#`), an extension (`py`), or a file name (`app.js`). A name that is none of these (`Obsidian.xml`, `one-dark.js`) applies to every file. Scoped beats unscoped; among equals the later file in name order wins.

**Three formats, dropped in as they are.**

- A CodeMirror 6 theme from [codemirror.net/docs/community](https://codemirror.net/docs/community/): the module that defines it (`dist/index.js` or `src/index.ts` of `@codemirror/theme-one-dark`, a file from `thememirror/dist/themes/`, an `@uiw/codemirror-theme-*` module, or one you wrote). The plugin reads it as data: the `{ tag, color, fontStyle, ... }` rules, the `settings` object and the `EditorView.theme({...})` block, with colours as literals or constants in the same file. Nothing in the file is executed. A computed colour is skipped and named in the log. A module with a light and a dark theme contributes both, each under Obsidian's matching theme; a `_dark` or `_light` name keeps only that half.
- A Notepad++ theme: any file from `Notepad++\themes\` (`Obsidian.xml`, `Zenburn.xml`, ...). The editor colours come from `GlobalStyles`; token colours by role (keyword, string, comment, number, operator, type, ...) from the lexers in turn, C++ first. Bold, italic and underline come along.
- Plain CSS, as the example files are: a top-level declaration sets a variable for those files only, a nested rule styles one token class.

  ```css
  --code-keyword: #c678dd;
  .cm-comment { font-style: italic; color: #7d8799; }
  .cm-editor { background-color: #282c34; }
  ```

  Token classes are Obsidian's `cm-*` names (`cm-keyword`, `cm-string`, `cm-comment`, `cm-number`, `cm-operator`, `cm-variable`, `cm-def`, `cm-type`, `cm-builtin`, `cm-property`, `cm-attribute`, `cm-tag`, `cm-meta`, `cm-atom`, `cm-string-2`, `cm-error`, ...) and, on the bundled grammars, also the plugin's `nfe-tok-*` names. The editor host carries `data-nfe-ext`, `data-nfe-lang`, `data-nfe-name` and `data-nfe-path`, so one rule can single out one file: `&[data-nfe-path="Projects/app.js"] .cm-keyword { color: red; }`.

Palettes reload on **Reread**, on the command "Reread languages and palettes", and whenever a palette file is saved from inside the plugin. What a converter kept and skipped is in `nfe.log` under `[palette]`. Plain `.css` palettes rely on CSS nesting (Chromium 120, Safari 17.2), which current Obsidian builds have; the phone has not been checked.

## Run

On the desktop, a file can be run from its pane and its output read below the editor. The feature is off until you turn on **Enable Run** in Settings, Native File Editor, Run (this device); the rest of the group appears under it, the head bar gains a Run button for files the plugin can run, and the commands "Run file" and "Stop run" appear. Nothing ever runs on its own: not on open, not on save, not on a timer.

Without any interpreter of yours the plugin can run two things by itself: **JavaScript** in a sandbox (a Web Worker in Obsidian's own engine, with no DOM, no Obsidian API, no filesystem and no network, `console.*` and uncaught errors forwarded to the panel) and **web pages** (`.html`, `.mht`/`.mhtml`), rendered inside Obsidian in a sandboxed frame: the page's own scripts run, in an origin of their own with no way to Obsidian, an MHTML archive renders with the stylesheets and images it packs, and nothing loads from the network. Every other language needs an interpreter you add.

**Add interpreter…** at the bottom of the Run group: pick a language (every one the plugin knows, including the ones you defined; languages that already have an interpreter are not offered), then the program in a native file dialog. The row shows the language and the command line, the program first, then its arguments (`{file}`, `{dir}`, `{stem}` and `{tmp}` are replaced; the language's standard arguments are filled in, e.g. `go run {file}`), with a folder icon to pick another program, a pencil that turns the line into a text field, and a trash icon. An interpreter for JavaScript or HTML replaces the sandbox or the page view: Run then starts your program instead. A run is that program with the file's absolute path as one argument, in the file's folder, with your permissions, the same as typing the command in a terminal, with a timeout (default 30 s), a Stop button that kills the process and its children, and an output limit (default 1 MB). The plugin ships no interpreter and never downloads one; interpreters are per device and never sync.

The design and its limits are in [docs/ADR-004-run-code-with-user-interpreters.md](docs/ADR-004-run-code-with-user-interpreters.md) and [docs/threat-model.md](docs/threat-model.md). Mobile has no Run: no process API exists there.

## Backups

Every write to a user's file is preceded by a backup that can be restored from inside Obsidian. The backup folder lives in the vault (default `.obsidian/plugins/native-file-editor/backups/`), is configurable, and its retention is configurable with an unlimited option. Because it lives in the vault, it syncs with it; the setup guide says how to exclude it.

## Licence

The plugin as a whole is licensed under GPL-3.0-only. Two directories, `src/format/` and `src/model/`, are additionally offered under the MIT licence, each with a `LICENSE` file of its own.

The reason for the split: the format layer (ZIP, OOXML, the legacy binary formats) is the reusable part of this project and nothing else in the ecosystem has it, so it is offered under terms an MIT-licensed plugin can adopt. The rest of the plugin includes keyword tables converted from Notepad++, which is GPL-3.0, so the combined work is GPL. The two MIT directories import nothing from the rest of the plugin, and a test enforces that. `-only` rather than `-or-later` because the terms should not change without the author's decision; as the sole copyright holder he can widen it later, while the reverse is impossible.

Bundled third-party code is listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Documentation

- [docs/architecture.md](docs/architecture.md): the mental model and the reasoning behind anything that looks strange.
- [docs/setup.md](docs/setup.md), [docs/troubleshooting.md](docs/troubleshooting.md), [docs/limitations.md](docs/limitations.md).
- [docs/release.md](docs/release.md) for cutting a release.
