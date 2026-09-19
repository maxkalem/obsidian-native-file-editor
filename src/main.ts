import { type App, FileSystemAdapter, type Menu, Notice, Platform, Plugin, type TAbstractFile, TFile, TFolder, type WorkspaceLeaf, moment } from "obsidian";
import { StreamLanguage } from "@codemirror/language";
import {
  COMMAND_NEW_FILE,
  COMMAND_RELOAD_PALETTES,
  COMMAND_RUN_FILE,
  COMMAND_STOP_RUN,
  COMMAND_TOGGLE_MODE,
  COMMAND_WRITE_EXAMPLE_PALETTE,
  LOG_FILE_NAME,
  PLUGIN_ID,
  VIEW_TYPE_TEXT,
} from "./constants";
import { PaletteLoader } from "./palette/loader";
import { createDesktopShell, reloadPlugin } from "./platform/desktopShell";
import { setupRun } from "./run/setup";
import { confirm, pickLanguage, promptText } from "./ui/pickers";
import { DocumentStyleSink } from "./ui/styleSink";
import { readThemeColours } from "./ui/themeColours";
import { BUILD_STAMP } from "./build";
import { decideClaims, describeYielded } from "./core/claims";
import { findStaleFiles } from "./core/staleSweep";
import { restoreInNote, unwrapInNote, wrapInNote } from "./core/unwrapNote";
import { type RejoinedWord, describeUnwrap } from "./fmt/unwrap";
import { type HunspellPair, checkWithHunspell, findHunspellDictionaries } from "./fmt/vaultHunspell";
import { HunspellReviewModal } from "./ui/HunspellReviewModal";
import { describeWrap } from "./fmt/wrap";
import { WrapLinesModal } from "./ui/WrapLinesModal";
import { Logger, describeError } from "./core/log";
import type { Timers } from "./core/autosave";
import { forkTokenOf, ruleOf, tokenize } from "./highlight/highlighter";
import { isObsidianStreamFork, toCm5Token } from "./highlight/obsidianFork";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { logMode } from "./highlight/logMode";
import { allLanguageNames, keywordTableFor, registeredExtensions } from "./highlight/registry";
import { AdapterLogSink } from "./platform/logSink";
import { createTransport } from "./platform/select";
import type { Transport } from "./platform/transport";
import { DeviceLocalStore } from "./settings/DeviceLocalStore";
import { NfeSettingsTab } from "./settings/SettingsTab";
import { DEFAULT_SETTINGS, type SharedSettings, normalizeSettings, resolvePaletteFolder, resolvePluginFolder } from "./settings/settings";
import { addWordToLanguage, loadVaultLanguages, writeExampleLanguage } from "./highlight/vaultLanguages";
import { allTextLanguageNames } from "./fmt/dictionary";
import { addWordToDictionary, loadVaultDictionaries, writeExampleDictionary } from "./fmt/vaultDictionaries";
import { wordAtPosition } from "./core/words";
import { plural, t } from "./core/i18n";
import { LOCALIZATION_FILE, loadLocalization } from "./core/localization";
import { AddToDictionaryModal, type DictionaryChoice } from "./ui/AddToDictionaryModal";
import { NewFileModal } from "./ui/NewFileModal";
import { RegexHelpModal } from "./ui/RegexHelpModal";
import { type BakedHotkey, type Chord, bakedMatches, platformOf } from "./core/hotkeys";
import { TextView } from "./ui/TextView";
import { codeMirrorFactory } from "./ui/codemirror";

/** The name of a dictionary's list, as the notice after "Add to dictionary…" shows it. */
function listName(list: "prefixes" | "suffixes" | "words"): string {
  if (list === "prefixes") return t("list.prefixes");
  if (list === "suffixes") return t("list.suffixes");
  return t("list.words");
}

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
      const adapted = isObsidianStreamFork ? { ...parser, token: (s: Parameters<typeof parser.token>[0], st: unknown) => { const r = parser.token(s, st); return r ? toCm5Token(r) : r; } } : parser;
      const lang = StreamLanguage.define(adapted);
      const tokens = tokenize(text, lang);
      if (tokens === null) return `${name}: parse timed out`;
      const classes = tokens.filter((t) => t.classes !== null).length;
      // How the first token is tagged: a lezer highlight rule (npm's
      // StreamLanguage) or the fork's raw token string (Obsidian's).
      const state = EditorState.create({ doc: text, extensions: [lang] });
      const tree = ensureSyntaxTree(state, text.length, 1000);
      const first = tree?.topNode.firstChild ?? null;
      const tagging = !first ? "no first node" : ruleOf(first.type) ? "highlight rule" : forkTokenOf(first.type) ? `fork token "${forkTokenOf(first.type)}"` : `untagged: ${describeNodeType(first.type)}`;
      return `${name}: ${classes > 0 ? "ok" : "no token classes"} (${tokens.length} tokens, ${classes} classed; tree ${tree ? tree.toString().slice(0, 60) : "null"}; ${tagging})`;
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

/**
 * The Obsidian commands (core or any plugin's) whose active hotkey is this
 * chord, by name. `app.hotkeyManager` (`bake()`, `bakedHotkeys`, `bakedIds`)
 * and `app.commands.findCommand` are not in the typings; read in app.js
 * 1.13.7 (2026-09-14): the manager's `onTrigger` runs `bake()` and walks the
 * two arrays in step, which is what this does. Every member is probed and
 * the answer is [] when any is missing, so a future Obsidian loses the
 * warning, not the settings page.
 */
export function obsidianCommandsOn(app: App, chord: Chord, mac: boolean): string[] {
  const manager = (app as unknown as { hotkeyManager?: { bake?: unknown; bakedHotkeys?: unknown; bakedIds?: unknown } }).hotkeyManager;
  const commands = (app as unknown as { commands?: { findCommand?: unknown } }).commands;
  if (!manager || typeof manager.bake !== "function") return [];
  try {
    (manager.bake as () => void)();
  } catch {
    return [];
  }
  const baked = manager.bakedHotkeys;
  const ids = manager.bakedIds;
  if (!Array.isArray(baked) || !Array.isArray(ids)) return [];
  const find = typeof commands?.findCommand === "function" ? (commands.findCommand as (id: string) => { name?: unknown } | undefined).bind(commands) : null;
  const out: string[] = [];
  baked.forEach((hotkey: unknown, i: number) => {
    if (hotkey === null || typeof hotkey !== "object" || !bakedMatches(hotkey as BakedHotkey, chord, mac)) return;
    const id = String(ids[i]);
    const name = find?.(id)?.name;
    out.push(typeof name === "string" && name.length > 0 ? name : id);
  });
  return out;
}

export default class NativeFileEditorPlugin extends Plugin {
  private nfeSettings: SharedSettings = DEFAULT_SETTINGS;
  private nfeDevice!: DeviceLocalStore;
  private nfeTransport!: Transport;
  private nfeLog!: Logger;
  private nfePalettes!: PaletteLoader;
  private nfeStyleSink!: DocumentStyleSink;
  /** Extensions registered with Obsidian so far; a reread registers only what is new. */
  private readonly nfeRegistered = new Set<string>();

  override async onload(): Promise<void> {
    // Two measurements worth having in every log, taken here
    // so that no DevTools console is needed: the time onload takes, and the
    // JS heap before and after it (Chromium's performance.memory; absent on
    // other engines).
    const startedAt = performance.now();
    const heapBefore = heapMb();
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
    log.info("plugin", `load ${this.manifest.version} build ${BUILD_STAMP} on ${Platform.isDesktopApp ? "desktop" : "mobile"}${Platform.isAndroidApp ? "/android" : Platform.isIosApp ? "/ios" : ""}`);

    this.nfeSettings = normalizeSettings(await this.loadData());
    this.nfeDevice = new DeviceLocalStore(vaultId(this.app), safeLocalStorage());
    try {
      this.nfeTransport = createTransport(this.app);
      log.info("plugin", `transport ${this.nfeTransport.kind}`);
    } catch (e) {
      log.error("plugin", "transport unavailable", e);
      new Notice(t("notice.cannotStart", { error: e instanceof Error ? e.message : String(e) }));
      return;
    }
    // The locale before anything builds a string: the first notice, the first
    // menu and the settings page are already in the user's language.
    await this.loadLocale();
    log.info("plugin", `@codemirror/language is ${isObsidianStreamFork ? "Obsidian's fork (tokenClassNodeProp + lineHighlighter present)" : "the npm package (no fork exports)"}`);
    log.info("plugin", `stream-language self-test: ${selfTestStreamLanguage()}`);

    // Palettes: read from the vault folder when custom palettes are on,
    // applied as one <style>. Loading runs after onload and swallows its own
    // errors into the log, so a broken folder cannot break the load.
    this.nfeStyleSink = new DocumentStyleSink(() => activeDocument);
    this.nfePalettes = new PaletteLoader({
      transport: this.nfeTransport,
      sink: this.nfeStyleSink,
      log,
      folder: () => this.paletteFolder(),
      enabled: () => this.nfeSettings.customPalettes,
    });
    void this.nfePalettes.load().catch((e: unknown) => log.error("palette", "loading palettes failed", e));

    // Run (ADR-004): desktop only, off until the device toggle says otherwise.
    // Absent here means no button, no panel, no commands.
    const adapter = this.app.vault.adapter;
    const basePath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
    const shell = createDesktopShell(basePath);
    const run = setupRun({
      isDesktopApp: Platform.isDesktopApp,
      basePath,
      device: this.nfeDevice,
      timers,
      log,
      copy: (text) => {
        try {
          void navigator.clipboard.writeText(text).catch(() => undefined);
        } catch {
          // No clipboard here.
        }
      },
    });
    if (run) log.info("plugin", `run available (off until enabled: ${this.nfeDevice.get().runEnabled ? "enabled" : "disabled"} on this device)`);

    this.registerView(VIEW_TYPE_TEXT, (leaf: WorkspaceLeaf) =>
      new TextView(leaf, {
        settings: () => this.nfeSettings,
        device: this.nfeDevice,
        transport: this.nfeTransport,
        editorFactory: codeMirrorFactory,
        timers,
        now: () => Date.now(),
        log,
        afterSave: (path) => void this.nfePalettes.reloadIfInside(path).catch((e: unknown) => log.error("palette", "reload after save failed", e)),
        onMissing: (path) => this.reconcileMissing(path),
        setWordWrap: (on) => void this.saveSettings({ ...this.nfeSettings, wordWrap: on }),
        setShowInvisibles: (on) => void this.saveSettings({ ...this.nfeSettings, showInvisibles: on }),
        setTextDirection: (direction) => void this.saveSettings({ ...this.nfeSettings, textDirection: direction }),
        regexHelp: () => new RegexHelpModal(this.app, this.nfeSettings.hotkeys).open(),
        deleteFile: (file) => void this.app.fileManager.promptForDeletion(file),
        // "Search the web" in the context menu: Obsidian routes window.open of
        // an http(s) address to the system browser on every platform. The
        // plugin itself sends nothing; the one line in the log says when.
        dateTime: () => this.dateTimeNow(),
        addToDictionary: (word, language) => this.openAddToDictionary(word, language),
        reviewJoins: (joins, apply) => void this.offerHunspellReview(joins, apply),
        openExternal: (url) => {
          log.info("view", `opening the browser for a web search (${url.length} chars)`);
          window.open(url);
        },
        // Obsidian's own rename dialog (fileManager.promptForFileRename is not in the public typings; guarded).
        rename: (file) => {
          const fm = this.app.fileManager as unknown as { promptForFileRename?: (f: TFile) => Promise<void> };
          if (typeof fm.promptForFileRename === "function") void fm.promptForFileRename(file);
          else log.info("view", "this Obsidian build has no fileManager.promptForFileRename; rename from the file explorer");
        },
        copy: {
          exists: (path) => this.app.vault.getAbstractFileByPath(path) !== null,
          // Through the vault, not the transport: the new file must be in Obsidian's index at once to be opened.
          create: (path, bytes) => this.app.vault.createBinary(path, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer),
        },
        ...(run ? { run } : {}),
      })
    );

    if (run) {
      this.addCommand({
        id: COMMAND_RUN_FILE,
        name: t("command.run"),
        checkCallback: (checking) => {
          const view = this.app.workspace.getActiveViewOfType(TextView);
          if (!view || !view.nfeRunAvailable()) return false;
          if (!checking) void view.runFile();
          return true;
        },
      });
      this.addCommand({
        id: COMMAND_STOP_RUN,
        name: t("command.stop"),
        checkCallback: (checking) => {
          const view = this.app.workspace.getActiveViewOfType(TextView);
          if (!view || !view.running) return false;
          if (!checking) view.stopRun();
          return true;
        },
      });
    }

    // Vault language definitions and custom file types join the registry
    // before the claims below, so their extensions are claimed like any
    // bundled one. A bad file is named once; the load goes on.
    await this.loadLanguages();
    // The text-language dictionaries decide hyphens in Unwrap; nothing claims
    // an extension for them, so a failure here costs a word list, not a file.
    await this.loadDictionaries();

    // Cover everything, yield by default: extensions another plugin already
    // serves are left alone, and the notice about it is shown once per change
    // of that set rather than at every start.
    const owned = readOwnedExtensions(this.app);
    const decision = decideClaims({
      candidates: registeredExtensions(),
      owned,
      toggles: this.nfeSettings.extensions,
    });
    if (decision.take.length > 0) {
      this.registerExtensions(decision.take, VIEW_TYPE_TEXT);
      for (const ext of decision.take) this.nfeRegistered.add(ext);
    }
    log.info(
      "claims",
      `took ${decision.take.length} extensions; yielded ${decision.yielded.map((y) => `.${y.ext}->${y.viewType}`).join(", ") || "none"}; disabled ${decision.disabled.map((d) => `.${d}`).join(", ") || "none"}`
    );
    // Once the workspace is up, compare the plugin's files with the disk:
    // a batch rename made outside Obsidian can leave ghosts in its index, and
    // can leave the new names out of it, and only a plugin registering this
    // many extensions makes either visible. The part of the rename Obsidian
    // did see arrives as a burst of "create" and "delete" events, so a sweep
    // follows each burst (the listeners are registered after layout, when
    // Obsidian has stopped firing "create" for every file it indexes at
    // start).
    log.info("plugin", `onload took ${Math.round(performance.now() - startedAt)} ms${heapBefore !== null ? `; heap ${heapBefore} MB before, ${heapMb() ?? "?"} MB after` : ""}`);
    this.app.workspace.onLayoutReady(() => {
      void this.sweepStale("after load");
      let pending: number | null = null;
      const afterBurst = (file: TAbstractFile) => {
        if (!(file instanceof TFile) || !this.nfeRegistered.has(file.extension.toLowerCase())) return;
        if (pending !== null) timers.clearTimeout(pending);
        pending = timers.setTimeout(() => {
          pending = null;
          void this.sweepStale("after files changed");
        }, 2000);
      };
      this.registerEvent(this.app.vault.on("create", afterBurst));
      this.registerEvent(this.app.vault.on("delete", afterBurst));
    });
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
      name: t("command.toggleMode"),
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(TextView);
        if (!view) return false;
        if (!checking) void view.toggleMode();
        return true;
      },
    });

    this.addCommand({
      id: COMMAND_NEW_FILE,
      name: t("command.newFile"),
      callback: () => {
        const active = this.app.workspace.getActiveFile();
        this.openNewFileModal(active?.parent?.path ?? "");
      },
    });

    this.addCommand({ id: COMMAND_RELOAD_PALETTES, name: t("command.reread"), callback: () => void this.reread(true) });
    this.addCommand({
      id: COMMAND_WRITE_EXAMPLE_PALETTE,
      name: t("command.examplePalette"),
      callback: () => {
        void (async () => {
          const language = await pickLanguage(this.app, allLanguageNames(), t("settings.palettes.example.placeholder"));
          if (language !== null) await this.createExamplePalette(language);
        })();
      },
    });

    // A folder gets t("command.newFile") inside it; a file gets t("command.newFile") beside it.
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file) => {
        const folder = file instanceof TFolder ? file.path : file instanceof TFile ? (file.parent?.path ?? "") : null;
        if (folder === null) return;
        menu.addItem((item) =>
          item
            .setTitle(file instanceof TFolder ? t("menu.newFile") : t("menu.newFileHere"))
            .setIcon("file-plus")
            .onClick(() => this.openNewFileModal(folder))
        );
      })
    );

    // A note's editor menu gets "Unwrap lines": `.md` is Obsidian's own file
    // type, so the command acts through Obsidian's editor (core/unwrapNote.ts).
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu: Menu, editor, info) => {
        if (info.file?.extension !== "md") return;
        menu.addItem((item) =>
          item
            .setTitle(t("menu.note.unwrap"))
            .setIcon("unfold-horizontal")
            .onClick(() => {
              const result = unwrapInNote(editor);
              new Notice(describeUnwrap(result));
              if (result.rejoined.length > 0) void this.offerHunspellReview(result.rejoined, (restore) => restoreInNote(editor, result.text, restore));
            })
        );
        menu.addItem((item) =>
          item
            .setTitle(t("menu.note.wrap"))
            .setIcon("wrap-text")
            .onClick(() => new WrapLinesModal(this.app, (choice) => new Notice(describeWrap(wrapInNote(editor, choice.width, choice.breakWords), choice.width))).open())
        );
        menu.addItem((item) =>
          item
            .setTitle(t("menu.note.addToDictionary"))
            .setIcon("book-plus")
            .onClick(() => {
              const selected = editor.getSelection().trim();
              const cursor = editor.getCursor();
              const word = selected.length > 0 ? (selected.split(/\s*\n\s*/)[0] ?? "") : wordAtPosition(editor.getLine(cursor.line), cursor.ch);
              this.openAddToDictionary(word, null);
            })
        );
      })
    );

    this.addSettingTab(
      new NfeSettingsTab(this.app, this, {
        settings: () => this.nfeSettings,
        saveSettings: (next) => this.saveSettings(next),
        device: this.nfeDevice,
        ownedElsewhere: () => {
          const all = readOwnedExtensions(this.app);
          const out: Record<string, string> = {};
          for (const [ext, type] of Object.entries(all)) if (type !== VIEW_TYPE_TEXT) out[ext] = type;
          return out;
        },
        paletteFolder: () => this.paletteFolder(),
        languageFolder: () => this.languageFolder(),
        dictionaryFolder: () => this.dictionaryFolder(),
        shell,
        ensureFolder: (vaultPath) => this.nfeTransport.mkdir(vaultPath),
        languages: () => allLanguageNames(),
        tableLanguages: () => allLanguageNames().filter((n) => keywordTableFor(n) !== null),
        pickLanguage: (languages, placeholder) => pickLanguage(this.app, languages, placeholder),
        promptText: (title, description, placeholder) => promptText(this.app, title, description, placeholder),
        confirm: (title, description, button) => confirm(this.app, title, description, button),
        reread: () => this.reread(false),
        createExamplePalette: (language) => this.createExamplePalette(language),
        createExampleLanguage: (language) => this.createExampleLanguage(language),
        textLanguages: () => allTextLanguageNames(),
        createExampleDictionary: (language) => this.createExampleDictionary(language),
        regexHelp: () => new RegexHelpModal(this.app, this.nfeSettings.hotkeys).open(),
        obsidianHoldersOf: (chord) => obsidianCommandsOn(this.app, chord, platformOf(Platform) === "mac"),
        reloadPlugin: async () => {
          const err = await reloadPlugin(this.app, PLUGIN_ID);
          if (err) new Notice(t("notice.reload.failed", { error: err }));
        },
        isDesktop: () => run !== null,
        notice: (message) => void new Notice(message, 8000),
        refresh: () => undefined,
      })
    );
  }

  /**
   * A file Obsidian lists but the disk lacks: Obsidian's adapter can drop one
   * index entry (`reconcileDeletion(realPath, normalizedPath)`, not in the
   * public typings; both arguments are the vault path here, which is what
   * Obsidian's own `reconcileInternalFile` passes for an unmoved file), which
   * fires the delete event the explorer listens to. Guarded; absent, the entry
   * stays until Obsidian restarts, which is what happens today anyway.
   */
  private reconcileMissing(path: string): void {
    const adapter = this.app.vault.adapter as unknown as { reconcileDeletion?: (realPath: string, normalizedPath: string) => Promise<void> | void };
    if (typeof adapter.reconcileDeletion !== "function") {
      this.nfeLog.info("view", "this Obsidian build has no adapter.reconcileDeletion; the stale entry stays until restart");
      return;
    }
    try {
      void Promise.resolve(adapter.reconcileDeletion(path, path)).catch((e: unknown) => this.nfeLog.error("view", `reconcileDeletion(${path}) failed`, e));
    } catch (e) {
      this.nfeLog.error("view", `reconcileDeletion(${path}) threw`, e);
    }
  }

  /**
   * The other direction: a file the disk has and Obsidian does not list, the
   * result of a batch rename whose "create" events the recursive watcher lost
   * (2026-09-07: 106 of 173 samples). `reconcileInternalFile(vaultPath)` is
   * what Obsidian calls after its own writes: it stats the path and indexes
   * it, firing "create". Guarded like its sibling; absent, the file appears
   * after a restart.
   */
  private reconcileUnindexed(path: string): void {
    const adapter = this.app.vault.adapter as unknown as { reconcileInternalFile?: (normalizedPath: string) => Promise<void> | void };
    if (typeof adapter.reconcileInternalFile !== "function") {
      this.nfeLog.info("vault", "this Obsidian build has no adapter.reconcileInternalFile; files Obsidian did not see appear after a restart");
      return;
    }
    try {
      void Promise.resolve(adapter.reconcileInternalFile(path)).catch((e: unknown) => this.nfeLog.error("vault", `reconcileInternalFile(${path}) failed`, e));
    } catch (e) {
      this.nfeLog.error("vault", `reconcileInternalFile(${path}) threw`, e);
    }
  }

  /**
   * Every file Obsidian lists under one of this plugin's extensions, checked
   * against the disk one folder listing at a time; each ghost goes through
   * `reconcileMissing`, each file the disk has and the index lacks through
   * `reconcileUnindexed`. Returns how many entries changed. Errors stay in the
   * log: this is housekeeping.
   */
  async sweepStale(reason: string): Promise<number> {
    try {
      const report = await findStaleFiles(this.app.vault.getFiles(), this.nfeRegistered, (folder) => this.nfeTransport.listDir(folder));
      for (const path of report.missing) this.reconcileMissing(path);
      for (const path of report.unindexed) this.reconcileUnindexed(path);
      const unlisted = report.unlisted.length > 0 ? `; ${report.unlisted.length} folder${report.unlisted.length === 1 ? "" : "s"} could not be listed` : "";
      const unindexed = `; ${report.unindexed.length} on disk but not listed${report.unindexed.length > 0 ? ` (${report.unindexed.join(", ")})` : ""}`;
      this.nfeLog.info("vault", `${reason}: ${report.checked} listed file${report.checked === 1 ? "" : "s"} checked against the disk; ${report.missing.length} stale${report.missing.length > 0 ? ` (${report.missing.join(", ")})` : ""}${unindexed}${unlisted}`);
      return report.missing.length + report.unindexed.length;
    } catch (e) {
      this.nfeLog.error("vault", `stale sweep (${reason}) failed`, e);
      return 0;
    }
  }

  /** Vault definitions (when on) and custom types into the registry; the notice names how many files failed. */
  private async loadLanguages(): Promise<void> {
    const report = await loadVaultLanguages({
      transport: this.nfeTransport,
      folder: this.nfeSettings.customLanguages ? this.languageFolder() : null,
      customExtensions: this.nfeSettings.customExtensions,
      log: this.nfeLog,
    });
    if (report.problems.length > 0) new Notice(plural(report.problems.length, "notice.languages.problems.one", "notice.languages.problems.other"), 8000);
  }

  /**
   * The plugin's one localization file, read before anything builds a string,
   * so the first notice and the first menu are already in the user's language.
   * No file means English, which is the usual case.
   */
  private async loadLocale(): Promise<void> {
    const report = await loadLocalization(this.nfeTransport, this.pluginFolder(), this.nfeLog);
    if (report.problem !== null) new Notice(t("notice.locale.problem", { file: LOCALIZATION_FILE, error: report.problem }), 8000);
  }

  /** The vault's text-language dictionaries (when on) into the lexicon Unwrap reads; the notice names how many files failed. */
  private async loadDictionaries(): Promise<void> {
    const report = await loadVaultDictionaries({
      transport: this.nfeTransport,
      folder: this.nfeSettings.customDictionaries ? this.dictionaryFolder() : null,
      log: this.nfeLog,
    });
    if (report.problems.length > 0) new Notice(plural(report.problems.length, "notice.dictionaries.problems.one", "notice.dictionaries.problems.other"), 8000);
  }

  /**
   * Read both folders again. New extensions are registered with Obsidian at
   * once (nobody else can own an extension that did not exist a moment ago);
   * an extension another plugin serves stays with it until the next reload,
   * as the yield rule says. Open panes keep their language until reopened.
   */
  async reread(announce: boolean): Promise<void> {
    await this.loadLanguages();
    await this.loadDictionaries();
    const owned = readOwnedExtensions(this.app);
    const fresh = registeredExtensions().filter((ext) => !this.nfeRegistered.has(ext) && (owned[ext] === undefined || owned[ext] === VIEW_TYPE_TEXT) && this.nfeSettings.extensions[ext] !== false);
    if (fresh.length > 0) {
      this.registerExtensions(fresh, VIEW_TYPE_TEXT);
      for (const ext of fresh) this.nfeRegistered.add(ext);
      this.nfeLog.info("claims", `reread took ${fresh.length} new extension${fresh.length === 1 ? "" : "s"}: ${fresh.map((e) => `.${e}`).join(", ")}`);
    }
    const report = await this.nfePalettes.load();
    const fixed = await this.sweepStale("reread");
    if (announce) {
      const n = report.palettes.length;
      new Notice(`Native File Editor: languages reread${fresh.length > 0 ? ` (+${fresh.length} extensions)` : ""}; ${this.nfeSettings.customPalettes ? `${n} palette${n === 1 ? "" : "s"}` : "palettes off"}${report.skipped.length > 0 ? `; ${report.skipped.length} skipped (see the log)` : ""}${fixed > 0 ? `; ${fixed} file entr${fixed === 1 ? "y" : "ies"} corrected` : ""}`);
    }
  }

  /** The light and dark example palettes for one language, from the theme's live colours, into the palette folder. */
  async createExamplePalette(language: string): Promise<void> {
    try {
      const colours = { light: readThemeColours(activeDocument, "light"), dark: readThemeColours(activeDocument, "dark") };
      const written = await this.nfePalettes.writeExample(language, colours);
      if (!this.nfeSettings.customPalettes) await this.saveSettings({ ...this.nfeSettings, customPalettes: true });
      await this.nfePalettes.load();
      new Notice(t("notice.palette.wrote", { files: written.map((p) => p.slice(p.lastIndexOf("/") + 1)).join(t("word.and")), folder: this.paletteFolder() }));
    } catch (e) {
      this.nfeLog.error("palette", `example for ${language} failed`, e);
      new Notice(t("notice.palette.failed", { error: e instanceof Error ? e.message : String(e) }));
    }
  }

  /** The plugin's own keyword table for a language as a JSON file in the language folder; only table-driven languages have one. */
  async createExampleLanguage(language: string): Promise<void> {
    try {
      const path = await writeExampleLanguage(this.nfeTransport, this.languageFolder(), language);
      if (path === null) {
        new Notice(t("notice.language.noTable", { language }));
        return;
      }
      if (!this.nfeSettings.customLanguages) await this.saveSettings({ ...this.nfeSettings, customLanguages: true });
      await this.reread(false);
      new Notice(t("notice.wrote", { path }));
    } catch (e) {
      this.nfeLog.error("languages", `example for ${language} failed`, e);
      new Notice(t("notice.language.exampleFailed", { error: e instanceof Error ? e.message : String(e) }));
    }
  }

  /** "Add to dictionary…": the dialog, then the word into the file of the kind it chose, then that folder reread. */
  /**
   * The review step after Unwrap (open item 21). A Hunspell dictionary is the
   * user's own file, copied into the dictionary folder by hand; when none is
   * there, nothing is offered and nothing is said, because most people have
   * none. When one is, the dialog asks before reading it: the file is several
   * megabytes and belongs to the user.
   */
  private async offerHunspellReview(joins: readonly RejoinedWord[], apply: (restore: readonly RejoinedWord[]) => boolean): Promise<void> {
    let dictionaries: HunspellPair[];
    try {
      dictionaries = await findHunspellDictionaries(this.nfeTransport, this.dictionaryFolder());
    } catch (e) {
      this.nfeLog.warn("hunspell", `looking for .dic files in ${this.dictionaryFolder()} failed: ${describeError(e)}`);
      return;
    }
    if (dictionaries.length === 0) return;
    new HunspellReviewModal(this.app, {
      joins,
      dictionaries,
      check: (pair, words) => checkWithHunspell({ transport: this.nfeTransport, pair, words, log: this.nfeLog }),
      textLanguages: () => allTextLanguageNames(),
      onApply: (restore) => {
        if (restore.length === 0) return;
        if (apply(restore)) new Notice(plural(restore.length, "notice.hunspell.restored.one", "notice.hunspell.restored.other"));
        else new Notice(t("notice.hunspell.changed"));
      },
      onAddWord: (word, language) => void this.addWordToVault({ kind: "text", language, word }),
      onProblem: (file, error) => {
        this.nfeLog.warn("hunspell", `${file}: ${error}`);
        new Notice(t("notice.hunspell.problem", { file, error }), 8000);
      },
    }).open();
  }

  openAddToDictionary(word: string, language: string | null): void {
    new AddToDictionaryModal(this.app, {
      word,
      textLanguages: () => allTextLanguageNames(),
      programmingLanguages: () => allLanguageNames().filter((n) => keywordTableFor(n) !== null),
      currentLanguage: language,
      onAdd: (choice) => void this.addWordToVault(choice),
    }).open();
  }

  private async addWordToVault(choice: DictionaryChoice): Promise<void> {
    try {
      if (choice.kind === "text") {
        const added = await addWordToDictionary(this.nfeTransport, this.dictionaryFolder(), choice.language, choice.word);
        if (added === null) {
          new Notice(t("notice.dictionary.notAWord"));
          return;
        }
        if (!this.nfeSettings.customDictionaries) await this.saveSettings({ ...this.nfeSettings, customDictionaries: true });
        await this.loadDictionaries();
        new Notice(added.added ? t("notice.dictionary.added", { word: added.entry, list: listName(added.list), language: choice.language, path: added.path }) : t("notice.dictionary.already", { language: choice.language, word: added.entry }));
        return;
      }
      const added = await addWordToLanguage(this.nfeTransport, this.languageFolder(), choice.language, choice.role, choice.word);
      if (added === null) {
        new Notice(t("notice.language.noWordList", { language: choice.language }));
        return;
      }
      if (!this.nfeSettings.customLanguages) await this.saveSettings({ ...this.nfeSettings, customLanguages: true });
      await this.reread(false);
      new Notice(added.added ? t("notice.keyword.added", { word: added.word, role: added.role, language: choice.language, path: added.path }) : t("notice.keyword.already", { language: choice.language, word: added.word, role: added.role }));
    } catch (e) {
      this.nfeLog.error(choice.kind === "text" ? "dictionaries" : "languages", `adding ${choice.word} to ${choice.language} failed`, e);
      new Notice(t("notice.word.failed", { error: e instanceof Error ? e.message : String(e) }));
    }
  }

  /** The plugin's own word lists for a text language as a JSON file in the dictionaries folder, for the user to extend. */
  async createExampleDictionary(language: string): Promise<void> {
    try {
      const path = await writeExampleDictionary(this.nfeTransport, this.dictionaryFolder(), language);
      if (path === null) {
        new Notice(t("notice.dictionary.noBundled", { language }));
        return;
      }
      if (!this.nfeSettings.customDictionaries) await this.saveSettings({ ...this.nfeSettings, customDictionaries: true });
      await this.loadDictionaries();
      new Notice(t("notice.dictionary.wrote", { path }));
    } catch (e) {
      this.nfeLog.error("dictionaries", `example for ${language} failed`, e);
      new Notice(t("notice.dictionary.exampleFailed", { error: e instanceof Error ? e.message : String(e) }));
    }
  }

  override onunload(): void {
    // Obsidian restores the previous owner of every extension this plugin
    // registered and detaches its views; the palette <style> and the log are
    // the plugin's own to remove and finish.
    this.nfeStyleSink?.clear();
    this.nfeLog?.info("plugin", "unload");
    void this.nfeLog?.flush();
  }

  private async saveSettings(next: SharedSettings): Promise<void> {
    this.nfeSettings = next;
    await this.saveData(next);
  }

  paletteFolder(): string {
    return resolvePaletteFolder(this.nfeSettings.paletteFolder, this.app.vault.configDir, PLUGIN_ID);
  }

  languageFolder(): string {
    return resolvePluginFolder(this.nfeSettings.languageFolder, this.app.vault.configDir, PLUGIN_ID, "languages");
  }

  dictionaryFolder(): string {
    return resolvePluginFolder(this.nfeSettings.dictionaryFolder, this.app.vault.configDir, PLUGIN_ID, "dictionaries");
  }

  /** The plugin's own folder: where `localization.json` goes, beside main.js and the log. */
  pluginFolder(): string {
    return `${this.app.vault.configDir}/plugins/${PLUGIN_ID}`;
  }

  /**
   * Insert ▸ Date / Date and time: the user's formats, else the Templates core
   * plugin's (Obsidian has no global date format; Templates and Daily notes
   * each keep their own, read here through the undocumented
   * `internalPlugins`, guarded), else `YYYY-MM-DD` and `HH:mm:ss`.
   */
  dateTimeNow(): { date: string; dateTime: string } {
    const s = this.nfeSettings;
    const templates = (this.app as unknown as { internalPlugins?: { plugins?: { templates?: { instance?: { options?: { dateFormat?: unknown; timeFormat?: unknown } } } } } }).internalPlugins?.plugins?.templates?.instance?.options;
    const pick = (own: string, theirs: unknown, fallback: string): string => (own.length > 0 ? own : typeof theirs === "string" && theirs.trim().length > 0 ? theirs.trim() : fallback);
    const dateFormat = pick(s.dateFormat, templates?.dateFormat, "YYYY-MM-DD");
    const timeFormat = pick(s.timeFormat, templates?.timeFormat, "HH:mm:ss");
    const now = moment();
    return { date: now.format(dateFormat), dateTime: `${now.format(dateFormat)} ${now.format(timeFormat)}` };
  }

  /** The dialog, then the file, then the pane: an empty file in the editor. */
  openNewFileModal(folder: string): void {
    new NewFileModal(this.app, {
      folder,
      lastExtension: this.nfeDevice.get().lastNewFileExtension,
      exists: (path) => this.app.vault.getAbstractFileByPath(path) !== null,
      onCreate: (choice) => void this.createAndOpen(choice.path, choice.extension),
    }).open();
  }

  async createAndOpen(path: string, extension: string): Promise<void> {
    try {
      const file = await this.app.vault.create(path, "");
      if (extension.length > 0) this.nfeDevice.update({ lastNewFileExtension: extension });
      this.nfeLog.info("new-file", path);
      // A type no view opens goes through `openFile` all the same: Obsidian
      // hands it to the operating system ("Select an app to open this .zzz
      // file"), which is the useful outcome after creating one (a Notice
      // instead was tried and taken back the same day, 2026-09-09).
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
      const view = leaf.view;
      if (view instanceof TextView) await view.setMode("edit");
    } catch (e) {
      this.nfeLog.error("new-file", `${path} failed`, e);
      new Notice(t("notice.create.failed", { path, error: e instanceof Error ? e.message : String(e) }));
    }
  }
}

/** Chromium's JS heap in MB, or null where `performance.memory` does not exist. */
function heapMb(): number | null {
  const mem = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory;
  return typeof mem?.usedJSHeapSize === "number" ? Math.round(mem.usedJSHeapSize / 1048576) : null;
}

function safeLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
