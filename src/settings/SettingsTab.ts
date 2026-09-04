import { type App, type Plugin, PluginSettingTab, type SettingDefinitionItem, type SettingGroupItem } from "obsidian";
import { registeredExtensions } from "../highlight/registry";
import type { DeviceLocalStore } from "./DeviceLocalStore";
import type { SharedSettings } from "./settings";

/**
 * Declarative settings tab (Obsidian 1.13). Keys are strings the API routes
 * back through getControlValue and setControlValue. Three prefixes keep the
 * stores apart: `shared.` writes data.json, `device.` writes localStorage, and
 * `ext.` is a shared toggle per extension. The test over this module asserts
 * that every key a definition names resolves in both directions.
 */

export interface SettingsTabDeps {
  readonly settings: () => SharedSettings;
  readonly saveSettings: (next: SharedSettings) => Promise<void>;
  readonly device: DeviceLocalStore;
  /** Extension -> view type of the current owner, for the toggle descriptions. */
  readonly ownedElsewhere: () => Record<string, string>;
}

const MB = 1024 * 1024;

export class NfeSettingsTab extends PluginSettingTab {
  private readonly deps: SettingsTabDeps;

  constructor(app: App, plugin: Plugin, deps: SettingsTabDeps) {
    super(app, plugin);
    this.deps = deps;
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

export function buildDefinitions(deps: SettingsTabDeps): SettingDefinitionItem[] {
  const owned = deps.ownedElsewhere();
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
        {
          name: "Highlight preview up to (MB)",
          desc: "Above this size the preview is plain text, so it still renders at once. Per device.",
          control: { type: "number", key: "device.previewHighlightMb", min: 0, step: 1 },
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
      heading: "File types",
      items: extensionItems,
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
    case "device.largeFileMb":
      return Math.round(deps.device.get().largeFileBytes / MB);
    case "device.previewHighlightMb":
      return Math.round(deps.device.get().previewHighlightBytes / MB);
    default:
      return undefined;
  }
}

export async function writeSettingValue(key: string, value: unknown, deps: SettingsTabDeps): Promise<void> {
  if (key === "device.largeFileMb" || key === "device.previewHighlightMb") {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      const bytes = Math.round(value * MB);
      deps.device.update(key === "device.largeFileMb" ? { largeFileBytes: bytes } : { previewHighlightBytes: bytes });
    }
    return;
  }
  const s: SharedSettings = { ...deps.settings(), extensions: { ...deps.settings().extensions } };
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
      default:
        return;
    }
  }
  await deps.saveSettings(s);
}
