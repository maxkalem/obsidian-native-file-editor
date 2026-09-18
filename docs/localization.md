# Localization

The plugin speaks English. To make it speak your language, put one file next to it:

```
<vault>/.obsidian/plugins/native-file-editor/localization.json
```

That file replaces the English text. There is nothing to choose and nothing to configure: one file, one language. Remove the file and the plugin is English again.

Anything the file does not translate stays English, key by key, so you can translate the twenty lines you actually look at and leave the rest.

## Making your own

1. Take [`locales/english.json`](../locales/english.json) from this repository. It is the whole plugin, every string, in English.
2. Rename it to `localization.json` and put it in the folder above. Settings, Native File Editor, **Language**, **Open folder** shows you that folder.
3. Open it (this plugin edits JSON well) and translate the values — the right-hand side of each line. Leave the keys alone.
4. Press **Reread** in the same row. The settings page, the menus and the messages change at once.

[`locales/uk.json`](../locales/uk.json) is a complete Ukrainian translation: use it as it is (rename it to `localization.json`) or read it as an example.

## The file

```json
{
  "locale": "uk",
  "name": "Українська",
  "rtl": false,
  "strings": {
    "menu.unwrap": "Зшити рядки",
    "notice.unwrap.nothing": "Зшити рядки: нічого зшивати за ширини перенесення {width}."
  }
}
```

- `locale` and `name` are only shown in the settings row, so you can see which file is in force. Neither is required.
- `rtl` lays the plugin's own dialogs out right to left; without it, the script of the `locale` code decides (Arabic, Hebrew, Persian, Urdu and their kin).
- `strings` is key to text. A key you leave out, and a value you leave empty, is English.
- `{name}` in a value is a placeholder the plugin fills — a count, a file name, a key combination. Keep every placeholder the English line has; the words around it are yours. `tests/locales.test.ts` fails on an example file that loses one or that carries a key the plugin does not know.
- Do not translate the product name `Native File Editor`, file extensions, or JSON field names quoted inside a description (`"replace": true`).
- Log lines are deliberately not translatable: a log is a diagnostic and is read by whoever receives the report.

The English source in the plugin itself is `src/i18n/en.ts`; `locales/english.json` is generated from it and a test fails when the two drift apart.

## Keeping it through an update

An update of the plugin replaces `main.js`, `manifest.json` and `styles.css`. `localization.json` is yours and is left alone — as `data.json` and the log are. Removing the plugin removes its folder, so keep a copy of your file if you have put work into it.

A pull request adding a finished translation to [`locales/`](../locales) is welcome; name it `<language>.json` there.
