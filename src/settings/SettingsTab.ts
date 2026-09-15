import { type App, Platform, type Plugin, PluginSettingTab, type Setting, type SettingDefinitionItem, type SettingGroupItem } from "obsidian";
import { type Chord, HOTKEY_ACTIONS, type HotkeyAction, type HotkeyPlatform, chordConflicts, chordFor, chordOfEvent, chordText, defaultChord, describeChord, platformOf } from "../core/hotkeys";
import { registeredExtensions } from "../highlight/registry";
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
            .setButtonText("Choose folder…")
            .setTooltip("Pick the folder in the file explorer; the current one is created first and opened")
            .onClick(() => {
              void (async () => {
                const current = opts.folder();
                await deps.ensureFolder(current);
                const picked = await shell.pickFolder(shell.toAbsolute(current));
                if (picked === null) return;
                const vaultPath = shell.toVaultPath(picked);
                if (vaultPath === null) {
                  deps.notice("Native File Editor: the folder must be inside the vault.");
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
            .setTooltip("Choose the program (for a compile-then-run language: the compiler, the first step)")
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
          .setTooltip("Edit the command line: the program, then its arguments; {file} is the file's path")
          .onClick(() => {
            if (editing) return;
            editing = true;
            setting.addText((t) => {
              field = t;
              t.setValue(line);
              t.inputEl.addClass("nfe-setting-argv");
              t.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
                if (e.key === "Enter") commit();
              });
              t.inputEl.addEventListener("blur", () => commit());
            });
            field?.inputEl.focus();
          })
      );
      setting.addExtraButton((b) =>
        b
          .setIcon("trash")
          .setTooltip("Remove this interpreter; the language goes back to what the plugin does by itself, if anything")
          .onClick(() => {
            const runners = [...deps.device.get().runners];
            runners.splice(index, 1);
            deps.device.update({ runners });
            deps.refresh();
          })
      );
      const commit = () => {
        if (!field) return;
        if (def.steps) {
          const steps = parseStepsLine(field.inputEl.value);
          if (steps.length === 0 || steps.some((s) => (s[0] ?? "").includes("{file}"))) {
            deps.notice("Native File Editor: each step needs a program first, then its arguments; steps are separated by &&.");
            return;
          }
          save({ ...def, steps });
        } else {
          const argv = parseArgvLine(field.inputEl.value);
          if (argv.length === 0 || (argv[0] ?? "").includes("{file}")) {
            deps.notice("Native File Editor: the command line needs a program first, then its arguments.");
            return;
          }
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
    desc: `opens as ${language}`,
    render: (setting: Setting) => {
      setting.setName(`.${ext}`);
      setting.setDesc(`Opens as ${language}. Applied at once and at every start.`);
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
    name: action.name,
    desc: describeChord(current(), mac),
    render: (setting: Setting) => {
      setting.setName(action.name);
      // The description is built, not one string: the key as a keycap, the default when changed,
      // a red "already used by …" when another action has the same key, then what the action does.
      const others = takenBy(own(), action.id, platform);
      setting.setDesc("");
      setting.descEl.createSpan({ cls: "nfe-hotkey-key", text: describeChord(current(), mac) });
      if (!isDefault()) setting.descEl.createSpan({ cls: "nfe-hotkey-default", text: ` default ${describeChord(defaultChord(action, platform), mac)}` });
      // Toggled, not added: the declarative tab reuses the row's element across refreshes, and a class
      // added while two rows clashed stayed on after one of them was remapped (seen 2026-09-09).
      setting.settingEl.toggleClass("nfe-hotkey-conflict", others.length > 0);
      if (others.length > 0) setting.descEl.createSpan({ cls: "nfe-hotkey-taken", text: ` already used by ${others.join(", ")} — the first of the two in this list wins` });
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
      if (obsidian.length > 0 && action.where === "editor") setting.descEl.createSpan({ cls, text: ` Obsidian's ${obsidian.join(", ")} takes this key first: inside the text it does not arrive` });
      else if (obsidian.length > 0) setting.descEl.createSpan({ cls, text: ` also Obsidian's ${obsidian.join(", ")}: this pane takes it first while the text has the focus` });
      setting.descEl.createDiv({ cls: "nfe-hotkey-meaning", text: `${action.meaning}${action.where === "editor" ? ". Inside the text: a key Obsidian uses for its own hotkey does not reach it." : ""}` });
      let recording = false;
      setting.addExtraButton((b) =>
        b
          .setIcon("pencil")
          .setTooltip("Change: press the new key combination (Escape cancels)")
          .onClick(() => {
            if (recording) return;
            recording = true;
            setting.addText((t) => {
              t.setPlaceholder("Press a key…");
              t.inputEl.addClass("nfe-setting-hotkey");
              t.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.key === "Escape") {
                  deps.refresh();
                  return;
                }
                const chord = chordOfEvent(e, mac);
                if (!chord) return;
                t.setValue(describeChord(chord, mac));
                // Taken already: said at once, and saved all the same (the row turns red; Obsidian's own hotkey settings do the same).
                const holders = HOTKEY_ACTIONS.filter((a) => a.id !== action.id && chordText(chordFor(a.id, own(), platform)) === chordText(chord)).map((a) => a.name);
                if (holders.length > 0) deps.notice(`Native File Editor: ${describeChord(chord, mac)} is already used by ${holders.join(", ")}. Both rows keep it; the first in the list wins. Change one of them.`);
                // Obsidian's own hotkey on an editor-bound action: said at once too, and saved all the same (the row shows the warning).
                const obsidian = action.where === "editor" ? deps.obsidianHoldersOf(chord) : [];
                if (obsidian.length > 0) deps.notice(`Native File Editor: ${describeChord(chord, mac)} is Obsidian's ${obsidian.join(", ")}, which runs first: inside the text it will not reach ${action.name}. Saved anyway; change it here or under Obsidian's Hotkeys.`);
                void save(chordText(chord));
              });
              t.inputEl.focus();
            });
          })
      );
      if (!isDefault()) {
        setting.addExtraButton((b) =>
          b
            .setIcon("rotate-ccw")
            .setTooltip(`Back to the default, ${describeChord(defaultChord(action, platform), mac)}`)
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
  return conflict ? conflict.filter((other) => other !== id).map((other) => HOTKEY_ACTIONS.find((a) => a.id === other)?.name ?? other) : [];
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
        {
          name: "Text direction",
          desc: "Auto reads each line by its first letter (an Arabic or Hebrew line runs right to left, the rest left to right); the two others force the whole document. Also in the pane's menu.",
          control: { type: "dropdown", key: "shared.textDirection", options: { auto: "Auto, per line", ltr: "Left to right", rtl: "Right to left" } },
        },
        {
          name: "Date format",
          desc: "What Insert ▸ Date in the text's context menu writes, in the moment.js syntax Obsidian's Templates plugin uses (YYYY, MM, DD, dddd, MMMM …). Empty: the Templates plugin's own format if it has one, else YYYY-MM-DD.",
          control: { type: "text", key: "shared.dateFormat", placeholder: "YYYY-MM-DD" },
        },
        {
          name: "Time format",
          desc: "The time part of Insert ▸ Date and time (HH:mm:ss, HH:mm, h:mm A …). Empty: the Templates plugin's own format if it has one, else HH:mm:ss.",
          control: { type: "text", key: "shared.timeFormat", placeholder: "HH:mm:ss" },
        },
        { name: "Shortcut hints on search buttons", desc: "\"Next (F3)\", \"Previous (Shift+F3)\" and so on in the search panel. Off shows the plain words; the tooltips keep the shortcuts.", control: { type: "toggle", key: "shared.searchHints" } },
        { name: "Show invisibles", desc: "Spaces as dots, tabs as arrows and a line-ending badge at the end of every line. Also in the pane's header and its menu.", control: { type: "toggle", key: "shared.showInvisibles" } },
        { name: "Tab size", control: { type: "number", key: "shared.tabSize", min: 1, max: 16, step: 1 } },
        { name: "Tab inserts spaces", control: { type: "toggle", key: "shared.tabInsertsSpaces" } },
      ],
    },
    // The guide's row stands next to the Hotkeys page it describes, in a group of its own.
    {
      type: "group",
      heading: "Keys",
      items: [
        {
          name: "Keys and regular expressions",
          desc: "Every key the editor answers to, and what the .* switch in the search panel understands, with the searches people reach for. The same guide is behind the ? in the pane's head bar.",
          action: () => deps.regexHelp(),
        },
      ],
    },
    // Its own page, as File types is: the row on the main page says how many keys differ from the defaults.
    {
      type: "page",
      name: "Hotkeys",
      desc: "Every key this plugin takes, and your changes to them. Defaults and changes are per platform (Windows and Linux, macOS), so a remap here does not land on another kind of machine. The guide behind the ? in the pane's head bar shows the same keys.",
      displayValue: () => {
        const changed = Object.keys(deps.settings().hotkeys[platformOf(Platform)]).length;
        return changed === 0 ? "defaults" : `${changed} changed`;
      },
      // Obsidian's own indicator on the entry when a row inside needs a look: two actions on one key, or a changed key Obsidian holds.
      status: () => (hotkeysNeedAttention(deps) ? "warning" : null),
      items: [
        {
          type: "group",
          heading: "Keys",
          items: [
            {
              name: "How to change one",
              desc: "The pencil records the next key combination you press for that row (Escape cancels); the arrow puts the default back. A change applies to panes opened afterwards. Keys that act inside the text (cursors, lines, block comment) cannot take a combination Obsidian keeps for itself; such a row shows the holder in the warning colour.",
              render: (setting: Setting) => {
                setting.setName("How to change one");
                setting.setDesc("The pencil records the next key combination you press for that row (Escape cancels); the arrow puts the default back. A change applies to panes opened afterwards. Keys that act inside the text (cursors, lines, block comment) cannot take a combination Obsidian keeps for itself; such a row shows the holder in the warning colour.");
              },
            },
            ...HOTKEY_ACTIONS.map((a) => hotkeyRow(deps, a)),
          ],
        },
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
                desc: "Adds a Run button to the head bar and the commands Run file and Stop run. JavaScript runs in a sandbox inside Obsidian and web pages render inside Obsidian; any other language runs through an interpreter you add below, on this device, with your permissions, only when you press Run. Off by default; nothing ever runs on its own.",
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
              ...runnerItems.map((item) => ({ ...item, visible: runOn })),
              {
                name: "Add interpreter…",
                desc: `One per language: pick the language, then the program that runs its files. The program replaces what the plugin does by itself for that language (the JavaScript sandbox, the page view). Languages that already have an interpreter are not offered.${deps.shell ? "" : " Needs the desktop app."}`,
                action: () => {
                  void (async () => {
                    const taken = new Set(deps.device.get().runners.map((r) => r.language));
                    const language = await deps.pickLanguage(
                      deps.languages().filter((l) => !taken.has(l)),
                      "Language to run"
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
          desc: "Disable and enable Native File Editor: applies file-type changes and rereads everything. The settings window closes and reopens here.",
          action: () => void deps.reloadPlugin(),
        },
        {
          name: "Reset this device's settings",
          desc: "Forgets what is stored for this device in Obsidian's local storage, which a reinstall does not touch: the interpreters, the Run switch and limits, the large-file limit, remembered modes. Shared settings in data.json stay.",
          action: () => {
            deps.device.reset();
            deps.refresh();
            deps.notice("Native File Editor: device settings reset.");
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
