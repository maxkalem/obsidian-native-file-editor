import { DEFAULT_LARGE_FILE_BYTES, PLUGIN_ID } from "../constants";
import type { ViewMode } from "../core/openMode";

/**
 * Device-local state, in localStorage scoped by vault. It never travels with
 * the vault: what this device last showed, and how much work this device is
 * willing to do, are not things another device should inherit.
 */
export interface DeviceLocalState {
  /** Vault path -> last mode, for the "remember per file" initial mode. */
  lastMode: Record<string, ViewMode>;
  /** Files above this size open in preview only unless the user insists. */
  largeFileBytes: number;
  /** The extension the "New file" dialog offers first: the one used last on this device. */
  lastNewFileExtension: string;
  /** The last set of yielded extensions the notice was shown for, so it is shown once per change, not per start. */
  yieldNoticeKey: string;
}

export const DEFAULT_DEVICE_STATE: DeviceLocalState = {
  lastMode: {},
  largeFileBytes: DEFAULT_LARGE_FILE_BYTES,
  lastNewFileExtension: "txt",
  yieldNoticeKey: "",
};

/** The subset of Storage the store uses; a test hands in a Map-backed fake. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** How many per-file entries to keep; the oldest go first. */
const MAX_REMEMBERED_FILES = 500;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function normalizeDeviceState(raw: unknown): DeviceLocalState {
  const out: DeviceLocalState = { ...DEFAULT_DEVICE_STATE, lastMode: {} };
  if (!isRecord(raw)) return out;
  if (isRecord(raw.lastMode)) {
    for (const [path, mode] of Object.entries(raw.lastMode)) {
      if (mode === "preview" || mode === "edit") out.lastMode[path] = mode;
    }
  }
  if (typeof raw.largeFileBytes === "number" && Number.isFinite(raw.largeFileBytes) && raw.largeFileBytes >= 0) {
    out.largeFileBytes = Math.floor(raw.largeFileBytes);
  }
  if (typeof raw.lastNewFileExtension === "string" && /^[a-z0-9_+-]+$/.test(raw.lastNewFileExtension)) {
    out.lastNewFileExtension = raw.lastNewFileExtension;
  }
  if (typeof raw.yieldNoticeKey === "string") out.yieldNoticeKey = raw.yieldNoticeKey;
  return out;
}

export class DeviceLocalStore {
  private readonly key: string;
  private readonly storage: StorageLike | null;
  private state: DeviceLocalState;

  constructor(vaultId: string, storage: StorageLike | null) {
    this.key = `${PLUGIN_ID}:${vaultId}`;
    this.storage = storage;
    this.state = this.read();
  }

  get(): DeviceLocalState {
    return this.state;
  }

  update(patch: Partial<DeviceLocalState>): void {
    this.state = { ...this.state, ...patch };
    this.write();
  }

  rememberMode(path: string, mode: ViewMode): void {
    const next: Record<string, ViewMode> = { ...this.state.lastMode };
    // Re-insert so the entry moves to the end; insertion order is the age.
    delete next[path];
    next[path] = mode;
    const keys = Object.keys(next);
    for (let i = 0; i < keys.length - MAX_REMEMBERED_FILES; i++) {
      const k = keys[i];
      if (k !== undefined) delete next[k];
    }
    this.update({ lastMode: next });
  }

  forgetPath(path: string): void {
    if (!(path in this.state.lastMode)) return;
    const next = { ...this.state.lastMode };
    delete next[path];
    this.update({ lastMode: next });
  }

  private read(): DeviceLocalState {
    if (!this.storage) return { ...DEFAULT_DEVICE_STATE, lastMode: {} };
    try {
      const raw = this.storage.getItem(this.key);
      return normalizeDeviceState(raw === null ? null : JSON.parse(raw));
    } catch {
      return { ...DEFAULT_DEVICE_STATE, lastMode: {} };
    }
  }

  private write(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(this.key, JSON.stringify(this.state));
    } catch {
      // Storage full or disabled: the state stays in memory for this session.
    }
  }
}
