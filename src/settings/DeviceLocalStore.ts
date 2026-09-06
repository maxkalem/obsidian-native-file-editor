import { DEFAULT_LARGE_FILE_BYTES, DEFAULT_RUN_OUTPUT_CAP_BYTES, DEFAULT_RUN_TIMEOUT_MS, PLUGIN_ID } from "../constants";
import type { ViewMode } from "../core/openMode";
import { type RunnerDef, normalizeRunners } from "../run/runners";

/**
 * Device-local state, in localStorage scoped by vault. It never travels with
 * the vault: what this device last showed, and how much work this device is
 * willing to do, are not things another device should inherit.
 */
/**
 * The shape's version. 1 (or none) stored the default interpreter list in
 * `runners`; from 2 the list is the user's own and starts empty, so a stored
 * state below 2 drops its runners on load. Bump when a stored field changes
 * meaning; `normalizeDeviceState` does the migration.
 */
export const DEVICE_STATE_VERSION = 2;

export interface DeviceLocalState {
  version: number;
  /** Vault path -> last mode, for the "remember per file" initial mode. */
  lastMode: Record<string, ViewMode>;
  /** Files above this size open in preview only unless the user insists. */
  largeFileBytes: number;
  /** The extension the "New file" dialog offers first: the one used last on this device. */
  lastNewFileExtension: string;
  /** The last set of yielded extensions the notice was shown for, so it is shown once per change, not per start. */
  yieldNoticeKey: string;
  /** Run (ADR-004): off until this device turns it on. */
  runEnabled: boolean;
  runTimeoutMs: number;
  runOutputCapBytes: number;
  /** The user's interpreters for this device, one or more per language; starts EMPTY (the sandbox and the page view need none). Paths never leave the device. */
  runners: RunnerDef[];
  /** Vault path -> whether the output panel was open, per file. */
  runPanelOpen: Record<string, boolean>;
}

export const DEFAULT_DEVICE_STATE: DeviceLocalState = {
  version: DEVICE_STATE_VERSION,
  lastMode: {},
  largeFileBytes: DEFAULT_LARGE_FILE_BYTES,
  lastNewFileExtension: "txt",
  yieldNoticeKey: "",
  runEnabled: false,
  runTimeoutMs: DEFAULT_RUN_TIMEOUT_MS,
  runOutputCapBytes: DEFAULT_RUN_OUTPUT_CAP_BYTES,
  runners: [],
  runPanelOpen: {},
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
  const out: DeviceLocalState = { ...DEFAULT_DEVICE_STATE, lastMode: {}, runners: [], runPanelOpen: {} };
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
  if (typeof raw.runEnabled === "boolean") out.runEnabled = raw.runEnabled;
  if (typeof raw.runTimeoutMs === "number" && Number.isFinite(raw.runTimeoutMs) && raw.runTimeoutMs >= 1000) out.runTimeoutMs = Math.floor(raw.runTimeoutMs);
  if (typeof raw.runOutputCapBytes === "number" && Number.isFinite(raw.runOutputCapBytes) && raw.runOutputCapBytes >= 1024) out.runOutputCapBytes = Math.floor(raw.runOutputCapBytes);
  // Below version 2 the stored list was the old bundled defaults, not the user's: drop it.
  const version = typeof raw.version === "number" ? raw.version : 1;
  const runners = version >= 2 ? normalizeRunners(raw.runners) : null;
  if (runners) out.runners = runners.runners;
  if (isRecord(raw.runPanelOpen)) {
    for (const [path, open] of Object.entries(raw.runPanelOpen)) if (open === true) out.runPanelOpen[path] = true;
  }
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

  /** Back to the defaults for this device, on the user's request only. */
  reset(): void {
    this.state = { ...DEFAULT_DEVICE_STATE, lastMode: {}, runners: [], runPanelOpen: {} };
    this.write();
  }

  forgetPath(path: string): void {
    if (!(path in this.state.lastMode) && !(path in this.state.runPanelOpen)) return;
    const next = { ...this.state.lastMode };
    delete next[path];
    const panels = { ...this.state.runPanelOpen };
    delete panels[path];
    this.update({ lastMode: next, runPanelOpen: panels });
  }

  /** Whether the output panel is open for a file; only open panels are stored, capped like the modes. */
  rememberRunPanel(path: string, open: boolean): void {
    const next: Record<string, boolean> = { ...this.state.runPanelOpen };
    delete next[path];
    if (open) next[path] = true;
    const keys = Object.keys(next);
    for (let i = 0; i < keys.length - MAX_REMEMBERED_FILES; i++) {
      const k = keys[i];
      if (k !== undefined) delete next[k];
    }
    this.update({ runPanelOpen: next });
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
