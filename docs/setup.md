# Setup

## Installing a development build

Copy the `native-file-editor/` folder from the repository into `<vault>/.obsidian/plugins/` and enable the plugin in Settings, Community plugins. The folder holds `main.js`, `manifest.json` and `styles.css`, filled by `npm run build`; the three travel together whenever any of them changed.

## Seeing the files

Obsidian's file explorer lists a file only when some plugin has registered its extension, or when "Detect all file extensions" is on in Settings, Files and links. Native File Editor registers its extensions at load, so `.txt` and `.log` files appear once it is enabled.

## Other plugins that open the same files

At load the plugin leaves alone every extension another plugin already opens, and shows one notice saying which. To take one over, turn its toggle on under Settings, Native File Editor, File types, then reload the plugin. The toggles are shared across devices through `data.json`.

## Settings

Shared across devices: initial mode (preview first, always editing, or remember per file), line numbers, word wrap, tab size, tab inserts spaces, the palette, language and dictionary folders, and the file-type toggles.

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

`sets` roles are `keyword`, `builtin`, `type`, `constant`, `property`, `meta` and `special`; words may be a list or one space-separated string. While a file is in the folder its definition is used for its extensions; it replaces a keyword-table language (one from the Notepad++ tables) or another vault file outright, but an extension held by a grammar or a hand-written mode (Python, TypeScript, JSON, …) is kept unless the file says `"replace": true` — a keyword table colours less than the grammar it would displace, so that is a choice to make on purpose. A file with no `sets` and no `patterns` is not loaded. The log's `[languages]` line names what each file registered, what it replaced or kept, or why it did not load. A new extension is registered at **Reread**; one another plugin serves waits for **Reload plugin**. To open an extension no table names, use Settings, File types, Custom file types, **Add**. The bundled tier-4 tables come from Notepad++ through `node scripts/convert-langs-model.mjs "C:\Program Files\Notepad++\langs.model.xml"`, which rewrites `src/highlight/langs.generated.ts` and the examples under `docs/languages/`.

## The plugin's language

Settings, Native File Editor, **Language**. The plugin is English until a file called `localization.json` sits in its own folder (`.obsidian/plugins/native-file-editor/`); then that file's text is used. **Open folder** shows the folder, **Reread** reads the file again after you edit it, and the row says which language is in force and how much of the plugin it covers. There is no language to pick: the file is the choice. Take `locales/english.json` from the repository as the thing to translate, or `locales/uk.json` as a finished Ukrainian one. [localization.md](localization.md) has the details.

## Dictionaries for Unwrap lines

Settings, Native File Editor, Dictionaries, **Use custom dictionaries**; the folder row appears with the same buttons (default `.obsidian/plugins/native-file-editor/dictionaries/`). The lists tell **Unwrap lines** which hyphen at a line end belongs to the word (кое-що, self-evident, linja-auto) and which one a printer left when it split a word. Fifteen languages ship with the plugin — Ukrainian, Russian, English, French, German, Italian, Spanish, Finnish, Irish, Scottish Gaelic, Welsh, Arabic, Crimean Tatar, Norwegian, Swedish — and the folder is how a missing word arrives without a release. **Create example…** writes the plugin's own lists for a language as `<Language>.json`; edit it and press **Reread**. A file in this shape:

```json
{
  "name": "Ukrainian",
  "prefixes": ["будь", "казна"],
  "suffixes": ["небудь", "таки"],
  "words": ["будь-що", "віч-на-віч", "непереносимий"],
  "keepSameVowel": false
}
```

A single word is faster to add from the text itself: right-click it in the plugin's editor (or in a note) and pick **Add to dictionary…**. The word under the cursor, or the selection, is prefilled and can be edited — `кое-` for a prefix, `-нибудь` for a particle. The dialog asks whether it is a text language (its word lists) or a programming language (its keyword sets, and which element the word is); the file is written into the folder of that kind, created from the plugin's own lists when it does not exist yet, and reread at once.

`prefixes` and `suffixes` are written without the hyphen. A word in `words` that has a hyphen is kept as it is; one without a hyphen says "this word exists", so a line end that split it is joined back. Everything is matched without case. A file named after a bundled language adds to it; `"replace": true` replaces it; any other name is a language of its own. `keepSameVowel` extends the rule that keeps a hyphen between two identical vowels to scripts other than the Latin one. All the dictionaries apply together, whatever the language of the text, so an entry should name a real hyphenated form rather than a syllable that ordinary words begin with. The decision reads the text itself first — a word the document writes out in full elsewhere decides its own case — and the lists answer what the text does not show. The log's `[dictionaries]` line names what each file did, or why it did not load.

## Palettes

Settings, Palettes, **Use custom palettes**; the folder row appears with the same buttons. **Create example…** asks for a language and writes `<Language>_light.css` and `<Language>_dark.css` from the theme's own colours: working palettes that change nothing until edited. Edit a value, press **Reread** (or save the file from inside the plugin, which rereads by itself). A Notepad++ theme from `Notepad++\themes\` or a CodeMirror theme module dropped into the folder works as it is; name it `<Language>_dark.xml` to limit it to one language and theme, or leave the name as it is for every file. The README says how names are read.

## Run (desktop)

Settings, Native File Editor, Run (this device), **Enable Run**; the timeout and output limit appear under it. Open **Interpreters** at the bottom of the Run group to add or manage programs on its own page. Its entry shows how many interpreters are configured on this device. A Run button appears in the head bar of every file the plugin can run; the commands "Run file" and "Stop run" can take hotkeys. The panel under the editor shows the output, stdout in the text colour and stderr in the error colour, then the exit code and the time. Its head has two views, **Output** and **Log**. Output is the result: a rendered page, or what the program hands out — a process's stdout, a sandbox script's `postMessage(...)` — rendered as a picture when it is a whole SVG or HTML document, shown as text otherwise. Log is the console, the whole run in order: the command line, the sandbox header, `console.log` as well as `console.warn`/`console.error` (in the error colour), a process's stderr (error colour), its stdout again when it is text, for a page its own console, script errors and every load the policy refused (one `[page …]` line each; a nested frame of an archive reports too), and the outcome as the last line — `[exit 0, 1.2 s]`, or `[exit 1, …]`, `[timed out after …]` in the error colour. A run opens on the Log and moves to Output when a result arrives, unless you clicked a tab meanwhile. The Log tab counts the problems (a bad outcome, a page's errors and refusals) while you look at Output; a run that ended badly shows its status in the error colour; **Copy** copies the view that is showing.

Without interpreters, JavaScript runs in the sandbox and `.html` / `.mht` files render inside Obsidian (their inline scripts run in a sandboxed frame; nothing loads from the network). Everything else needs an interpreter you add: open **Interpreters**, choose **Add interpreter…**, pick the language, pick the program. Interpreters are yours to install; the plugin never downloads anything. The row's line is the program, then its arguments: `{file}` is the file's path, `{dir}` its folder, `{stem}` its name without extension, `{tmp}` a scratch folder for that run, removed afterwards; the language's usual arguments are filled in for you (`--experimental-strip-types {file}` for TypeScript through Node, `run {file}` for Go, `/c {file}` for Batch through cmd, `-NoProfile -File {file}` for PowerShell). The folder icon picks another program; the pencil turns the line into a text field (quote anything with spaces; Enter or leaving the field saves); the trash icon removes the row, and the language goes back to what the plugin does by itself, if anything. Two rows for one language are not offered; edit the one you have.

A portable interpreter can live anywhere, including inside the vault, but not wisely inside the plugin folder: reinstalling the plugin wipes that folder, a synced or Git-tracked vault carries whatever is in it, and the path differs per device. Runner definitions are device-local and never sync.

**Timeout** and **Output limit** are per device; a run past either is killed. On Windows the kill goes through `taskkill /T`, on macOS and Linux through the process group, so the interpreter's children go with it.

Mobile has no Run: the button, the commands and the Run settings group and the Interpreters page do not exist there.

## The log

The plugin writes what it does to `<vault>/.obsidian/plugins/native-file-editor/nfe.log`: load, which extensions it took, every file opened (size, encoding, language, mode), saves, external changes, and every error with its stack. It rotates to `nfe.log.1` past 1 MB. When something fails to open or highlight, this file says why; attach it to a report. Because it sits in the vault, a vault under Git or Sync carries it; add `.obsidian/plugins/native-file-editor/nfe.log*` to the ignore list if that is unwanted.

## Creating files

Right-click a folder, "New file (Native File Editor)", type a name and a type: letters of the extension or language in the second field filter the list under it (`tt` finds `.txt`, `.http`, `.targets`; `typescript` finds `.ts`), the arrows and a click choose, Enter creates. What you typed is the extension unless you picked a row (`z` makes `.z`, not the list's `.z80`); letters of any script count. An extension typed in the name (`notes.ts`) is used as typed while the type field is empty. An empty name with a type, or a name that is only an extension (`.gitignore`), makes a dot-file, after a warning: Obsidian hides paths that start with a dot, so the file is on the disk but not in the explorer and this plugin cannot open it. A type the plugin does not open (or no extension at all) is allowed after a warning; Obsidian then hands the new file to the system, which asks what opens it. The command "Native File Editor: New file" does the same in the active file's folder.

## Keys and the context menu

Every key the plugin takes is listed on its own settings page, Settings → Native File Editor → Hotkeys (the row says how many differ from the defaults). Defaults and changes are per platform: Windows and Linux share one set, macOS has its own where the Mac differs (Cmd+Alt+F for replace, Cmd+G for the next match, Alt+Space for completion, Cmd+Alt+/ for the block comment), and a change made on one kind of machine does not apply on the other. Each row has a pencil that records a new combination and an arrow back to the default; the `?` in the pane's head bar opens a guide that shows the keys as they are mapped, then the regular expressions the search understands. Keys that act inside the text (add cursor, move or copy a line, block comment) run after Obsidian's own hotkeys, so a combination Obsidian uses for itself cannot reach them: such a row names the Obsidian command in the warning colour, and the recorder says so when the key is pressed; the others (search, occurrences, line comment, completion) are taken ahead of Obsidian, and their rows note an Obsidian command on the same key without warning. By default: Ctrl+F opens the search panel (Ctrl+H the same with Replace, in the editor); the guide lists every key the editor answers to: several cursors (Ctrl+Alt+↑/↓, Ctrl+D, Ctrl+Shift+L, Alt+drag, Ctrl+click), moving and copying lines (Alt+↑/↓, Shift+Alt+↑/↓), comments (Ctrl+/, Alt+A), completion (Ctrl+Space), folding. A right click in the text opens a menu with the clipboard, the case of the selection, comments, completion, the date (its format under Settings → Editor → Date format / Time format, moment.js syntax; empty takes the Templates plugin's format), the direction of the current line, and a web search for the selection in the system browser. In a text file (plain text, Markdown variants, txt2tags, Textile, or a type with no language) the same menu has "Unwrap lines" and "Wrap lines…". Text copied out of a PDF, an e-book, a DOC conversion or a mail arrives with a line break every 60 to 100 characters, and Unwrap joins those lines back into paragraphs, for the selected lines or the whole file, as one undo step. It measures the wrap width on the text itself, joins a line only when it is long enough to have been cut by the wrapper, and leaves alone anything that is a line of its own (a page number, a title, a heading, a list item, a quote, a table row, a code block, a line ending in a Markdown hard break) and every blank line, except that a text with a blank line after every wrapped line (the shape a DOC conversion leaves) is read through those blanks. A word the printer split with a hyphen at the line end is put back together without the hyphen (`непере-` / `носимой` becomes `непереносимой`); a hyphen that is the word's own stays and the parts are joined without a space (`кое-` / `что`, `по-` / `прежнему`, `когда-` / `нибудь`, `Нью-` / `йоркской`, `1-` / `й`): the part before it is short or a known prefix, the part after a known particle, the parts repeat, a name is capitalised, or a digit precedes it. Doubled spaces of justified text become single in the joined lines. Before joining anything, the command checks that the text looks like wrapped prose (most lines near the width, the next line often starting lowercase); a changelog, a list without markers or a poem fails that and is left alone, and the notice says so and suggests selecting the paragraphs. Otherwise the notice says how many line breaks went. Wrap lines… is the reverse: it asks for a width and whether to break a word longer than the room left (off, such a word stands on a line of its own), then cuts every ordinary line longer than the width at spaces, repeating a line's indent on the lines cut from it, and leaves structure, blank and short lines alone. Both commands are in the right-click menu of an Obsidian note too, as "Unwrap lines (Native File Editor)" and "Wrap lines… (Native File Editor)", since `.md` is Obsidian's own file type. Several cursors behave as in Notepad++: Alt+drag keeps a caret past a shorter line's end and pads with spaces when you type; with several cursors → goes on past a line's end into virtual space instead of wrapping onto the next line, ← and Backspace walk back through it one column at a time, Shift with the arrows selects virtual space as a rectangle, and the first keystroke there pads with spaces.

## Building from source

```
npm install
npm test             # unit tests
npm run test:e2e     # real fixture files through the transports and the text model
npm run build        # strict type check, then bundle to main.js
npm run size         # what each bundled package adds to main.js
```

Node 22 is what CI uses.
