/**
 * The one string manifest.json and the code have to agree on. Obsidian installs
 * the plugin into a folder named after the manifest id and every vault path the
 * plugin builds hangs off it, so a test asserts equality with the manifest.
 */
export const PLUGIN_ID = "native-file-editor";

/** View types are part of the workspace layout Obsidian persists; never rename. */
export const VIEW_TYPE_TEXT = "nfe-text";

/**
 * Command ids are frozen from the first release: users' hotkeys are keyed to
 * the id (Obsidian prefixes it with the plugin id). Only the titles may change.
 */
export const COMMAND_TOGGLE_MODE = "toggle-mode";

/** Delay between the last keystroke and the write, in milliseconds. */
export const AUTOSAVE_DELAY_MS = 1000;

/** Above this size a text file opens in preview only unless the user insists. */
export const DEFAULT_LARGE_FILE_BYTES = 5 * 1024 * 1024;

/**
 * Above this size the preview is plain text: highlighting a preview means one
 * full parse and one span per token, which is what the preview exists to avoid
 * on a large file. Per device, so a phone can set it lower; the default is a
 * guess until a device measurement replaces it (verification ledger).
 */
export const DEFAULT_PREVIEW_HIGHLIGHT_BYTES = 2 * 1024 * 1024;

/**
 * The preview stays plain when a line is longer than this or the file has more
 * tokens than this, whatever the size cap says: one span per token on a
 * single minified line is what froze the pane on a 1.1 MB HTML export.
 */
export const PREVIEW_MAX_LINE_LENGTH = 10_000;
export const PREVIEW_MAX_TOKENS = 250_000;

/** Second command id; frozen like the first. */
export const COMMAND_NEW_FILE = "new-file";

/** The log, inside the plugin folder so both platforms can write it through the adapter. */
export const LOG_FILE_NAME = "nfe.log";

/**
 * Extensions Obsidian itself owns. They never enter the registry, whatever the
 * language tables say, because taking one would replace a core view.
 */
export const OBSIDIAN_OWNED_EXTENSIONS: ReadonlySet<string> = new Set([
  "md",
  "canvas",
  "base",
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "svg",
  "webp",
  "avif",
  "mp3",
  "wav",
  "m4a",
  "ogg",
  "3gp",
  "flac",
  "webm",
  "mp4",
  "mkv",
  "mov",
  "ogv",
]);
