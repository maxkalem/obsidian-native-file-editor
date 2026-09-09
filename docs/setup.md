# Setup

## Installing a development build

Copy the `native-file-editor/` folder from the repository into `<vault>/.obsidian/plugins/` and enable the plugin in Settings, Community plugins. The folder holds `main.js`, `manifest.json` and `styles.css`, filled by `npm run build`; the three travel together whenever any of them changed.

On Windows, `copy.bat <vault>` does the copy (keeping settings) and `clean.cmd <vault>` removes the installed plugin folder first, settings included. Instead of the argument, set `NFE_VAULT` or create a `local.cmd` next to the scripts with `set NFE_VAULT=C:\path\to\vault`; it is git-ignored. Reload the plugin in Obsidian afterwards.

## Seeing the files

Obsidian's file explorer lists a file only when some plugin has registered its extension, or when "Detect all file extensions" is on in Settings, Files and links. Native File Editor registers its extensions at load, so `.txt` and `.log` files appear once it is enabled.

## Other plugins that open the same files

At load the plugin leaves alone every extension another plugin already opens, and shows one notice saying which. To take one over, turn its toggle on under Settings, Native File Editor, File types, then reload the plugin. The toggles are shared across devices through `data.json`.

## Settings

Shared across devices: initial mode (preview first, always editing, or remember per file), line numbers, word wrap, tab size, tab inserts spaces, the palette folder, and the file-type toggles.

This device only: the large-file limit (a file above it opens in preview with an Edit button that asks before building the editor), and everything under Run: the toggle, the timeout, the output limit, the runner list.

## Adding a language without a release

Settings, Native File Editor, Languages, **Use custom languages**; the folder row appears (default `.obsidian/plugins/native-file-editor/languages/`; **Choose folder…** creates the current folder if missing and opens the native folder dialog there; the choice must be inside the vault). **Create example…** writes the plugin's own table for a keyword-based language as `<lexer>.json`; edit it and press **Reread**. Or write a file from scratch in this shape (`docs/languages/hollywood.json` in the repository is a complete one):

```json
{
  "name": "Xlang",
  "extensions": ["xl", "xlang"],
  "caseInsensitive": false,
  "commentLine": "//",
  "commentStart": "/*",
  "commentEnd": "*/",
  "sets": [
    ["keyword", ["if", "else", "return"]],
    ["type", "int string bool"],
    ["builtin", ["print"]]
  ]
}
```

`sets` roles are `keyword`, `builtin`, `type`, `constant`, `property`, `meta` and `special`; words may be a list or one space-separated string. While a file is in the folder its definition is used for its extensions, bundled or not; the log's `[languages]` line names what each file registered and what it replaced, or why it did not load. A new extension is registered at **Reread**; one another plugin serves waits for **Reload plugin**. To open an extension no table names, use Settings, File types, Custom file types, **Add**. The bundled tier-4 tables come from Notepad++ through `node scripts/convert-langs-model.mjs "C:\Program Files\Notepad++\langs.model.xml"`, which rewrites `src/highlight/langs.generated.ts` and the examples under `docs/languages/`.

## Palettes

Settings, Palettes, **Use custom palettes**; the folder row appears with the same buttons. **Create example…** asks for a language and writes `<Language>_light.css` and `<Language>_dark.css` from the theme's own colours: working palettes that change nothing until edited. Edit a value, press **Reread** (or save the file from inside the plugin, which rereads by itself). A Notepad++ theme from `Notepad++\themes\` or a CodeMirror theme module dropped into the folder works as it is; name it `<Language>_dark.xml` to limit it to one language and theme, or leave the name as it is for every file. The README says how names are read.

## Run (desktop)

Settings, Native File Editor, Run (this device), **Enable Run**; the timeout, the output limit, your interpreters and **Add interpreter…** appear under it. A Run button appears in the head bar of every file the plugin can run; the commands "Run file" and "Stop run" can take hotkeys. The panel under the editor shows the output, stdout in the text colour and stderr in the error colour, then the exit code and the time.

Without interpreters, JavaScript runs in the sandbox and `.html` / `.mht` files render inside Obsidian (their inline scripts run in a sandboxed frame; nothing loads from the network). Everything else needs an interpreter you add: **Add interpreter…**, pick the language, pick the program. Interpreters are yours to install; the plugin never downloads anything. The row's line is the program, then its arguments: `{file}` is the file's path, `{dir}` its folder, `{stem}` its name without extension, `{tmp}` a scratch folder for that run, removed afterwards; the language's usual arguments are filled in for you (`--experimental-strip-types {file}` for TypeScript through Node, `run {file}` for Go, `/c {file}` for Batch through cmd, `-NoProfile -File {file}` for PowerShell). The folder icon picks another program; the pencil turns the line into a text field (quote anything with spaces; Enter or leaving the field saves); the trash icon removes the row, and the language goes back to what the plugin does by itself, if anything. Two rows for one language are not offered; edit the one you have.

A portable interpreter can live anywhere, including inside the vault, but not wisely inside the plugin folder: `clean.cmd` wipes it, a synced or Git-tracked vault carries it, and the path differs per device. Runner definitions are device-local and never sync.

**Timeout** and **Output limit** are per device; a run past either is killed. On Windows the kill goes through `taskkill /T`, on macOS and Linux through the process group, so the interpreter's children go with it.

Mobile has no Run: the button, the commands and this settings group do not exist there.

## The log

The plugin writes what it does to `<vault>/.obsidian/plugins/native-file-editor/nfe.log`: load, which extensions it took, every file opened (size, encoding, language, mode), saves, external changes, and every error with its stack. It rotates to `nfe.log.1` past 1 MB. When something fails to open or highlight, this file says why; attach it to a report. Because it sits in the vault, a vault under Git or Sync carries it; add `.obsidian/plugins/native-file-editor/nfe.log*` to the ignore list if that is unwanted.

## Creating files

Right-click a folder, "New file (Native File Editor)", type a name and a type: letters of the extension or language in the second field filter the list under it (`tt` finds `.txt`, `.http`, `.targets`; `typescript` finds `.ts`), the arrows and a click choose, Enter creates. An extension typed in the name (`notes.ts`) is used as typed while the type field is empty. A type the plugin does not open is allowed after a warning; Obsidian then decides what opens the file. The command "Native File Editor: New file" does the same in the active file's folder.

## Keys and the context menu

Ctrl+F opens the search panel (Ctrl+H the same with Replace, in the editor); its `?` opens a guide to regular expressions with copyable examples and a list of every key the editor answers to: several cursors (Ctrl+Alt+↑/↓, Ctrl+D, Ctrl+Shift+L, Alt+drag, Ctrl+click), moving and copying lines (Alt+↑/↓, Shift+Alt+↑/↓), comments (Ctrl+/, Alt+A), completion (Ctrl+Space), folding. A right click in the text opens a menu with the clipboard, the case of the selection, comments, completion, the date (its format under Settings → Editor → Date format / Time format, moment.js syntax; empty takes the Templates plugin's format), the direction of the current line, and a web search for the selection in the system browser. Several cursors behave as in Notepad++: Alt+drag keeps a caret past a shorter line's end and pads with spaces when you type; with several cursors the arrows stop at each line's ends.

## Building from source

```
npm install
npm test             # unit tests
npm run test:e2e     # real fixture files through the transports and the text model
npm run build        # strict type check, then bundle to main.js
npm run size         # what each bundled package adds to main.js
```

Node 22 is what CI uses.
