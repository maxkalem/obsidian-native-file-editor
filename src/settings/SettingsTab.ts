import { type App, type Plugin, PluginSettingTab, type Setting, type SettingDefinitionItem, type SettingGroupItem } from "obsidian";
import { registeredExtensions } from "../highlight/registry";
import type { DesktopShell } from "../platform/desktopShell";
import { DEFAULT_RUNNERS, type RunnerDef, formatArgvLine, parseArgvLine } from "../run/runners";
import type { DeviceLocalStore } from "./DeviceLocalStore";
import type { SharedSettings } from "./settings";

/**
 * Declarative settings tab (Obsidian 1.13). Keys are strings the API routes
 * back through getControlValue and setControlValue. Three prefixes keep the
 * stores apart: `shared.` writes data.json, `device.` writes localStorage, and
 * `ext.` is a shared toggle per extension. Rows that need buttons (folders,
 * interpreters, custom types) are `render` items built on a `Setting`; rows
 * behind a switch use `visible`, and the tab re-renders through `refresh`
 * after every write. The test over this module asserts that every control key
 * resolves in both directions and that the switches hide what they guard.
 */

export interface SettingsTabDeps {
  readonly settings: () => SharedSettings;
  readonly saveSettings: (next: SharedSettings) => Promise<void>;
  readonly device: DeviceLocalStore;
  /** Extension -> view type of the current owner, for the toggle descriptions. */
  readonly ownedElsewhere: () => Record<string, string>;
  /** The palette and language folders as resolved (the default when the setting is empty). */
  readonly paletteFolder: () => string;
  readonly languageFolder: () => string;
  /** Native dialogs and "open in explorer"; null on mobile, where the rows show the path without buttons. */
  readonly shell: DesktopShell | null;
  /** Create a vault folder if it is missing. */
  readonly ensureFolder: (vaultPath: string) => Promise<void>;
  /** Every language the registry knows, for pickers; the table-driven subset can have an example definition. */
  readonly languages: () => string[];
  readonly tableLanguages: () => string[];
  readonly pickLanguage: (languages: string[], placeholder: string) => Promise<string | null>;
  readonly promptText: (title: string, description: string, placeholder: string) => Promise<string | null>;
  /** Read the language and palette folders again and register anything new. */
  readonly reread: () => Promise<void>;
  readonly createExamplePalette: (language: string) => Promise<void>;
  readonly createExampleLanguage: (language: string) => Promise<void>;
  readonly reloadPlugin: () => Promise<void>;
  /** The Run group exists on the desktop only (ADR-004). */
  readonly isDesktop: () => boolean;
  readonly notice: (message: string) => void;
  /** Re-render the tab; set by the tab itself, a no-op in tests. */
  refresh: () => void;
}

const MB = 1024 * 1024;

export class NfeSettingsTab extends PluginSettingTab {
  private readonly deps: SettingsTabDeps;

  constructor(app: App, plugin: Plugin, deps: SettingsTabDeps) {
    super(app, plugin);
    this.deps = deps;
    deps.refresh = () => this.update();
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    return buildDefinitions(this.deps);
  }

  override getControlValue(key: string): unknown {
    return readSettingValue(key, this.deps);
  }

  override setControlValue(key: string, value: unknown): Promise<void> {
    return writeSettingValue(key, value, this.deps);
  }
}

/** A folder row: the path as the name, buttons to open it, change it, reread, and create an example. */
function folderRow(
  deps: SettingsTabDeps,
  opts: { name: string; desc: string; folder: () => string; save: (vaultPath: string) => Promise<void>; exampleLanguages: () => string[]; createExample: (language: string) => Promise<void>; examplePlaceholder: string }
): SettingGroupItem {
  return {
    name: opts.name,
    desc: opts.desc,
    render: (setting: Setting) => {
      setting.setName(opts.name);
      setting.setDesc(`${opts.folder()}. ${opts.desc}`);
      const shell = deps.shell;
      if (shell) {
        setting.addExtraButton((b) =>
          b
            .setIcon("folder-open")
            .setTooltip("Open the folder in the file explorer (created if missing)")
            .onClick(() => {
              void (async () => {
                const folder = opts.folder();
                await deps.ensureFolder(folder);
                const err = await shell.openPath(shell.toAbsolute(folder));
                if (err) deps.notice(`Native File Editor: could not open the folder: ${err}`);
              })();
            })
        );
        setting.addExtraButton((b) =>
          b
            .setIcon("folder-input")
            .setTooltip("Choose another folder inside the vault")
            .onClick(() => {
              void (async () => {
                const picked = await shell.pickFolder(shell.toAbsolute(opts.folder()));
                if (picked === null) return;
                const vaultPath = shell.toVaultPath(picked);
                if (vaultPath === null) {
                  deps.notice("Native File Editor: the folder must be inside the vault.");
                  return;
                }
                await opts.save(vaultPath);
                await deps.reread();
                deps.refresh();
              })();
            })
        );
      }
      setting.addButton((b) =>
        b
          .setButtonText("Reread")
          .setTooltip("Read the language and palette folders again")
          .onClick(() => void deps.reread().then(() => deps.refresh()))
      );
      setting.addButton((b) =>
        b
          .setButtonText("Create example…")
          .setTooltip("Pick a language; its example file is written into the folder from the plugin's own definition")
          .onClick(() => {
            void (async () => {
              const language = await deps.pickLanguage(opts.exampleLanguages(), opts.examplePlaceholder);
              if (language === null) return;
              await deps.ensureFolder(opts.folder());
              await opts.createExample(language);
              await deps.reread();
              deps.refresh();
            })();
          })
      );
    },
  };
}

/** The interpreter row for one runner: language, the argv line, and the buttons to change or edit it. */
function runnerRow(deps: SettingsTabDeps, index: number): SettingGroupItem {
  const def = deps.device.get().runners[index];
  if (!def) return { name: "" };
  const save = (next: RunnerDef) => {
    const runners = [...deps.device.get().runners];
    runners[index] = next;
    deps.device.update({ runners });
  };
  return {
    name: def.language,
    desc: def.name,
    render: (setting: Setting) => {
      setting.setName(def.language);
      if (def.kind === "worker" || def.kind === "open") {
        setting.setDesc(def.kind === "worker" ? `${def.name}: runs inside Obsidian, no program of yours` : `${def.name}: the operating system opens the file with its default application`);
        return;
      }
      const line = def.steps ? def.steps.map((s) => formatArgvLine(s)).join("  &&  ") : formatArgvLine(def.argv ?? []);
      setting.setDesc(`${def.name}: ${line}`);
      let editing = false;
      let field: { inputEl: HTMLInputElement; setValue(v: string): unknown } | null = null;
      const shell = deps.shell;
      if (shell && def.argv) {
        setting.addExtraButton((b) =>
          b
            .setIcon("folder")
            .setTooltip("Choose the interpreter executable")
            .onClick(() => {
              void (async () => {
                const argv = def.argv ?? [];
                const picked = await shell.pickFile(argv[0] ?? "");
                if (picked === null) return;
                save({ ...def, argv: [picked, ...argv.slice(1)] });
                deps.refresh();
              })();
            })
        );
      }
      setting.addExtraButton((b) =>
        b
          .setIcon("pencil")
          .setTooltip("Edit the command line: the program, then its arguments; {file} is the file's path")
          .onClick(() => {
            if (editing) return;
            editing = true;
            setting.addText((t) => {
              field = t;
              t.setValue(def.argv ? formatArgvLine(def.argv) : line);
              t.inputEl.addClass("nfe-setting-argv");
              t.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
                if (e.key === "Enter") commit();
              });
              t.inputEl.addEventListener("blur", () => commit());
            });
            field?.inputEl.focus();
          })
      );
      const commit = () => {
        if (!field) return;
        const argv = parseArgvLine(field.inputEl.value);
        if (argv.length === 0 || (argv[0] ?? "").includes("{file}")) {
          deps.notice("Native File Editor: the command line needs a program first, then its arguments.");
          return;
        }
        if (def.steps) {
          deps.notice("Native File Editor: a multi-step runner is edited as JSON in localStorage for now; only single-command runners have the edit field.");
          return;
        }
        save({ ...def, argv });
        deps.refresh();
      };
    },
  };
}

function customTypeRow(deps: SettingsTabDeps, ext: string, language: string): SettingGroupItem {
  return {
    name: `.${ext}`,
    desc: `opens as ${language}`,
    render: (setting: Setting) => {
      setting.setName(`.${ext}`);
      setting.setDesc(`Opens as ${language}. Applied at once and at every start.`);
    },
  };
}

export function buildDefinitions(deps: SettingsTabDeps): SettingDefinitionItem[] {
  const owned = deps.ownedElsewhere();
  const s = deps.settings();
  const extensionItems: SettingGroupItem[] = registeredExtensions().map((ext) => {
    const owner = owned[ext];
    return {
      name: `.${ext}`,
      desc:
        owner !== undefined
          ? `Currently opened by ${owner}. Turn on to take it over. Takes effect after the plugin reloads.`
          : "Takes effect after the plugin reloads.",
      control: { type: "toggle", key: `ext.${ext}`, defaultValue: owner === undefined },
    };
  });
  const customTypeItems: SettingGroupItem[] = Object.entries(s.customExtensions)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ext, language]) => customTypeRow(deps, ext, language));
  const runnerItems: SettingGroupItem[] = deps.device.get().runners.map((_, i) => runnerRow(deps, i));

  const palettesOn = () => deps.settings().customPalettes;
  const languagesOn = () => deps.settings().customLanguages;
  const runOn = () => deps.device.get().runEnabled;

  return [
    {
      type: "group",
      heading: "Opening",
      items: [
        {
          name: "Initial mode",
          desc: "Preview renders instantly; the editor is built when you ask for it. Remember keeps the last mode per file on this device.",
          control: {
            type: "dropdown",
            key: "shared.initialMode",
            options: { preview: "Preview first", edit: "Always editing", remember: "Remember per file" },
          },
        },
        {
          name: "Large file limit (MB)",
          desc: "Files above this size open in preview only, with a button to edit anyway. Per device.",
          control: { type: "number", key: "device.largeFileMb", min: 0, step: 1 },
        },
      ],
    },
    {
      type: "group",
      heading: "Editor",
      items: [
        { name: "Line numbers", control: { type: "toggle", key: "shared.lineNumbers" } },
        { name: "Word wrap", control: { type: "toggle", key: "shared.wordWrap" } },
        { name: "Tab size", control: { type: "number", key: "shared.tabSize", min: 1, max: 16, step: 1 } },
        { name: "Tab inserts spaces", control: { type: "toggle", key: "shared.tabInsertsSpaces" } },
      ],
    },
    {
      type: "group",
      heading: "Palettes",
      items: [
        {
          name: "Use custom palettes",
          desc: "Colour files from the palette folder override the theme's colours for the files they name. Off: the editor follows the Obsidian theme.",
          control: { type: "toggle", key: "shared.customPalettes" },
        },
        {
          ...folderRow(deps, {
            name: "Palette folder",
            desc: "Files are <Language>_light.css / <Language>_dark.css (or .xml from Notepad++, .js from a CodeMirror theme); a name that is no language applies to every file. A file in the folder is used while it is there; otherwise the plugin's own colours.",
            folder: () => deps.paletteFolder(),
            save: async (vaultPath) => deps.saveSettings({ ...deps.settings(), paletteFolder: vaultPath }),
            exampleLanguages: () => deps.languages(),
            createExample: (language) => deps.createExamplePalette(language),
            examplePlaceholder: "Language for the example palette (light and dark files)",
          }),
          visible: palettesOn,
        },
      ],
    },
    {
      type: "group",
      heading: "Languages",
      items: [
        {
          name: "Use custom languages",
          desc: "JSON definitions from the language folder (name, extensions, comment syntax, keyword sets) highlight files, replacing the plugin's own definition for the same extensions while the file is there.",
          control: { type: "toggle", key: "shared.customLanguages" },
        },
        {
          ...folderRow(deps, {
            name: "Language folder",
            desc: "One .json per language. Create example writes the plugin's own table for a keyword-based language; edit it, then Reread.",
            folder: () => deps.languageFolder(),
            save: async (vaultPath) => deps.saveSettings({ ...deps.settings(), languageFolder: vaultPath }),
            exampleLanguages: () => deps.tableLanguages(),
            createExample: (language) => deps.createExampleLanguage(language),
            examplePlaceholder: "Language for the example definition (keyword-based languages only)",
          }),
          visible: languagesOn,
        },
      ],
    },
    ...(deps.isDesktop()
      ? ([
          {
            type: "group",
            heading: "Run (this device)",
            items: [
              {
                name: "Enable Run",
                desc: "Adds a Run button to the head bar and the commands Run file and Stop run. A run starts the interpreter set for the file's language, on this device, with your permissions, only when you press Run. Off by default; nothing ever runs on its own.",
                control: { type: "toggle", key: "device.runEnabled" },
              },
              {
                name: "Timeout (seconds)",
                desc: "A run longer than this is killed, with its child processes.",
                control: { type: "number", key: "device.runTimeoutS", min: 1, step: 1 },
                visible: runOn,
              },
              {
                name: "Output limit (KB)",
                desc: "Output beyond this is dropped and the program is killed.",
                control: { type: "number", key: "device.runOutputCapKb", min: 1, step: 64 },
                visible: runOn,
              },
              {
                name: "Reset interpreters to the defaults",
                desc: "Each language's own standard tool, found through PATH.",
                action: () => {
                  deps.device.update({ runners: [...DEFAULT_RUNNERS] });
                  deps.refresh();
                },
                visible: runOn,
              },
            ],
          },
          {
            type: "list",
            heading: "Interpreters",
            emptyState: "No interpreters. Add one: pick a language, then its program.",
            items: runnerItems,
            visible: runOn,
            addItem: {
              name: "Add",
              action: () => {
                void (async () => {
                  const language = await deps.pickLanguage(deps.languages(), "Language to run");
                  if (language === null) return;
                  const shell = deps.shell;
                  const program = shell ? await shell.pickFile("") : null;
                  if (program === null) return;
                  const name = program.replace(/^.*[\\/]/, "").replace(/\.exe$/i, "");
                  deps.device.update({ runners: [...deps.device.get().runners, { language, name, argv: [program, "{file}"] }] });
                  deps.refresh();
                })();
              },
            },
            onDelete: (index: number) => {
              const runners = [...deps.device.get().runners];
              runners.splice(index, 1);
              deps.device.update({ runners });
              deps.refresh();
            },
          },
        ] as SettingDefinitionItem[])
      : []),
    {
      type: "page",
      name: "File types",
      desc: "Which extensions this plugin opens, and your own additions.",
      displayValue: () => `${registeredExtensions().length} known`,
      items: [
        {
          type: "list",
          heading: "Custom file types",
          emptyState: "None. Add an extension and pick the language that opens it; useful when you have written a language definition for it.",
          items: customTypeItems,
          addItem: {
            name: "Add",
            action: () => {
              void (async () => {
                const ext = await deps.promptText("Custom file type", "The extension without the dot, e.g. xl", "extension");
                if (ext === null || !/^\.?[a-z0-9_+-]+$/i.test(ext)) {
                  if (ext !== null) deps.notice("Native File Editor: an extension is letters, digits, _ + or -.");
                  return;
                }
                const language = await deps.pickLanguage(deps.languages(), `Language that opens .${ext}`);
                if (language === null) return;
                const next = { ...deps.settings(), customExtensions: { ...deps.settings().customExtensions, [ext.toLowerCase().replace(/^\./, "")]: language } };
                await deps.saveSettings(next);
                await deps.reread();
                deps.refresh();
              })();
            },
          },
          onDelete: (index: number) => {
            const entries = Object.entries(deps.settings().customExtensions).sort(([a], [b]) => a.localeCompare(b));
            const removed = entries[index];
            if (!removed) return;
            const customExtensions = { ...deps.settings().customExtensions };
            delete customExtensions[removed[0]];
            void deps
              .saveSettings({ ...deps.settings(), customExtensions })
              .then(() => deps.reread())
              .then(() => deps.refresh());
          },
        },
        {
          type: "group",
          heading: "Known extensions",
          items: extensionItems,
        },
      ],
    },
    {
      type: "group",
      heading: "Plugin",
      items: [
        {
          name: "Reload plugin",
          desc: "Disable and enable Native File Editor: applies file-type changes and rereads everything. This settings page closes.",
          action: () => void deps.reloadPlugin(),
        },
      ],
    },
  ];
}

export function readSettingValue(key: string, deps: SettingsTabDeps): unknown {
  const s = deps.settings();
  if (key.startsWith("ext.")) {
    const ext = key.slice(4);
    const explicit = s.extensions[ext];
    if (explicit !== undefined) return explicit;
    return deps.ownedElsewhere()[ext] === undefined;
  }
  switch (key) {
    case "shared.initialMode":
      return s.initialMode;
    case "shared.lineNumbers":
      return s.lineNumbers;
    case "shared.wordWrap":
      return s.wordWrap;
    case "shared.tabSize":
      return s.tabSize;
    case "shared.tabInsertsSpaces":
      return s.tabInsertsSpaces;
    case "shared.customPalettes":
      return s.customPalettes;
    case "shared.customLanguages":
      return s.customLanguages;
    case "device.largeFileMb":
      return Math.round(deps.device.get().largeFileBytes / MB);
    case "device.runEnabled":
      return deps.device.get().runEnabled;
    case "device.runTimeoutS":
      return Math.round(deps.device.get().runTimeoutMs / 1000);
    case "device.runOutputCapKb":
      return Math.round(deps.device.get().runOutputCapBytes / 1024);
    default:
      return undefined;
  }
}

export async function writeSettingValue(key: string, value: unknown, deps: SettingsTabDeps): Promise<void> {
  if (key === "device.largeFileMb") {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) deps.device.update({ largeFileBytes: Math.round(value * MB) });
    return;
  }
  if (key === "device.runEnabled") {
    if (typeof value === "boolean") {
      deps.device.update({ runEnabled: value });
      deps.refresh();
    }
    return;
  }
  if (key === "device.runTimeoutS") {
    if (typeof value === "number" && Number.isFinite(value) && value >= 1) deps.device.update({ runTimeoutMs: Math.round(value * 1000) });
    return;
  }
  if (key === "device.runOutputCapKb") {
    if (typeof value === "number" && Number.isFinite(value) && value >= 1) deps.device.update({ runOutputCapBytes: Math.round(value * 1024) });
    return;
  }
  const s: SharedSettings = { ...deps.settings(), extensions: { ...deps.settings().extensions }, customExtensions: { ...deps.settings().customExtensions } };
  let rereadAfter = false;
  if (key.startsWith("ext.")) {
    if (typeof value === "boolean") s.extensions[key.slice(4)] = value;
  } else {
    switch (key) {
      case "shared.initialMode":
        if (value === "preview" || value === "edit" || value === "remember") s.initialMode = value;
        break;
      case "shared.lineNumbers":
        if (typeof value === "boolean") s.lineNumbers = value;
        break;
      case "shared.wordWrap":
        if (typeof value === "boolean") s.wordWrap = value;
        break;
      case "shared.tabSize":
        if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 16) s.tabSize = value;
        break;
      case "shared.tabInsertsSpaces":
        if (typeof value === "boolean") s.tabInsertsSpaces = value;
        break;
      case "shared.customPalettes":
        if (typeof value === "boolean") {
          s.customPalettes = value;
          rereadAfter = true;
        }
        break;
      case "shared.customLanguages":
        if (typeof value === "boolean") {
          s.customLanguages = value;
          rereadAfter = true;
        }
        break;
      default:
        return;
    }
  }
  await deps.saveSettings(s);
  if (rereadAfter) {
    await deps.reread();
    deps.refresh();
  }
}
