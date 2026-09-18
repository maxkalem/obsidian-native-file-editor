import { type App, Platform, type Plugin, PluginSettingTab, type Setting, type SettingDefinitionItem, type SettingGroupItem } from "obsidian";
import { type Chord, HOTKEY_ACTIONS, type HotkeyAction, type HotkeyPlatform, chordConflicts, chordFor, chordOfEvent, chordText, defaultChord, describeChord, hotkeyMeaning, hotkeyName, platformOf } from "../core/hotkeys";
import { registeredExtensions } from "../highlight/registry";
import { plural, t } from "../core/i18n";
import { LOCALIZATION_FILE } from "../core/localization";
import type { DesktopShell } from "../platform/desktopShell";
import { type RunnerDef, STANDARD_COMMANDS, formatArgvLine, formatStepsLine, parseArgvLine, parseStepsLine, runnerForProgram } from "../run/runners";
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
  /** The palette, language, dictionary and locale folders as resolved (the default when the setting is empty). */
  readonly paletteFolder: () => string;
  readonly languageFolder: () => string;
  readonly dictionaryFolder: () => string;
  /** The plugin's own folder, where `localization.json` lives. */
  readonly pluginFolder: () => string;
  /** The localization file in force: its name and how much of the plugin it translates; null when there is none. */
  readonly localization: () => { name: string; translated: number; total: number } | null;
  /** Native dialogs and "open in explorer"; null on mobile, where the rows show the path without buttons. */
  readonly shell: DesktopShell | null;
  /** Create a vault folder if it is missing. */
  readonly ensureFolder: (vaultPath: string) => Promise<void>;
  /** Every language the registry knows, for pickers; the table-driven subset can have an example definition. */
  readonly languages: () => string[];
  readonly tableLanguages: () => string[];
  readonly pickLanguage: (languages: string[], placeholder: string) => Promise<string | null>;
  readonly promptText: (title: string, description: string, placeholder: string) => Promise<string | null>;
  /** A yes-or-nothing question before something irreversible; false on Escape, the X or a tap outside. */
  readonly confirm: (title: string, description: string, button: string) => Promise<boolean>;
  /** Read the language and palette folders again and register anything new. */
  readonly reread: () => Promise<void>;
  readonly createExamplePalette: (language: string) => Promise<void>;
  readonly createExampleLanguage: (language: string) => Promise<void>;
  /** The text languages whose word lists Unwrap uses, bundled ones and the vault's. */
  readonly textLanguages: () => string[];
  readonly createExampleDictionary: (language: string) => Promise<void>;
  readonly reloadPlugin: () => Promise<void>;
  /** The regular-expression guide, also behind the `?` in the search panel. */
  readonly regexHelp: () => void;
  /** The names of Obsidian's own commands whose active hotkey is this chord (any plugin's too); [] when Obsidian does not tell. */
  readonly obsidianHoldersOf: (chord: Chord) => string[];
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
    // Obsidian's page rows (`mod-navigable`) get no hover colour in its own stylesheet, its action rows
    // (`mod-action`) do; both should read as buttons, so styles.css gives the
    // navigable rows of THIS tab the same hover, through this class.
    this.containerEl.addClass("nfe-settings-tab");
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
        setting.addButton((b) =>
          b
            .setButtonText(t("button.chooseFolder"))
            .setTooltip(t("button.chooseFolder.tooltip"))
            .onClick(() => {
              void (async () => {
                const current = opts.folder();
                await deps.ensureFolder(current);
                const picked = await shell.pickFolder(shell.toAbsolute(current));
                if (picked === null) return;
                const vaultPath = shell.toVaultPath(picked);
                if (vaultPath === null) {
                  deps.notice(t("notice.folder.outsideVault"));
                  return;
                }
                if (vaultPath !== current) await opts.save(vaultPath);
                await deps.reread();
                deps.refresh();
              })();
            })
        );
      }
      setting.addButton((b) =>
        b
          .setButtonText(t("button.reread"))
          .setTooltip(t("button.reread.tooltip"))
          .onClick(() => void deps.reread().then(() => deps.refresh()))
      );
      setting.addButton((b) =>
        b
          .setButtonText(t("button.createExample"))
          .setTooltip(t("button.createExample.tooltip"))
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
      // A compile-then-run row shows its steps joined with ` && `; the folder
      // button replaces the FIRST step's program (the compiler), the pencil
      // edits every step on one line.
      const line = def.steps ? formatStepsLine(def.steps) : formatArgvLine(def.argv ?? []);
      setting.setDesc(line);
      let editing = false;
      let field: { inputEl: HTMLInputElement; setValue(v: string): unknown } | null = null;
      const shell = deps.shell;
      if (shell) {
        setting.addExtraButton((b) =>
          b
            .setIcon("folder")
            .setTooltip(t("settings.run.interpreter.program.tooltip"))
            .onClick(() => {
              void (async () => {
                const first = def.steps ? (def.steps[0] ?? []) : (def.argv ?? []);
                const picked = await shell.pickFile(first[0] ?? "");
                if (picked === null) return;
                if (def.steps) {
                  const steps = def.steps.map((step, i) => (i === 0 ? [picked, ...step.slice(1)] : [...step]));
                  save({ ...def, steps });
                } else {
                  save({ ...def, argv: [picked, ...(def.argv ?? []).slice(1)] });
                }
                deps.refresh();
              })();
            })
        );
      }
      setting.addExtraButton((b) =>
        b
          .setIcon("pencil")
          .setTooltip(t("settings.run.interpreter.command.tooltip"))
          .onClick(() => {
            if (editing) return;
            editing = true;
            setting.addText((input) => {
              field = input;
              input.setValue(line);
              input.inputEl.addClass("nfe-setting-argv");
              // Enter keeps the field open on a bad line so it can be fixed;
              // Escape, and leaving the field with a bad line, put the saved
              // line back (2026-09-16, the user: an emptied field had no way
              // out, every blur brought the same notice again).
              input.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
                if (e.key === "Enter") commit(true);
                else if (e.key === "Escape") {
                  e.preventDefault();
                  cancel();
                }
              });
              input.inputEl.addEventListener("blur", () => commit(false));
            });
            field?.inputEl.focus();
          })
      );
      const cancel = () => {
        if (!field) return;
        field.inputEl.remove();
        field = null;
        editing = false;
      };
      setting.addExtraButton((b) =>
        b
          .setIcon("trash")
          .setTooltip(t("settings.run.interpreter.remove.tooltip"))
          .onClick(() => {
            const runners = [...deps.device.get().runners];
            runners.splice(index, 1);
            deps.device.update({ runners });
            deps.refresh();
          })
      );
      /** `stay`: on a bad line keep editing (Enter); otherwise give the line up and put the saved one back (blur). */
      const commit = (stay: boolean) => {
        if (!field) return;
        const value = field.inputEl.value;
        if (def.steps) {
          const steps = parseStepsLine(value);
          if (steps.length === 0 || steps.some((s) => (s[0] ?? "").includes("{file}"))) {
            deps.notice(`${t("notice.run.steps.invalid")}${stay ? "" : t("notice.run.kept", { line })}`);
            if (!stay) cancel();
            return;
          }
          field = null;
          save({ ...def, steps });
        } else {
          const argv = parseArgvLine(value);
          if (argv.length === 0 || (argv[0] ?? "").includes("{file}")) {
            deps.notice(`${t("notice.run.command.invalid")}${stay ? "" : t("notice.run.kept", { line })}`);
            if (!stay) cancel();
            return;
          }
          field = null;
          save({ ...def, argv });
        }
        deps.refresh();
      };
    },
  };
}

function customTypeRow(deps: SettingsTabDeps, ext: string, language: string): SettingGroupItem {
  return {
    name: `.${ext}`,
    desc: t("settings.fileTypes.custom.opensAs", { language }),
    render: (setting: Setting) => {
      setting.setName(`.${ext}`);
      setting.setDesc(t("settings.fileTypes.custom.desc", { language }));
    },
  };
}

/**
 * One row of the Hotkeys section: the action's name, its key as it is (and
 * the default when changed, and any other action on the same key), a pencil
 * that turns the row into a recorder (the next key pressed becomes the
 * chord; Escape cancels) and, when changed, a reset. Editor-bound actions
 * (the arrows and lines) run inside CodeMirror after Obsidian's own hotkeys,
 * so a key Obsidian takes for itself cannot reach them; the Scope-bound ones
 * (search, occurrences, comment, completion) run first and can.
 */
function hotkeyRow(deps: SettingsTabDeps, action: HotkeyAction): SettingGroupItem {
  const platform = platformOf(Platform);
  const mac = platform === "mac";
  const own = () => deps.settings().hotkeys[platform];
  const current = () => chordFor(action.id, own(), platform);
  const isDefault = () => chordText(current()) === chordText(defaultChord(action, platform));
  const save = async (text: string | null) => {
    const mine = { ...own() };
    if (text === null) delete mine[action.id];
    else mine[action.id] = text;
    await deps.saveSettings({ ...deps.settings(), hotkeys: { ...deps.settings().hotkeys, [platform]: mine } });
    deps.refresh();
  };
  return {
    name: hotkeyName(action),
    desc: describeChord(current(), mac),
    render: (setting: Setting) => {
      setting.setName(hotkeyName(action));
      // The description is built, not one string: the key as a keycap, the default when changed,
      // a red "already used by …" when another action has the same key, then what the action does.
      const others = takenBy(own(), action.id, platform);
      setting.setDesc("");
      setting.descEl.createSpan({ cls: "nfe-hotkey-key", text: describeChord(current(), mac) });
      if (!isDefault()) setting.descEl.createSpan({ cls: "nfe-hotkey-default", text: t("settings.keys.default", { chord: describeChord(defaultChord(action, platform), mac) }) });
      // Toggled, not added: the declarative tab reuses the row's element across refreshes, and a class
      // added while two rows clashed stayed on after one of them was remapped (seen 2026-09-09).
      setting.settingEl.toggleClass("nfe-hotkey-conflict", others.length > 0);
      if (others.length > 0) setting.descEl.createSpan({ cls: "nfe-hotkey-taken", text: t("settings.keys.taken", { actions: others.join(", ") }) });
      // An editor-bound action on a key one of Obsidian's hotkeys holds: Obsidian runs first and keeps the
      // key, so it never reaches the text. Shown in the warning colour with the holder's name.
      const obsidian = deps.obsidianHoldersOf(current());
      // A NON-default key that is one of Obsidian's is marked as a warning, not brightly but apart from the plain colour.
      // The text differs: inside the text Obsidian wins and the key never arrives; a
      // Scope-bound action wins over Obsidian while the pane has the focus, so its note is muted.
      const warned = obsidian.length > 0 && !isDefault();
      // The explanation carries the warning colour, not the keycap; a default key on Obsidian's list stays muted.
      // No class on the row: the page's indicator comes from `hotkeysNeedAttention`, and the styles test wants a rule for every class emitted.
      const cls = warned ? "nfe-hotkey-obsidian" : "nfe-hotkey-default";
      if (obsidian.length > 0 && action.where === "editor") setting.descEl.createSpan({ cls, text: t("settings.keys.obsidian.editor", { commands: obsidian.join(", ") }) });
      else if (obsidian.length > 0) setting.descEl.createSpan({ cls, text: t("settings.keys.obsidian.scope", { commands: obsidian.join(", ") }) });
      setting.descEl.createDiv({ cls: "nfe-hotkey-meaning", text: `${hotkeyMeaning(action)}${action.where === "editor" ? t("settings.keys.editorNote") : ""}` });
      let recording = false;
      setting.addExtraButton((b) =>
        b
          .setIcon("pencil")
          .setTooltip(t("settings.keys.change.tooltip"))
          .onClick(() => {
            if (recording) return;
            recording = true;
            setting.addText((field) => {
              field.setPlaceholder(t("settings.keys.press"));
              field.inputEl.addClass("nfe-setting-hotkey");
              field.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.key === "Escape") {
                  deps.refresh();
                  return;
                }
                const chord = chordOfEvent(e, mac);
                if (!chord) return;
                field.setValue(describeChord(chord, mac));
                // Taken already: said at once, and saved all the same (the row turns red; Obsidian's own hotkey settings do the same).
                const holders = HOTKEY_ACTIONS.filter((a) => a.id !== action.id && chordText(chordFor(a.id, own(), platform)) === chordText(chord)).map((a) => hotkeyName(a));
                if (holders.length > 0) deps.notice(t("notice.keys.conflict", { chord: describeChord(chord, mac), actions: holders.join(", ") }));
                // Obsidian's own hotkey on an editor-bound action: said at once too, and saved all the same (the row shows the warning).
                const obsidian = action.where === "editor" ? deps.obsidianHoldersOf(chord) : [];
                if (obsidian.length > 0) deps.notice(t("notice.keys.obsidian", { chord: describeChord(chord, mac), commands: obsidian.join(", "), action: hotkeyName(action) }));
                void save(chordText(chord));
              });
              field.inputEl.focus();
            });
          })
      );
      if (!isDefault()) {
        setting.addExtraButton((b) =>
          b
            .setIcon("rotate-ccw")
            .setTooltip(t("settings.keys.reset.tooltip", { chord: describeChord(defaultChord(action, platform), mac) }))
            .onClick(() => void save(null))
        );
      }
    },
  };
}

/** Whether any row of the Hotkeys page is red or in the warning colour: a shared chord, or a changed chord one of Obsidian's hotkeys holds. */
export function hotkeysNeedAttention(deps: SettingsTabDeps): boolean {
  const platform = platformOf(Platform);
  const own = deps.settings().hotkeys[platform];
  if (chordConflicts(own, platform).length > 0) return true;
  return HOTKEY_ACTIONS.some((a) => own[a.id] !== undefined && deps.obsidianHoldersOf(chordFor(a.id, own, platform)).length > 0);
}

/** The names of the other actions on this action's chord. */
function takenBy(hotkeys: Readonly<Record<string, string>>, id: string, platform: HotkeyPlatform): string[] {
  const conflict = chordConflicts(hotkeys, platform).find((ids) => ids.includes(id));
  if (!conflict) return [];
  return conflict
    .filter((other) => other !== id)
    .map((other) => {
      const action = HOTKEY_ACTIONS.find((a) => a.id === other);
      return action ? hotkeyName(action) : other;
    });
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
          ? t("settings.fileTypes.ext.ownedBy", { owner })
          : t("settings.fileTypes.ext.desc"),
      control: { type: "toggle", key: `ext.${ext}`, defaultValue: owner === undefined },
    };
  });
  const customTypeItems: SettingGroupItem[] = Object.entries(s.customExtensions)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ext, language]) => customTypeRow(deps, ext, language));
  const runnerItems: SettingGroupItem[] = deps.device.get().runners.map((_, i) => runnerRow(deps, i));

  const palettesOn = () => deps.settings().customPalettes;
  const languagesOn = () => deps.settings().customLanguages;
  const dictionariesOn = () => deps.settings().customDictionaries;
  const runOn = () => deps.device.get().runEnabled;

  return [
    {
      type: "group",
      heading: t("settings.language.heading"),
      items: [
        {
          name: t("settings.language.name"),
          desc: t("settings.language.desc"),
          render: (setting: Setting) => {
            const current = deps.localization();
            setting.setName(t("settings.language.name"));
            setting.setDesc(current === null ? t("settings.language.none", { file: `${deps.pluginFolder()}/${LOCALIZATION_FILE}` }) : t("settings.language.inForce", { language: current.name, translated: current.translated, total: current.total }));
            const shell = deps.shell;
            if (shell) {
              setting.addButton((b) =>
                b
                  .setButtonText(t("button.openFolder"))
                  .setTooltip(t("settings.language.openFolder.tooltip"))
                  .onClick(() => void shell.openPath(shell.toAbsolute(deps.pluginFolder())))
              );
            }
            setting.addButton((b) =>
              b
                .setButtonText(t("button.reread"))
                .setTooltip(t("settings.language.reread.tooltip"))
                .onClick(() => void deps.reread().then(() => deps.refresh()))
            );
          },
        },
      ],
    },
    {
      type: "group",
      heading: t("settings.opening.heading"),
      items: [
        {
          name: t("settings.opening.initialMode.name"),
          desc: t("settings.opening.initialMode.desc"),
          control: {
            type: "dropdown",
            key: "shared.initialMode",
            options: { preview: t("settings.opening.initialMode.preview"), edit: t("settings.opening.initialMode.edit"), remember: t("settings.opening.initialMode.remember") },
          },
        },
        {
          name: t("settings.opening.largeFile.name"),
          desc: t("settings.opening.largeFile.desc"),
          control: { type: "number", key: "device.largeFileMb", min: 0, step: 1 },
        },
      ],
    },
    {
      type: "group",
      heading: t("settings.editor.heading"),
      items: [
        { name: t("settings.editor.lineNumbers.name"), control: { type: "toggle", key: "shared.lineNumbers" } },
        { name: t("settings.editor.wordWrap.name"), control: { type: "toggle", key: "shared.wordWrap" } },
        {
          name: t("settings.editor.direction.name"),
          desc: t("settings.editor.direction.desc"),
          control: { type: "dropdown", key: "shared.textDirection", options: { auto: t("settings.editor.direction.auto"), ltr: t("settings.editor.direction.ltr"), rtl: t("settings.editor.direction.rtl") } },
        },
        {
          name: t("settings.editor.dateFormat.name"),
          desc: t("settings.editor.dateFormat.desc"),
          control: { type: "text", key: "shared.dateFormat", placeholder: "YYYY-MM-DD" },
        },
        {
          name: t("settings.editor.timeFormat.name"),
          desc: t("settings.editor.timeFormat.desc"),
          control: { type: "text", key: "shared.timeFormat", placeholder: "HH:mm:ss" },
        },
        { name: t("settings.editor.searchHints.name"), desc: t("settings.editor.searchHints.desc"), control: { type: "toggle", key: "shared.searchHints" } },
        { name: t("settings.editor.invisibles.name"), desc: t("settings.editor.invisibles.desc"), control: { type: "toggle", key: "shared.showInvisibles" } },
        { name: t("settings.editor.tabSize.name"), control: { type: "number", key: "shared.tabSize", min: 1, max: 16, step: 1 } },
        { name: t("settings.editor.tabSpaces.name"), control: { type: "toggle", key: "shared.tabInsertsSpaces" } },
      ],
    },
    // The guide and the Hotkeys page entry share the Keys group.
    {
      type: "group",
      heading: t("settings.keys.heading"),
      items: [
        {
          name: t("settings.keys.guide.name"),
          desc: t("settings.keys.guide.desc"),
          action: () => deps.regexHelp(),
        },
        // Its own page, as File types is: the row on the main page says how many keys differ from the defaults.
        {
          type: "page",
          name: t("settings.keys.hotkeys.name"),
          desc: t("settings.keys.hotkeys.desc"),
          displayValue: () => {
            const changed = Object.keys(deps.settings().hotkeys[platformOf(Platform)]).length;
            return changed === 0 ? t("settings.keys.hotkeys.defaults") : t("settings.keys.hotkeys.changed", { count: changed });
          },
          // Obsidian's own indicator on the entry when a row inside needs a look: two actions on one key, or a changed key Obsidian holds.
          status: () => (hotkeysNeedAttention(deps) ? "warning" : null),
          items: [
            {
              type: "group",
              heading: t("settings.keys.heading"),
              items: [
                {
                  name: t("settings.keys.howto.name"),
                  desc: t("settings.keys.howto.desc"),
                  render: (setting: Setting) => {
                    setting.setName(t("settings.keys.howto.name"));
                    setting.setDesc(t("settings.keys.howto.desc"));
                  },
                },
                ...HOTKEY_ACTIONS.map((a) => hotkeyRow(deps, a)),
              ],
            },
          ],
        },
      ],
    },
    {
      type: "group",
      heading: t("settings.palettes.heading"),
      items: [
        {
          name: t("settings.palettes.toggle.name"),
          desc: t("settings.palettes.toggle.desc"),
          control: { type: "toggle", key: "shared.customPalettes" },
        },
        {
          ...folderRow(deps, {
            name: t("settings.palettes.folder.name"),
            desc: t("settings.palettes.folder.desc"),
            folder: () => deps.paletteFolder(),
            save: async (vaultPath) => deps.saveSettings({ ...deps.settings(), paletteFolder: vaultPath }),
            exampleLanguages: () => deps.languages(),
            createExample: (language) => deps.createExamplePalette(language),
            examplePlaceholder: t("settings.palettes.example.placeholder"),
          }),
          visible: palettesOn,
        },
      ],
    },
    {
      type: "group",
      heading: t("settings.languages.heading"),
      items: [
        {
          name: t("settings.languages.toggle.name"),
          desc: t("settings.languages.toggle.desc"),
          control: { type: "toggle", key: "shared.customLanguages" },
        },
        {
          ...folderRow(deps, {
            name: t("settings.languages.folder.name"),
            desc: t("settings.languages.folder.desc"),
            folder: () => deps.languageFolder(),
            save: async (vaultPath) => deps.saveSettings({ ...deps.settings(), languageFolder: vaultPath }),
            exampleLanguages: () => deps.tableLanguages(),
            createExample: (language) => deps.createExampleLanguage(language),
            examplePlaceholder: t("settings.languages.example.placeholder"),
          }),
          visible: languagesOn,
        },
      ],
    },
    {
      type: "group",
      heading: t("settings.dictionaries.heading"),
      items: [
        {
          name: t("settings.dictionaries.toggle.name"),
          desc: t("settings.dictionaries.toggle.desc"),
          control: { type: "toggle", key: "shared.customDictionaries" },
        },
        {
          ...folderRow(deps, {
            name: t("settings.dictionaries.folder.name"),
            desc: t("settings.dictionaries.folder.desc"),
            folder: () => deps.dictionaryFolder(),
            save: async (vaultPath) => deps.saveSettings({ ...deps.settings(), dictionaryFolder: vaultPath }),
            exampleLanguages: () => deps.textLanguages(),
            createExample: (language) => deps.createExampleDictionary(language),
            examplePlaceholder: t("settings.dictionaries.example.placeholder"),
          }),
          visible: dictionariesOn,
        },
      ],
    },
    ...(deps.isDesktop()
      ? ([
          {
            type: "group",
            heading: t("settings.run.heading"),
            items: [
              {
                name: t("settings.run.enable.name"),
                desc: t("settings.run.enable.desc"),
                control: { type: "toggle", key: "device.runEnabled" },
              },
              {
                name: t("settings.run.timeout.name"),
                desc: t("settings.run.timeout.desc"),
                control: { type: "number", key: "device.runTimeoutS", min: 1, step: 1 },
                visible: runOn,
              },
              {
                name: t("settings.run.outputCap.name"),
                desc: t("settings.run.outputCap.desc"),
                control: { type: "number", key: "device.runOutputCapKb", min: 1, step: 64 },
                visible: runOn,
              },
              {
                type: "page",
                name: t("settings.run.interpreters.page"),
                desc: t("settings.run.interpreters.desc"),
                visible: runOn,
                displayValue: () => {
                  const count = deps.device.get().runners.length;
                  return count === 0 ? t("settings.run.interpreters.none") : plural(count, "settings.run.interpreters.count.one", "settings.run.interpreters.count.other");
                },
                items: [
                  {
                    type: "group",
                    heading: t("settings.run.interpreters.name"),
                    items: [
                      ...runnerItems.map((item) => ({ ...item, visible: runOn })),
                      {
                        name: t("settings.run.interpreters.add.name"),
                        desc: `${t("settings.run.interpreters.add.desc")}${deps.shell ? "" : t("settings.run.interpreters.add.desktopOnly")}`,
                        action: () => {
                          void (async () => {
                            const taken = new Set(deps.device.get().runners.map((r) => r.language));
                            const language = await deps.pickLanguage(
                              deps.languages().filter((l) => !taken.has(l)),
                              t("settings.run.interpreters.pick.placeholder")
                            );
                            if (language === null) return;
                            const shell = deps.shell;
                            const program = shell ? await shell.pickFile(STANDARD_COMMANDS[language]?.[0] ?? "") : null;
                            if (program === null) return;
                            deps.device.update({ runners: [...deps.device.get().runners, runnerForProgram(language, program)] });
                            deps.refresh();
                          })();
                        },
                        visible: runOn,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ] as SettingDefinitionItem[])
      : []),
    {
      type: "page",
      name: t("settings.fileTypes.heading"),
      desc: t("settings.fileTypes.desc"),
      displayValue: () => t("settings.fileTypes.known.count", { count: registeredExtensions().length }),
      items: [
        {
          type: "list",
          heading: t("settings.fileTypes.custom.heading"),
          emptyState: t("settings.fileTypes.custom.none"),
          items: customTypeItems,
          addItem: {
            name: t("button.add"),
            action: () => {
              void (async () => {
                const ext = await deps.promptText(t("settings.fileTypes.custom.prompt.title"), t("settings.fileTypes.custom.prompt.desc"), "extension");
                if (ext === null || !/^\.?[a-z0-9_+-]+$/i.test(ext)) {
                  if (ext !== null) deps.notice(t("notice.extension.invalid"));
                  return;
                }
                const language = await deps.pickLanguage(deps.languages(), t("settings.fileTypes.custom.pick.placeholder", { ext }));
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
          heading: t("settings.fileTypes.known.heading"),
          items: extensionItems,
        },
      ],
    },
    {
      type: "group",
      heading: t("settings.plugin.heading"),
      items: [
        {
          name: t("settings.plugin.reload.name"),
          desc: t("settings.plugin.reload.desc"),
          action: () => void deps.reloadPlugin(),
        },
        {
          name: t("settings.plugin.reset.name"),
          desc: t("settings.plugin.reset.desc"),
          action: () => {
            void (async () => {
              const runners = deps.device.get().runners.length;
              const yes = await deps.confirm(
                t("settings.plugin.reset.confirm.title"),
                t("settings.plugin.reset.confirm.desc", { interpreters: runners === 0 ? t("settings.plugin.reset.noInterpreters") : plural(runners, "settings.run.interpreters.count.one", "settings.run.interpreters.count.other") }),
                t("settings.plugin.reset.confirm.button")
              );
              if (!yes) return;
              deps.device.reset();
              deps.refresh();
              deps.notice(t("notice.device.reset"));
            })();
          },
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
    case "shared.showInvisibles":
      return s.showInvisibles;
    case "shared.searchHints":
      return s.searchHints;
    case "shared.textDirection":
      return s.textDirection;
    case "shared.dateFormat":
      return s.dateFormat;
    case "shared.timeFormat":
      return s.timeFormat;
    case "shared.tabSize":
      return s.tabSize;
    case "shared.tabInsertsSpaces":
      return s.tabInsertsSpaces;
    case "shared.customPalettes":
      return s.customPalettes;
    case "shared.customLanguages":
      return s.customLanguages;
    case "shared.customDictionaries":
      return s.customDictionaries;
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
      case "shared.showInvisibles":
        if (typeof value === "boolean") s.showInvisibles = value;
        break;
      case "shared.searchHints":
        if (typeof value === "boolean") s.searchHints = value;
        break;
      case "shared.textDirection":
        if (value === "auto" || value === "ltr" || value === "rtl") s.textDirection = value;
        break;
      case "shared.dateFormat":
        if (typeof value === "string") s.dateFormat = value.trim();
        break;
      case "shared.timeFormat":
        if (typeof value === "string") s.timeFormat = value.trim();
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
      case "shared.customDictionaries":
        if (typeof value === "boolean") {
          s.customDictionaries = value;
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
