# Native File Editor

An Obsidian plugin that makes every text-like file in the vault, and Office documents, first-class: they open in a tab, look like the rest of Obsidian, and can be edited in place.

**Status: in development, not released.** Nothing is published to the community directory until the whole plan below is built and judged on a device. The current build opens text and code files (over 200 extensions: the fourteen official CodeMirror grammars plus the legacy stream modes) in a CodeMirror 6 view (read-only preview or editor) with the highlighting of Obsidian's own code blocks, folding, and autosave. Everything else is still to come.

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

Obsidian's file explorer only lists files whose extension is registered by some plugin, or all files when "Detect all file extensions" is on in Files and links.

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
