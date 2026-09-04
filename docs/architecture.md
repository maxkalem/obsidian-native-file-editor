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
  highlight/           the language registry; later the tokenizer, highlighter and palette loader
  settings/            shared preferences (data.json), device-local state (localStorage), the settings tab
  ui/                  views and modals; the CodeMirror factory behind an editor interface
```

A view never sees bytes: it hands them to the text model and gets text and a description back. A format module never sees the DOM. The transport is the only code that knows whether it is running on Electron or in a WebView: everything above it takes and returns `Uint8Array` and vault-relative paths.

## The transport

`platform/transport.ts` is the interface: `readBinary`, `writeBinaryAtomic`, `inflateRaw`, `deflateRaw`, `listDir`. `desktop.ts` uses Node's `fs` and `zlib` through Electron's `require`, resolved lazily so the same `main.js` loads on a phone. `mobile.ts` uses the vault adapter and the Web Streams compression API. `select.ts` picks one at load, and the choice is a pure function a test can ask.

Writes go to a dot-prefixed sibling temp file that is then renamed over the target, so a write that fails midway leaves the original in place and Obsidian's file index never sees the temp file. Whether the mobile adapter's rename replaces an existing file is not documented; when it refuses, the mobile transport overwrites the target directly and only then removes the temp file, so the complete new bytes survive beside the original if that overwrite fails.

The text view reads and writes through the transport rather than through `Vault.modifyBinary`, so there is one write path with one atomicity story for every family. Obsidian learns of the change through its own file watcher, the same way it learns of an external editor's save.

## The text view

`ui/TextView.ts` is a `FileView` with two modes. Preview is a `pre` with the text, highlighted by one parse when the file is small enough (size, longest line and token count all under their caps), so a large file still renders in under a frame. The parse goes through `EditorState` and `ensureSyntaxTree`, never `parser.parse()` directly: Obsidian's stream parser needs a parse context. Edit builds a CodeMirror 6 `EditorView` from the core packages Obsidian provides (`@codemirror/state`, `view`, `language`, `commands`, `search`), with the plugin's own extension set and none of Obsidian's Markdown extensions. The editor sits behind `ui/editor.ts`, a four-method interface, so the view's behaviour is tested against a fake and CodeMirror is only ever touched by `ui/codemirror.ts`.

Autosave is a debounce (`core/autosave.ts`) with one write in flight at a time; leaving edit mode or the file flushes it. An external change reloads the pane unless it has unsaved typing, in which case the pane's text wins and the next autosave writes it. A file whose bytes are not valid UTF-8 and carry no BOM is decoded by a single-byte guess and shown read-only, because writing the guess back would rewrite bytes the user never touched.

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

Every token span carries two classes: Obsidian's `cm-*` name (the CodeMirror 5 vocabulary Obsidian uses in Live Preview code blocks) and the plugin's stable `nfe-tok-*` name. The preview and the editor root carry `cm-s-obsidian`, so Obsidian's stylesheet and the active theme colour a `.ts` file exactly as they colour a ```ts block in a note. The plugin's own `nfe-tok-*` rules in `styles.css` are the fallback for tokens Obsidian has no rule for, and the vocabulary a palette overrides.

## Two licences, one import direction

The plugin is GPL-3.0-only. `src/format/` and `src/model/` are additionally MIT, so the format layer can be adopted by MIT-licensed plugins. That is only true as long as those two directories import nothing from the rest of `src/`, where GPL-derived keyword tables will live, and nothing from Obsidian or the DOM. `tests/licenceBoundary.test.ts` asserts the import direction on every run.

## What it deliberately does not do

Fetch anything at runtime: language modes, themes and palettes arrive with a release, never over the wire. Serialise the DOM back into a file: the model is the truth and the DOM is a projection of it. Regenerate an Office file on save: the writer patches only the parts whose model changed and copies every other entry through byte for byte. Use a CodeMirror theme object: highlighting emits stable classes and the look is CSS bound to Obsidian's variables.
