import { type App, type Menu, Notice, Platform, Plugin, TFile, TFolder, type WorkspaceLeaf } from "obsidian";
import { StreamLanguage } from "@codemirror/language";
import { COMMAND_NEW_FILE, COMMAND_TOGGLE_MODE, LOG_FILE_NAME, PLUGIN_ID, VIEW_TYPE_TEXT } from "./constants";
import { decideClaims, describeYielded } from "./core/claims";
import { Logger, describeError } from "./core/log";
import type { Timers } from "./core/autosave";
import { ruleOf, tokenize } from "./highlight/highlighter";
import { getStyleTags } from "@lezer/highlight";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { logMode } from "./highlight/logMode";
import { registeredExtensions } from "./highlight/registry";
import { AdapterLogSink } from "./platform/logSink";
import { createTransport } from "./platform/select";
import type { Transport } from "./platform/transport";
import { DeviceLocalStore } from "./settings/DeviceLocalStore";
import { NfeSettingsTab } from "./settings/SettingsTab";
import { DEFAULT_SETTINGS, type SharedSettings, normalizeSettings } from "./settings/settings";
import { NewFileModal } from "./ui/NewFileModal";
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

/** Where the log lives: inside the plugin folder, whatever the config dir is called. */
export function logFilePath(configDir: string): string {
  return `${configDir}/plugins/${PLUGIN_ID}/${LOG_FILE_NAME}`;
}

/**
 * Runs the stream-mode machinery once, at load, against the CodeMirror
 * packages Obsidian actually provides, and returns what happened. The bundle
 * was built and tested against npm's versions; this is the one place the two
 * are compared on the device, and the log line it produces is what a "Failed
 * to open" report needs.
 */
export function selfTestStreamLanguage(): string {
  if (typeof (StreamLanguage as unknown) !== "function" || typeof (StreamLanguage as unknown as { define?: unknown }).define !== "function") {
    return `FAILED: @codemirror/language as provided by Obsidian has no StreamLanguage.define (StreamLanguage is ${typeof StreamLanguage})`;
  }
  const one = (name: string, parser: Parameters<typeof StreamLanguage.define>[0], text: string): string => {
    try {
      const lang = StreamLanguage.define(parser);
      const tokens = tokenize(text, lang);
      if (tokens === null) return `${name}: parse timed out`;
      const classes = tokens.filter((t) => t.classes !== null).length;
      // Which copy of @lezer/highlight tagged the tree: the plugin's getStyleTags
      // sees a rule only when it is the same copy; ruleOf sees it by shape.
      const state = EditorState.create({ doc: text, extensions: [lang] });
      const tree = ensureSyntaxTree(state, text.length, 1000);
      let first = tree?.topNode.firstChild ?? null;
      while (first && !ruleOf(first.type)) first = first.nextSibling;
      const copies = !first ? "no tagged node" : getStyleTags(first) ? "one @lezer/highlight copy" : "TWO @lezer/highlight copies (rule by shape only)";
      // When nothing is recognised, say what the first token's node type
      // carries, so the shape can be read from the log.
      const probe = tree?.topNode.firstChild ?? null;
      const shape = probe ? describeNodeType(probe.type) : "no first child";
      return `${name}: ${classes > 0 ? "ok" : "no token classes"} (${tokens.length} tokens, ${classes} classed; tree ${tree ? tree.toString().slice(0, 80) : "null"}; ${copies}; first ${shape})`;
    } catch (e) {
      return `${name}: FAILED: ${describeError(e)}`;
    }
  };
  return [one("builtin log", logMode, "2026-09-04 12:00:00 ERROR failed\n"), one("legacy shell", shell, "echo hi # c\n")].join("; ");
}

/** A node type's name and its props, shallowly: keys, constructor names, and the keys of each value. */
export function describeNodeType(type: { name: string }): string {
  const props = (type as unknown as { props?: Record<string, unknown> }).props;
  if (!props) return `${type.name}: no props field`;
  const entries = Object.entries(props).map(([k, v]) => {
    if (v === null || typeof v !== "object") return `${k}=${typeof v}`;
    const ctor = (v as { constructor?: { name?: string } }).constructor?.name ?? "?";
    return `${k}=${ctor}{${Object.keys(v as object).join("|")}}`;
  });
  const own = Object.getOwnPropertyNames(type).join("|");
  return `${type.name} props[${entries.join(", ")}] fields[${own}]`;
}

export default class NativeFileEditorPlugin extends Plugin {
  private nfeSettings: SharedSettings = DEFAULT_SETTINGS;
  private nfeDevice!: DeviceLocalStore;
  private nfeTransport!: Transport;
  private nfeLog!: Logger;

  override async onload(): Promise<void> {
    const timers: Timers = {
      setTimeout: (fn, ms) => activeWindow.setTimeout(fn, ms),
      clearTimeout: (id) => activeWindow.clearTimeout(id),
    };
    this.nfeLog = new Logger({
      sink: new AdapterLogSink(this.app.vault.adapter, logFilePath(this.app.vault.configDir)),
      timers,
      now: () => Date.now(),
    });
    const log = this.nfeLog;
    log.info("plugin", `load ${this.manifest.version} on ${Platform.isDesktopApp ? "desktop" : "mobile"}${Platform.isAndroidApp ? "/android" : Platform.isIosApp ? "/ios" : ""}`);

    this.nfeSettings = normalizeSettings(await this.loadData());
    this.nfeDevice = new DeviceLocalStore(vaultId(this.app), safeLocalStorage());
    try {
      this.nfeTransport = createTransport(this.app);
      log.info("plugin", `transport ${this.nfeTransport.kind}`);
    } catch (e) {
      log.error("plugin", "transport unavailable", e);
      new Notice(`Native File Editor cannot start: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    log.info("plugin", `stream-language self-test: ${selfTestStreamLanguage()}`);

    this.registerView(VIEW_TYPE_TEXT, (leaf: WorkspaceLeaf) =>
      new TextView(leaf, {
        settings: () => this.nfeSettings,
        device: this.nfeDevice,
        transport: this.nfeTransport,
        editorFactory: codeMirrorFactory,
        timers,
        now: () => Date.now(),
        log,
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
    log.info(
      "claims",
      `took ${decision.take.length} extensions; yielded ${decision.yielded.map((y) => `.${y.ext}->${y.viewType}`).join(", ") || "none"}; disabled ${decision.disabled.map((d) => `.${d}`).join(", ") || "none"}`
    );
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

    this.addCommand({
      id: COMMAND_NEW_FILE,
      name: "New file",
      callback: () => {
        const active = this.app.workspace.getActiveFile();
        this.openNewFileModal(active?.parent?.path ?? "");
      },
    });

    // A folder gets "New file" inside it; a file gets "New file" beside it.
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file) => {
        const folder = file instanceof TFolder ? file.path : file instanceof TFile ? (file.parent?.path ?? "") : null;
        if (folder === null) return;
        menu.addItem((item) =>
          item
            .setTitle(file instanceof TFolder ? "New file (Native File Editor)" : "New file here (Native File Editor)")
            .setIcon("file-plus")
            .onClick(() => this.openNewFileModal(folder))
        );
      })
    );

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
    // registered and detaches its views; the log is the only thing to finish.
    this.nfeLog?.info("plugin", "unload");
    void this.nfeLog?.flush();
  }

  /** The dialog, then the file, then the pane: an empty file in the editor. */
  openNewFileModal(folder: string): void {
    new NewFileModal(this.app, {
      folder,
      initialExtension: this.nfeDevice.get().lastNewFileExtension,
      exists: (path) => this.app.vault.getAbstractFileByPath(path) !== null,
      onCreate: (choice) => void this.createAndOpen(choice.path, choice.extension),
    }).open();
  }

  async createAndOpen(path: string, extension: string): Promise<void> {
    try {
      const file = await this.app.vault.create(path, "");
      this.nfeDevice.update({ lastNewFileExtension: extension });
      this.nfeLog.info("new-file", path);
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
      const view = leaf.view;
      if (view instanceof TextView) await view.setMode("edit");
    } catch (e) {
      this.nfeLog.error("new-file", `${path} failed`, e);
      new Notice(`Native File Editor could not create ${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
