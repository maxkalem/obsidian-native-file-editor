import { type App, Notice, Plugin, type WorkspaceLeaf } from "obsidian";
import { COMMAND_TOGGLE_MODE, VIEW_TYPE_TEXT } from "./constants";
import { decideClaims, describeYielded } from "./core/claims";
import { registeredExtensions } from "./highlight/registry";
import { createTransport } from "./platform/select";
import type { Transport } from "./platform/transport";
import { DeviceLocalStore } from "./settings/DeviceLocalStore";
import { NfeSettingsTab } from "./settings/SettingsTab";
import { DEFAULT_SETTINGS, type SharedSettings, normalizeSettings } from "./settings/settings";
import { TextView } from "./ui/TextView";
import { codeMirrorFactory } from "./ui/codemirror";

/**
 * Obsidian's view registry keeps extension -> view type. It is not in the
 * public typings, so it is read through a guard and treated as empty when the
 * shape is not what this was written against: yielding nothing is the
 * conservative failure.
 */
export function readOwnedExtensions(app: App): Record<string, string> {
  const registry = (app as unknown as { viewRegistry?: { typeByExtension?: unknown } }).viewRegistry;
  const map = registry?.typeByExtension;
  const out: Record<string, string> = {};
  if (typeof map !== "object" || map === null) return out;
  for (const [ext, type] of Object.entries(map as Record<string, unknown>)) {
    if (typeof type === "string") out[ext.toLowerCase()] = type;
  }
  return out;
}

/** The vault's stable identity, for scoping device-local state. */
export function vaultId(app: App): string {
  const appId = (app as unknown as { appId?: unknown }).appId;
  if (typeof appId === "string" && appId.length > 0) return appId;
  return app.vault.getName();
}

export default class NativeFileEditorPlugin extends Plugin {
  private nfeSettings: SharedSettings = DEFAULT_SETTINGS;
  private nfeDevice!: DeviceLocalStore;
  private nfeTransport!: Transport;

  override async onload(): Promise<void> {
    this.nfeSettings = normalizeSettings(await this.loadData());
    this.nfeDevice = new DeviceLocalStore(vaultId(this.app), safeLocalStorage());
    this.nfeTransport = createTransport(this.app);

    this.registerView(VIEW_TYPE_TEXT, (leaf: WorkspaceLeaf) =>
      new TextView(leaf, {
        settings: () => this.nfeSettings,
        device: this.nfeDevice,
        transport: this.nfeTransport,
        editorFactory: codeMirrorFactory,
        timers: {
          setTimeout: (fn, ms) => activeWindow.setTimeout(fn, ms),
          clearTimeout: (id) => activeWindow.clearTimeout(id),
        },
        now: () => Date.now(),
      })
    );

    // Cover everything, yield by default: extensions another plugin already
    // serves are left alone, and the notice about it is shown once per change
    // of that set rather than at every start.
    const owned = readOwnedExtensions(this.app);
    const decision = decideClaims({
      candidates: registeredExtensions(),
      owned,
      toggles: this.nfeSettings.extensions,
    });
    if (decision.take.length > 0) this.registerExtensions(decision.take, VIEW_TYPE_TEXT);
    if (decision.yielded.length > 0) {
      const key = decision.yielded.map((y) => `${y.ext}:${y.viewType}`).join(",");
      if (this.nfeDevice.get().yieldNoticeKey !== key) {
        new Notice(describeYielded(decision.yielded), 8000);
        this.nfeDevice.update({ yieldNoticeKey: key });
      }
    } else if (this.nfeDevice.get().yieldNoticeKey !== "") {
      this.nfeDevice.update({ yieldNoticeKey: "" });
    }

    this.addCommand({
      id: COMMAND_TOGGLE_MODE,
      name: "Toggle preview and edit",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(TextView);
        if (!view) return false;
        if (!checking) void view.toggleMode();
        return true;
      },
    });

    this.addSettingTab(
      new NfeSettingsTab(this.app, this, {
        settings: () => this.nfeSettings,
        saveSettings: async (next) => {
          this.nfeSettings = next;
          await this.saveData(next);
        },
        device: this.nfeDevice,
        ownedElsewhere: () => {
          const all = readOwnedExtensions(this.app);
          const out: Record<string, string> = {};
          for (const [ext, type] of Object.entries(all)) if (type !== VIEW_TYPE_TEXT) out[ext] = type;
          return out;
        },
      })
    );
  }

  override onunload(): void {
    // Obsidian restores the previous owner of every extension this plugin
    // registered and detaches its views; nothing else was started.
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
