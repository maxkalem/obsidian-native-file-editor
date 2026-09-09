# Architecture

## What the plugin does

Obsidian shows and edits Markdown. Native File Editor makes every other text-like file in the vault, and Office documents, first-class: they open in a tab, look like the rest of Obsidian, and can be edited in place. Files are read from their own bytes and rendered into Obsidian's DOM. Nothing is converted through PDF or an external office suite, and the plugin never uses the network.

## The mental model

Views on top, models in the middle, formats and platform at the bottom, and nothing skips a layer.

```
src/
  main.ts              entry: settings load, view registration, the claim rule, the command
  constants.ts         PLUGIN_ID, view types, frozen command ids, defaults
  core/                pure decisions: which extensions to claim, which mode to open in, the autosave debounce
  model/               document models, pure, no DOM, no Obsidian (also MIT-licensed, see below)
    text/              bytes to text and back: BOM, encoding, line endings
  format/              readers and minimal-patch writers per format, pure (also MIT-licensed)
  platform/            the transport: the only code that knows whether it runs on a phone
  highlight/           the language registry (four tiers), the token table, the highlighter, the Obsidian-fork adapter,
                       the generic keyword mode with the Notepad++ tables (generated) and the vault language loader
  palette/             palettes: the model, the three converters (CSS, Notepad++ XML, CodeMirror theme modules), the folder loader
  run/                 Run (ADR-004): runner definitions, the executor, the process runner (the only child_process), the worker sandbox, the panel
  settings/            shared preferences (data.json), device-local state (localStorage), the settings tab
  ui/                  views and modals; the CodeMirror factory behind an editor interface
```

A view never sees bytes: it hands them to the text model and gets text and a description back. A format module never sees the DOM. The transport is the only code that knows whether it is running on Electron or in a WebView: everything above it takes and returns `Uint8Array` and vault-relative paths.

## The transport

`platform/transport.ts` is the interface: `readBinary`, `writeBinaryAtomic`, `inflateRaw`, `deflateRaw`, `listDir`, `mkdir`. `desktop.ts` uses Node's `fs` and `zlib` through Electron's `require`, resolved lazily so the same `main.js` loads on a phone. `mobile.ts` uses the vault adapter and the Web Streams compression API. `select.ts` picks one at load, and the choice is a pure function a test can ask.

Writes go to a dot-prefixed sibling temp file that is then renamed over the target, so a write that fails midway leaves the original in place and Obsidian's file index never sees the temp file. Whether the mobile adapter's rename replaces an existing file is not documented; when it refuses, the mobile transport overwrites the target directly and only then removes the temp file, so the complete new bytes survive beside the original if that overwrite fails.

The text view reads and writes through the transport rather than through `Vault.modifyBinary`, so there is one write path with one atomicity story for every family. Obsidian learns of the change through its own file watcher, the same way it learns of an external editor's save.

## The text view

`ui/TextView.ts` is a `FileView` with two modes, and both are the same CodeMirror 6 `EditorView` built from the core packages Obsidian provides (`@codemirror/state`, `view`, `language`, `commands`, `search`): preview is the read-only instance, edit the editable one with its undo history and the write path. CodeMirror renders only the visible lines and parses incrementally, so a large file previews in a frame whatever its size; the large-file gate is about the editing mode. An earlier preview built as a `pre` of highlighted spans froze on a 1.1 MB single-line file and was replaced. The editor sits behind `ui/editor.ts`, an interface of named operations (text, search, the context menu's edits, per-line direction), so the view's behaviour is tested against a fake and CodeMirror is only ever touched by `ui/codemirror.ts`. Three things CodeMirror does not do on its own live there too: Obsidian's `@codemirror/commands` (an external, older than 6.8) has no `addCursorAbove`/`Below`, so the plugin binds its own copy on Mod+Alt+Arrow; a direction forced on one line is a line decoration whose class styles.css turns into `direction` and `unicode-bidi: isolate`; completion is on request only (`activateOnTyping: false`), the document's words through `completeAnyWord` as language data for every language.

Autosave is a debounce (`core/autosave.ts`) with one write in flight at a time; leaving edit mode or the file flushes it. An external change reloads the pane unless it has unsaved typing, in which case the pane's text wins and the next autosave writes it. A file whose bytes are not valid UTF-8 and carry no BOM is decoded by a single-byte guess and shown read-only, because writing the guess back unasked would rewrite bytes the user never touched; Edit opens `ui/ReadOnlyModal.ts`, where the user takes a UTF-8 copy beside the file or confirms the encoding, after which `model/text/encoding.ts` writes the same code page back (its encoder is the platform decoder's table reversed) and refuses a character the page cannot hold rather than substituting one.

Files above a per-device size threshold open in preview whatever the initial-mode setting says; the Edit button then opens a modal that explains why and offers to edit anyway.

## Nothing escapes onLoadFile

An exception out of a view's `onLoadFile` is what Obsidian shows as "Failed to open", with no reason attached. So the view catches at every step that can fail (read, language resolution, editor construction, preview highlighting), logs the stack, and degrades: no language, an editor without the language extension, a plain preview, or an error panel. The plugin also runs a self-test of the stream-mode machinery at load and logs the result, because the CodeMirror packages Obsidian provides are not the ones the bundle was built against.

## The log

`core/log.ts` is a ring buffer plus a debounced file sink; `platform/logSink.ts` writes through the vault adapter to `<config>/plugins/native-file-editor/nfe.log`, rotating at 1 MB. Every open, save, external change and error goes there. It is the first thing to read for a device report.

## Coexistence: cover everything, yield by default

`registerExtensions` overwrites another plugin's claim silently and restores it on unload, so the winner depends on load order. On load the plugin reads Obsidian's view registry, registers only the extensions nobody owns, and shows one notice naming what it left alone; the notice repeats only when that set changes. A per-extension toggle in settings takes any extension over deliberately, and applies at the next plugin reload. `core/claims.ts` holds the rule and never takes an extension Obsidian itself owns.

## Two kinds of state

`data.json` travels with the vault through any sync, so it holds only preferences every device should share: the per-extension toggles, the initial mode, the editor's cosmetic options. Everything that decides how much work a particular device does, or what it last showed, lives in `localStorage` scoped by the vault id: the last mode per file, the large-file threshold, the last yield notice shown.

## Tokens look like Obsidian's own code blocks

Every token span carries two classes: Obsidian's `cm-*` name (the CodeMirror 5 vocabulary Obsidian uses in Live Preview code blocks) and the plugin's stable `nfe-tok-*` name. The editor root carries `cm-s-obsidian` and uses the code-block font variables, so a `.ts` file looks exactly like a ```ts block in a note. The plugin's own `nfe-tok-*` rules in `styles.css` are the fallback for tokens Obsidian has no rule for, and the vocabulary a palette overrides.

The highlighter matches tags by name (`"keyword"`, `"definition(variableName)"`), never by tag identity or id, so it does not depend on which copy of `@lezer/highlight` tagged a token. Obsidian's `@codemirror/language` is a fork whose `StreamLanguage` tags tokens with its own `tokenClassNodeProp` and colours them through a separate `lineHighlighter` extension; `highlight/obsidianFork.ts` is the only module that knows this, adapts the stream modes' token names to the CM5 vocabulary the fork's decorator expects, and is a no-op against npm's package. `highlight/highlighter.ts` also carries `tokenize`, a standalone parse plus highlight used by the load-time self-test and the test suites, with a by-shape walk of the tree as its fallback.

## Four tiers of languages, one registry

`highlight/registry.ts` is the only module that names an extension. Its entries are ordered by quality and the first registration of an extension wins: tier 1, the official lezer packages; tier 3, the community lezer packages that passed a licence and size check (each named with its size in `THIRD_PARTY_NOTICES.md`); tier 2, the legacy stream modes, adapted to Obsidian's fork; tier 4, the Notepad++ keyword tables in `langs.generated.ts` (produced by `scripts/convert-langs-model.mjs`, committed, never edited) through the one generic `keywordMode`, whose word map is built on first open rather than at load. A JSON definition from the vault's language folder (`highlight/vaultLanguages.ts`, `parseKeywordLanguage`) is registered at load through `registerVaultLanguage`, which takes only the extensions nothing bundled already claims, and runs before the plugin registers its extensions with Obsidian, so a vault language is claimed like a bundled one. `tests/registry.test.ts` fails on any duplicate extension between bundled entries and asserts the union of what the two replaced plugins register.

## Palettes are files in the vault, applied as one stylesheet

`palette/loader.ts` reads the palette folder (a shared setting; default under the plugin folder) and one level of subfolders through the transport, converts every file it understands and hands the concatenated CSS to a `StyleSink`, which `ui/styleSink.ts` implements as one `<style>` element in the document head, replaced in place on every reload. Three converters share one model (`palette/model.ts`: rules of host-relative selectors and declarations, plus the chrome settings every source maps onto): a `.css` file is wrapped as the body of a nested rule on the editor host; a Notepad++ theme is parsed from its attribute-only XML with regular expressions and mapped by style-name meaning onto token roles; a CodeMirror theme module is scanned as text, string-aware, for its `{ tag, color }` rules, its `settings` object and its `EditorView.theme` block, with the tag names resolved against the token table (`selectorsForTagName`, `TAG_EQUIVALENTS`). No code from the vault is ever executed.

Scope is the file's name, `<Scope>_<light|dark>.<ext>` (`scopeForFileName`): `palette/render.ts` turns it into attribute selectors on the editor host (`data-nfe-ext`, `data-nfe-lang`, `data-nfe-name`, set by the text view) under the `.theme-light` / `.theme-dark` body class when the name has a variant, and every generated selector starts with `.nfe-text-content .nfe-body .nfe-editor`, three classes, so a palette rule outranks Obsidian's global `.cm-*` rules and the plugin's own fallbacks in `styles.css` without `!important`, and a scoped rule outranks an unscoped one by its attribute. Nothing is written unasked: "Create example…" in settings writes `<Language>_light.css` and `<Language>_dark.css` from the theme's live colours (`ui/themeColours.ts` reads the other variant by swapping the body class for one style computation), and a file in the folder overrides the theme for as long as it is there. The whole feature sits behind the shared switch `customPalettes`; off, the sink is emptied.

## Settings: declarative, with rendered rows behind switches

`settings/SettingsTab.ts` uses Obsidian 1.13's declarative tab. Simple controls are keyed rows; the folder rows, the interpreter rows and the custom-type rows are `render` items built on a `Setting` with buttons; the rows behind a switch carry `visible`, and every write that changes what is visible calls `refresh` (the tab's `update()`). Native dialogs, "open in explorer" and the plugin restart go through `platform/desktopShell.ts` (Electron's `shell` and `remote.dialog`, lazily required; null on mobile, and then the rows show paths without buttons). The registry is mutable for two things only: vault definitions and custom file types (`registerVaultLanguage`, `registerCustomExtension`), which win for their extensions while present and are cleared and re-applied on every Reread; a Reread registers new extensions with Obsidian at once and leaves those another plugin owns to the yield rule.

## Run: the user's interpreters, behind one interface

`run/runners.ts` is data and pure functions: the default definitions, placeholder expansion, validation and normalisation of what settings and storage hand over. `run/execute.ts` turns one definition plus one file into a sequence of steps against two interfaces, `ProcessRunner` and `WorkerRunner` (`run/runner.ts`), and owns the per-run temp directory; it never names a platform API. `run/process.ts` is the one implementation of `ProcessRunner` and the only module in the plugin that names `child_process`, resolved lazily through Electron's `require` like the desktop transport, with `shell: false`, argv arrays, a timeout, a process-tree kill and an output cap. `run/worker.ts` implements `WorkerRunner` with a Blob-built Web Worker whose prelude forwards `console.*`, removes the network from the worker's global scope, and counts timers to know when the script is done. `run/RunPanel.ts` is the DOM: it talks to `execute` through a handle and is tested against a fake. `run/setup.ts` wires the four on the desktop and returns null anywhere else, and null means the view shows no button, registers no command, and the settings tab has no Run group.

The feature is off by default behind a per-device toggle and starts only from the button, the command or its hotkey. The reasoning, the corrections made with the user ("no sandbox for native interpreters", "not in the plugin folder") and the reviewer-facing account are in `docs/ADR-004-run-code-with-user-interpreters.md` and `docs/threat-model.md`.

## Two licences, one import direction

The plugin is GPL-3.0-only. `src/format/` and `src/model/` are additionally MIT, so the format layer can be adopted by MIT-licensed plugins. That is only true as long as those two directories import nothing from the rest of `src/`, where GPL-derived keyword tables will live, and nothing from Obsidian or the DOM. `tests/licenceBoundary.test.ts` asserts the import direction on every run.

## What it deliberately does not do

Fetch anything at runtime: language modes, themes and palettes arrive with a release, never over the wire. Serialise the DOM back into a file: the model is the truth and the DOM is a projection of it. Regenerate an Office file on save: the writer patches only the parts whose model changed and copies every other entry through byte for byte. Use a CodeMirror theme object: highlighting emits stable classes and the look is CSS bound to Obsidian's variables.
