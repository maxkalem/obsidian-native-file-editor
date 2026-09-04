# Troubleshooting

**A `.txt` file opens in another plugin's view.** That plugin registered the extension before Native File Editor loaded, and the yield rule left it alone; the notice at startup said so. Turn the extension on under Settings, Native File Editor, File types, and reload the plugin.

**The pane opens but looks unstyled.** `styles.css` was not copied along with `main.js`. Copy both from the repository root into the plugin folder and reload.

**A file opens read-only with "not valid UTF-8" in the head bar.** The bytes are not UTF-8 and carry no byte order mark, so the plugin decoded them as a guess and refuses to write the guess back. Convert the file to UTF-8 with another editor to edit it here.

**A large file opens as a preview even with "Always editing" set.** It is above the per-device large-file limit. Press Edit and confirm in the dialog, or raise the limit in settings; the limit is a per-device setting and is not synced.

**Edits are not saved.** Autosave writes one second after the last keystroke, and a failure shows a notice with the reason. If the notice names a temp file beside the original, the new content is in that file: the write of the original failed after the temp copy was complete.

**A notice about left-alone extensions appears again.** It reappears only when the set of yielded extensions changes, for example after installing or removing another plugin that opens text files.
