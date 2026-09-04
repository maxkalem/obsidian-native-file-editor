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
  tabSize: number;
  tabInsertsSpaces: boolean;
}

export const DEFAULT_SETTINGS: SharedSettings = {
  extensions: {},
  initialMode: "preview",
  lineNumbers: true,
  wordWrap: false,
  tabSize: 4,
  tabInsertsSpaces: false,
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * data.json may be from an older or newer version, hand-edited, or absent.
 * Every field is checked and anything unknown is dropped, so a bad value can
 * never reach the code that reads it.
 */
export function normalizeSettings(raw: unknown): SharedSettings {
  const out: SharedSettings = { ...DEFAULT_SETTINGS, extensions: {} };
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
  if (typeof raw.tabSize === "number" && Number.isInteger(raw.tabSize) && raw.tabSize >= 1 && raw.tabSize <= 16) {
    out.tabSize = raw.tabSize;
  }
  if (typeof raw.tabInsertsSpaces === "boolean") out.tabInsertsSpaces = raw.tabInsertsSpaces;
  return out;
}
