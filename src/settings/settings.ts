import { type HotkeyOverrides, NO_OVERRIDES, normalizeHotkeys } from "../core/hotkeys";
import type { InitialModeSetting } from "../core/openMode";

/**
 * Shared preferences: what data.json holds. It travels with the vault through
 * any sync, so only settings every device should share belong here. Anything
 * device-specific (how much work this device does, what it last showed) is in
 * DeviceLocalStore.
 */
export interface SharedSettings {
  /**
   * Per-extension override of the claim rule. `true` takes the extension even
   * from another plugin, `false` never registers it, absent means the default
   * (take it unless someone else owns it).
   */
  extensions: Record<string, boolean>;
  initialMode: InitialModeSetting;
  lineNumbers: boolean;
  wordWrap: boolean;
  /** Spaces as dots, tabs as arrows, a line-ending badge at every line end, as Notepad++ shows them. */
  showInvisibles: boolean;
  /** Shortcut hints on the search panel's buttons ("Next (F3)"); the tooltips stay either way. */
  searchHints: boolean;
  /** Text direction: `auto` decides per line from its first strong character (Arabic and Hebrew lines read right to left), `ltr`/`rtl` force the whole document. */
  textDirection: "auto" | "ltr" | "rtl";
  /**
   * What Insert ▸ Date / Date and time in the context menu write, in moment.js
   * syntax as Obsidian's Templates plugin uses it. Empty means: the Templates
   * plugin's own format when it has one, else `YYYY-MM-DD` and `HH:mm:ss`.
   */
  dateFormat: string;
  timeFormat: string;
  /** The user's key remapping per platform, action id → chord text (`core/hotkeys.ts`); only what differs from that platform's defaults is kept. */
  hotkeys: HotkeyOverrides;
  tabSize: number;
  tabInsertsSpaces: boolean;
  /**
   * The palette folder, vault-relative with forward slashes and no trailing
   * slash; empty means the default under the plugin folder (see
   * `resolvePaletteFolder`). Shared: the folder travels with the vault.
   */
  paletteFolder: string;
  /** Custom palettes on or off; off means the folder is not read and no palette applies. */
  customPalettes: boolean;
  /** The vault folder of JSON language definitions (tier 4); empty means the default under the plugin folder. Read at load. */
  languageFolder: string;
  /** Custom languages on or off; off means the folder is not read. */
  customLanguages: boolean;
  /** The vault folder of JSON text-language dictionaries (the hyphen word lists); empty means the default under the plugin folder. Read at load. */
  dictionaryFolder: string;
  /** Custom dictionaries on or off; off means the folder is not read and only the bundled dictionaries apply. */
  customDictionaries: boolean;
  /** Custom file types: lower-case extension -> the registry language name that opens it. */
  customExtensions: Record<string, string>;
}

export const DEFAULT_SETTINGS: SharedSettings = {
  extensions: {},
  initialMode: "preview",
  lineNumbers: true,
  wordWrap: false,
  showInvisibles: false,
  searchHints: true,
  textDirection: "auto",
  dateFormat: "",
  timeFormat: "",
  hotkeys: NO_OVERRIDES,
  tabSize: 4,
  tabInsertsSpaces: false,
  paletteFolder: "",
  customPalettes: false,
  languageFolder: "",
  customLanguages: false,
  dictionaryFolder: "",
  customDictionaries: false,
  customExtensions: {},
};

/** A vault folder setting, cleaned, or the default `<subfolder>` under the plugin folder. */
export function resolvePluginFolder(setting: string, configDir: string, pluginId: string, subfolder: string): string {
  const cleaned = setting.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return cleaned.length > 0 ? cleaned : `${configDir}/plugins/${pluginId}/${subfolder}`;
}

/** The palette folder for a setting value: the setting, cleaned, or the default under the plugin folder. */
export function resolvePaletteFolder(setting: string, configDir: string, pluginId: string): string {
  return resolvePluginFolder(setting, configDir, pluginId, "palettes");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * data.json may be from an older or newer version, hand-edited, or absent.
 * Every field is checked and anything unknown is dropped, so a bad value can
 * never reach the code that reads it.
 */
export function normalizeSettings(raw: unknown): SharedSettings {
  const out: SharedSettings = { ...DEFAULT_SETTINGS, extensions: {}, customExtensions: {}, hotkeys: NO_OVERRIDES };
  if (!isRecord(raw)) return out;

  if (isRecord(raw.extensions)) {
    for (const [ext, v] of Object.entries(raw.extensions)) {
      if (typeof v === "boolean" && /^[a-z0-9_+-]+$/i.test(ext)) out.extensions[ext.toLowerCase()] = v;
    }
  }
  if (raw.initialMode === "preview" || raw.initialMode === "edit" || raw.initialMode === "remember") {
    out.initialMode = raw.initialMode;
  }
  if (typeof raw.lineNumbers === "boolean") out.lineNumbers = raw.lineNumbers;
  if (typeof raw.wordWrap === "boolean") out.wordWrap = raw.wordWrap;
  if (typeof raw.showInvisibles === "boolean") out.showInvisibles = raw.showInvisibles;
  if (typeof raw.searchHints === "boolean") out.searchHints = raw.searchHints;
  if (raw.textDirection === "auto" || raw.textDirection === "ltr" || raw.textDirection === "rtl") out.textDirection = raw.textDirection;
  if (typeof raw.dateFormat === "string") out.dateFormat = raw.dateFormat.trim();
  if (typeof raw.timeFormat === "string") out.timeFormat = raw.timeFormat.trim();
  out.hotkeys = normalizeHotkeys(raw.hotkeys);
  if (typeof raw.tabSize === "number" && Number.isInteger(raw.tabSize) && raw.tabSize >= 1 && raw.tabSize <= 16) {
    out.tabSize = raw.tabSize;
  }
  if (typeof raw.tabInsertsSpaces === "boolean") out.tabInsertsSpaces = raw.tabInsertsSpaces;
  if (typeof raw.paletteFolder === "string" && !raw.paletteFolder.includes("..")) out.paletteFolder = raw.paletteFolder.trim();
  if (typeof raw.languageFolder === "string" && !raw.languageFolder.includes("..")) out.languageFolder = raw.languageFolder.trim();
  if (typeof raw.customPalettes === "boolean") out.customPalettes = raw.customPalettes;
  if (typeof raw.customLanguages === "boolean") out.customLanguages = raw.customLanguages;
  if (typeof raw.dictionaryFolder === "string" && !raw.dictionaryFolder.includes("..")) out.dictionaryFolder = raw.dictionaryFolder.trim();
  if (typeof raw.customDictionaries === "boolean") out.customDictionaries = raw.customDictionaries;
  if (isRecord(raw.customExtensions)) {
    for (const [ext, name] of Object.entries(raw.customExtensions)) {
      if (typeof name === "string" && name.trim().length > 0 && /^[a-z0-9_+-]+$/i.test(ext)) out.customExtensions[ext.toLowerCase()] = name.trim();
    }
  }
  return out;
}
