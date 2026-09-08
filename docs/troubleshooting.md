# Troubleshooting

**Start with the log.** `<vault>/.obsidian/plugins/native-file-editor/nfe.log` records every open, save and error with its stack, plus a self-test of the highlighting machinery at load. Most of the cases below leave a line there.

**"Failed to open" or a file opens as plain text with a notice about a language failing.** The language machinery Obsidian provides differs from the one the plugin was built against, or a grammar threw. The file still opens as plain text; the log has the stack under `[lang]`, `[editor]` or `[preview]`, and the `self-test` line at load says whether stream modes work at all on this Obsidian.

**A `.txt` file opens in another plugin's view.** That plugin registered the extension before Native File Editor loaded, and the yield rule left it alone; the notice at startup said so. Turn the extension on under Settings, Native File Editor, File types, and reload the plugin.

**The pane opens but looks unstyled.** `styles.css` was not copied along with `main.js`. Copy both from the repository root into the plugin folder and reload.

**A file opens read-only with "not valid UTF-8" in the head bar.** The bytes are not UTF-8 and carry no byte order mark, so the plugin decoded them as a guess (windows-1251 or windows-1252) and does not write the guess back unasked. Press Edit: the dialog offers a UTF-8 copy beside the file, opened in the editor, or editing the original in the guessed encoding if the text reads correctly. A notice "not saved … has no byte in windows-1251" while editing means a character the code page cannot hold was typed; remove it, or make a UTF-8 copy instead.

**A large file opens as a preview even with "Always editing" set.** It is above the per-device large-file limit. Press Edit and confirm in the dialog, or raise the limit in settings; the limit is a per-device setting and is not synced.

**Edits are not saved.** Autosave writes one second after the last keystroke, and a failure shows a notice with the reason. If the notice names a temp file beside the original, the new content is in that file: the write of the original failed after the temp copy was complete.

**Colours look wrong for a language.** Tokens carry Obsidian's own `cm-*` classes under `cm-s-obsidian`, so a file is coloured exactly like a fenced code block in a note: compare with a block of the same language in a note; if they match, it is the theme. If they differ, a palette is in effect: the log's `[palette]` line at start names every file read from the palette folder and what each contributed, and the command "Reload palettes" re-reads the folder after a change. A theme file that contributed nothing says so in the same line (`skipped ... not understood`).

**A notice about left-alone extensions appears again.** It reappears only when the set of yielded extensions changes, for example after installing or removing another plugin that opens text files.
