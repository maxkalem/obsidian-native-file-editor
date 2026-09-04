# Setup

## Installing a development build

Copy the `native-file-editor/` folder from the repository into `<vault>/.obsidian/plugins/` and enable the plugin in Settings, Community plugins. The folder holds `main.js`, `manifest.json` and `styles.css`, filled by `npm run build`; the three travel together whenever any of them changed.

On Windows, `copy.bat <vault>` does the copy (keeping settings) and `clean.cmd <vault>` removes the installed plugin folder first, settings included. Instead of the argument, set `NFE_VAULT` or create a `local.cmd` next to the scripts with `set NFE_VAULT=C:\path\to\vault`; it is git-ignored. Reload the plugin in Obsidian afterwards.

## Seeing the files

Obsidian's file explorer lists a file only when some plugin has registered its extension, or when "Detect all file extensions" is on in Settings, Files and links. Native File Editor registers its extensions at load, so `.txt` and `.log` files appear once it is enabled.

## Other plugins that open the same files

At load the plugin leaves alone every extension another plugin already opens, and shows one notice saying which. To take one over, turn its toggle on under Settings, Native File Editor, File types, then reload the plugin. The toggles are shared across devices through `data.json`.

## Settings

Shared across devices: initial mode (preview first, always editing, or remember per file), line numbers, word wrap, tab size, tab inserts spaces, and the file-type toggles.

This device only: the large-file limit. A file above it opens in preview with an Edit button that asks before building the editor.

## The log

The plugin writes what it does to `<vault>/.obsidian/plugins/native-file-editor/nfe.log`: load, which extensions it took, every file opened (size, encoding, language, mode), saves, external changes, and every error with its stack. It rotates to `nfe.log.1` past 1 MB. When something fails to open or highlight, this file says why; attach it to a report. Because it sits in the vault, a vault under Git or Sync carries it; add `.obsidian/plugins/native-file-editor/nfe.log*` to the ignore list if that is unwanted.

## Creating files

Right-click a folder, "New file (Native File Editor)", type a name and pick an extension from every type the plugin edits; the file opens in the editor. The command "Native File Editor: New file" does the same in the active file's folder.

## Building from source

```
npm install
npm test             # unit tests
npm run test:e2e     # real fixture files through the transports and the text model
npm run build        # strict type check, then bundle to main.js
npm run size         # what each bundled package adds to main.js
```

Node 22 is what CI uses.
