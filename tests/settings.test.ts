import { describe, expect, it } from "vitest";
import { DEFAULT_LARGE_FILE_BYTES } from "../src/constants";
import { DEFAULT_DEVICE_STATE, DeviceLocalStore, type StorageLike, normalizeDeviceState } from "../src/settings/DeviceLocalStore";
import { Setting, __fakeEl, __fire } from "./mocks/obsidian";
import type { DesktopShell } from "../src/platform/desktopShell";
import { type SettingsTabDeps, buildDefinitions, readSettingValue, writeSettingValue } from "../src/settings/SettingsTab";
import { DEFAULT_SETTINGS, type SharedSettings, normalizeSettings } from "../src/settings/settings";

class MapStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

describe("normalizeSettings", () => {
  it("returns defaults for nothing, garbage and wrong types", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings("x")).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ initialMode: "sometimes", tabSize: 99, lineNumbers: "yes" })).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid values and lower-cases extension keys", () => {
    const s = normalizeSettings({ initialMode: "remember", tabSize: 2, extensions: { TS: true, "bad ext": false, log: false } });
    expect(s.initialMode).toBe("remember");
    expect(s.tabSize).toBe(2);
    expect(s.extensions).toEqual({ ts: true, log: false });
  });
});

describe("DeviceLocalStore", () => {
  it("scopes the key by vault and survives a round trip", () => {
    const storage = new MapStorage();
    const a = new DeviceLocalStore("vault-1", storage);
    a.rememberMode("x.txt", "edit");
    a.update({ largeFileBytes: 42 });
    expect([...storage.map.keys()]).toEqual(["native-file-editor:vault-1"]);
    const again = new DeviceLocalStore("vault-1", storage);
    expect(again.get().lastMode).toEqual({ "x.txt": "edit" });
    expect(again.get().largeFileBytes).toBe(42);
    expect(new DeviceLocalStore("vault-2", storage).get().largeFileBytes).toBe(DEFAULT_LARGE_FILE_BYTES);
  });

  it("works with no storage at all", () => {
    const s = new DeviceLocalStore("v", null);
    s.rememberMode("a", "preview");
    expect(s.get().lastMode).toEqual({ a: "preview" });
  });

  it("drops the oldest remembered files past the cap", () => {
    const s = new DeviceLocalStore("v", new MapStorage());
    for (let i = 0; i < 505; i++) s.rememberMode(`f${i}`, "edit");
    const keys = Object.keys(s.get().lastMode);
    expect(keys).toHaveLength(500);
    expect(keys[0]).toBe("f5");
    expect(keys[499]).toBe("f504");
  });

  it("normalizes garbage from storage", () => {
    expect(normalizeDeviceState({ lastMode: { a: "nope", b: "edit" }, largeFileBytes: -1, lastNewFileExtension: "../x", runTimeoutMs: 5, runners: "no", runPanelOpen: { x: true, y: false } })).toEqual({
      ...DEFAULT_DEVICE_STATE,
      lastMode: { b: "edit" },
      runPanelOpen: { x: true },
    });
    // A present runner list is the user's, even when empty; an absent one is the defaults.
    expect(normalizeDeviceState({ runners: [] }).runners).toEqual([]);
    expect(normalizeDeviceState({}).runners.length).toBeGreaterThan(20);
  });
});

describe("settings tab definitions", () => {
  let desktop = true;
  let shellPresent = true;

  function harness(initial: SharedSettings = DEFAULT_SETTINGS, owned: Record<string, string> = {}) {
    let current = initial;
    const actions: string[] = [];
    const notices: string[] = [];
    const device = new DeviceLocalStore("v", new MapStorage());
    const dialogs = { folder: null as string | null, file: null as string | null, language: null as string | null, text: null as string | null };
    const shell: DesktopShell = {
      openPath: async (p) => (actions.push(`open ${p}`), null),
      pickFolder: async () => dialogs.folder,
      pickFile: async () => dialogs.file,
      toVaultPath: (abs) => (abs.startsWith("/vault/") ? abs.slice(7) : null),
      toAbsolute: (v) => `/vault/${v}`,
    };
    const deps: SettingsTabDeps = {
      settings: () => current,
      saveSettings: async (n: SharedSettings) => void (current = n),
      device,
      ownedElsewhere: () => owned,
      paletteFolder: () => ".obsidian/plugins/native-file-editor/palettes",
      languageFolder: () => ".obsidian/plugins/native-file-editor/languages",
      shell: shellPresent ? shell : null,
      ensureFolder: async (p) => void actions.push(`mkdir ${p}`),
      languages: () => ["Python", "JavaScript", "Batch"],
      tableLanguages: () => ["Batch"],
      pickLanguage: async () => dialogs.language,
      promptText: async () => dialogs.text,
      reread: async () => void actions.push("reread"),
      createExamplePalette: async (l) => void actions.push(`palette ${l}`),
      createExampleLanguage: async (l) => void actions.push(`language ${l}`),
      reloadPlugin: async () => void actions.push("reload"),
      isDesktop: () => desktop,
      notice: (m: string) => void notices.push(m),
      refresh: () => void actions.push("refresh"),
    };
    return { deps, device, current: () => current, actions, notices, dialogs };
  }

  function controlKeys(items: unknown[]): string[] {
    const out: string[] = [];
    const walk = (list: unknown[]) => {
      for (const it of list as Array<Record<string, unknown>>) {
        const control = it.control as { key?: string } | undefined;
        if (control?.key) out.push(control.key);
        if (Array.isArray(it.items)) walk(it.items);
      }
    };
    walk(items);
    return out;
  }

  /** Every item (recursively) with a `render`, rendered into a fresh Setting. */
  function renderRows(items: unknown[]): Array<{ name: string; setting: Setting }> {
    const out: Array<{ name: string; setting: Setting }> = [];
    const walk = (list: unknown[]) => {
      for (const it of list as Array<Record<string, unknown>>) {
        if (typeof it.render === "function") {
          const setting = new Setting(__fakeEl("div"));
          (it.render as (s: Setting) => void)(setting);
          out.push({ name: String(it.name), setting });
        }
        if (Array.isArray(it.items)) walk(it.items);
      }
    };
    walk(items);
    return out;
  }

  /** `visible` of the item with this name, evaluated. */
  function visibleOf(items: unknown[], name: string): boolean | undefined {
    let found: boolean | undefined;
    const walk = (list: unknown[]) => {
      for (const it of list as Array<Record<string, unknown>>) {
        if (it.name === name || it.heading === name) {
          const v = it.visible;
          found = typeof v === "function" ? (v as () => boolean)() : (v as boolean | undefined) ?? true;
        }
        if (Array.isArray(it.items)) walk(it.items);
      }
    };
    walk(items);
    return found;
  }

  const tick = () => new Promise<void>((r) => setTimeout(r, 0));

  it("every control key resolves to a value and accepts a write", async () => {
    const h = harness();
    const keys = controlKeys(buildDefinitions(h.deps));
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(readSettingValue(key, h.deps), key).not.toBeUndefined();
    }
    await writeSettingValue("shared.tabSize", 8, h.deps);
    await writeSettingValue("shared.initialMode", "edit", h.deps);
    await writeSettingValue("device.largeFileMb", 2, h.deps);
    expect(h.current().tabSize).toBe(8);
    expect(h.current().initialMode).toBe("edit");
    expect(h.device.get().largeFileBytes).toBe(2 * 1024 * 1024);
    expect(readSettingValue("device.largeFileMb", h.deps)).toBe(2);
  });

  it("an extension toggle defaults to on when unowned and off when owned, and its description names the owner", async () => {
    const h = harness(DEFAULT_SETTINGS, { log: "cm-code-editor" });
    expect(readSettingValue("ext.txt", h.deps)).toBe(true);
    expect(readSettingValue("ext.log", h.deps)).toBe(false);
    const defs = JSON.stringify(buildDefinitions(h.deps));
    expect(defs).toContain("Currently opened by cm-code-editor");
    await writeSettingValue("ext.log", true, h.deps);
    expect(h.current().extensions).toEqual({ log: true });
    expect(readSettingValue("ext.log", h.deps)).toBe(true);
  });

  it("the palette and language folder rows hide behind their switches; a switch write rereads and refreshes", async () => {
    const h = harness();
    let defs = buildDefinitions(h.deps);
    expect(visibleOf(defs, "Palette folder")).toBe(false);
    expect(visibleOf(defs, "Language folder")).toBe(false);
    await writeSettingValue("shared.customPalettes", true, h.deps);
    await writeSettingValue("shared.customLanguages", true, h.deps);
    expect(h.current()).toMatchObject({ customPalettes: true, customLanguages: true });
    expect(h.actions).toEqual(["reread", "refresh", "reread", "refresh"]);
    defs = buildDefinitions(h.deps);
    expect(visibleOf(defs, "Palette folder")).toBe(true);
    expect(visibleOf(defs, "Language folder")).toBe(true);
  });

  it("a folder row has open, change, reread and create-example buttons on the desktop; open creates the folder first", async () => {
    const h = harness({ ...DEFAULT_SETTINGS, customPalettes: true, customLanguages: true });
    const rows = renderRows(buildDefinitions(h.deps));
    const palette = rows.find((r) => r.name === "Palette folder")?.setting;
    if (!palette) throw new Error("no palette row");
    expect(palette.descText.startsWith(".obsidian/plugins/native-file-editor/palettes.")).toBe(true);
    expect(palette.buttons.map((b) => b.icon || b.text)).toEqual(["folder-open", "folder-input", "Reread", "Create example…"]);
    palette.__click("Open the folder");
    await tick();
    expect(h.actions).toEqual(["mkdir .obsidian/plugins/native-file-editor/palettes", "open /vault/.obsidian/plugins/native-file-editor/palettes"]);
    // Change: a folder inside the vault is saved; one outside is refused.
    h.actions.length = 0;
    h.dialogs.folder = "/elsewhere/p";
    palette.__click("Choose another folder");
    await tick();
    expect(h.notices[0]).toMatch(/inside the vault/);
    expect(h.current().paletteFolder).toBe("");
    h.dialogs.folder = "/vault/Palettes";
    palette.__click("Choose another folder");
    await tick();
    expect(h.current().paletteFolder).toBe("Palettes");
    expect(h.actions).toEqual(["reread", "refresh"]);
    // Create example: picks a language, writes, rereads.
    h.actions.length = 0;
    h.dialogs.language = "Python";
    palette.__click("Create example");
    await tick();
    expect(h.actions).toEqual(["mkdir .obsidian/plugins/native-file-editor/palettes", "palette Python", "reread", "refresh"]);
    // The language row offers only table-driven languages for its example.
    const language = rows.find((r) => r.name === "Language folder")?.setting;
    h.actions.length = 0;
    h.dialogs.language = "Batch";
    language?.__click("Create example");
    await tick();
    expect(h.actions).toEqual(["mkdir .obsidian/plugins/native-file-editor/languages", "language Batch", "reread", "refresh"]);
    // Reread alone.
    h.actions.length = 0;
    language?.__click("Reread");
    await tick();
    expect(h.actions).toEqual(["reread", "refresh"]);
  });

  it("without a desktop shell the folder rows keep Reread and Create example only", () => {
    shellPresent = false;
    const h = harness({ ...DEFAULT_SETTINGS, customPalettes: true });
    const rows = renderRows(buildDefinitions(h.deps));
    const palette = rows.find((r) => r.name === "Palette folder")?.setting;
    expect(palette?.buttons.map((b) => b.text)).toEqual(["Reread", "Create example…"]);
    shellPresent = true;
  });

  it("the Run group exists on the desktop only; its rows and the interpreter list hide until Run is on", async () => {
    desktop = false;
    expect(JSON.stringify(buildDefinitions(harness().deps))).not.toContain("Enable Run");
    desktop = true;
    const h = harness();
    let defs = buildDefinitions(h.deps);
    expect(JSON.stringify(defs)).toContain("Enable Run");
    expect(visibleOf(defs, "Timeout (seconds)")).toBe(false);
    expect(visibleOf(defs, "Interpreters")).toBe(false);
    expect(readSettingValue("device.runEnabled", h.deps)).toBe(false);
    expect(readSettingValue("device.runTimeoutS", h.deps)).toBe(30);
    expect(readSettingValue("device.runOutputCapKb", h.deps)).toBe(1024);
    await writeSettingValue("device.runEnabled", true, h.deps);
    expect(h.actions).toEqual(["refresh"]);
    defs = buildDefinitions(h.deps);
    expect(visibleOf(defs, "Timeout (seconds)")).toBe(true);
    expect(visibleOf(defs, "Interpreters")).toBe(true);
    await writeSettingValue("device.runTimeoutS", 5, h.deps);
    await writeSettingValue("device.runOutputCapKb", 64, h.deps);
    expect(h.device.get()).toMatchObject({ runEnabled: true, runTimeoutMs: 5000, runOutputCapBytes: 65536 });
  });

  it("interpreter rows show the language and the command line; the folder button swaps the program, the pencil edits the line, add and delete work", async () => {
    const h = harness();
    h.device.update({ runEnabled: true, runners: [{ language: "Python", name: "Python", argv: ["python", "{file}"] }, { language: "JavaScript", name: "Sandbox (Web Worker)", kind: "worker" }] });
    let rows = renderRows(buildDefinitions(h.deps)).filter((r) => r.name === "Python" || r.name === "JavaScript");
    const python = rows[0]?.setting;
    if (!python) throw new Error("no python row");
    expect(python.nameText).toBe("Python");
    expect(python.descText).toBe("Python: python {file}");
    expect(python.buttons.map((b) => b.icon)).toEqual(["folder", "pencil"]);
    const sandbox = rows[1]?.setting;
    expect(sandbox?.descText).toContain("runs inside Obsidian");
    expect(sandbox?.buttons).toEqual([]);
    // The folder button replaces argv[0] with the picked program.
    h.dialogs.file = "C:\\Python312\\python.exe";
    python.__click("Choose the interpreter");
    await tick();
    expect(h.device.get().runners[0]?.argv).toEqual(["C:\\Python312\\python.exe", "{file}"]);
    // The pencil adds a text field with the quoted line; Enter commits the parsed argv.
    rows = renderRows(buildDefinitions(h.deps));
    const row = rows.find((r) => r.name === "Python")?.setting;
    if (!row) throw new Error("no python row");
    row.__click("Edit the command line");
    expect(row.texts).toHaveLength(1);
    expect(row.texts[0]?.value).toBe("C:\\Python312\\python.exe {file}");
    row.texts[0]!.inputEl.value = '"C:\\Python312\\python.exe" -u {file} --flag';
    __fire(row.texts[0]!.inputEl, "keydown", { key: "Enter" });
    expect(h.device.get().runners[0]?.argv).toEqual(["C:\\Python312\\python.exe", "-u", "{file}", "--flag"]);
    // A line without a program is refused.
    row.texts[0]!.inputEl.value = "";
    __fire(row.texts[0]!.inputEl, "keydown", { key: "Enter" });
    expect(h.notices.at(-1)).toMatch(/needs a program/);
    // Add: language, then program.
    const list = buildDefinitions(h.deps).find((d) => "heading" in d && d.heading === "Interpreters") as unknown as { addItem: { action: () => void }; onDelete: (i: number) => void };
    h.dialogs.language = "Batch";
    h.dialogs.file = "/usr/bin/wine";
    list.addItem.action();
    await tick();
    expect(h.device.get().runners.at(-1)).toEqual({ language: "Batch", name: "wine", argv: ["/usr/bin/wine", "{file}"] });
    list.onDelete(0);
    expect(h.device.get().runners.map((r) => r.language)).toEqual(["JavaScript", "Batch"]);
    // Reset brings the defaults back.
    const run = buildDefinitions(h.deps).find((d) => "heading" in d && d.heading === "Run (this device)") as { items: Array<{ name: string; action?: () => void }> };
    run.items.find((i) => i.name.startsWith("Reset"))?.action?.();
    expect(h.device.get().runners.length).toBeGreaterThan(20);
  });

  it("custom file types live on the File types page: add asks for the extension and a language, delete removes, both reread", async () => {
    const h = harness();
    const page = () => buildDefinitions(h.deps).find((d) => "type" in d && d.type === "page") as unknown as { items: Array<Record<string, unknown>> };
    const list = () => page().items[0] as { items: unknown[]; addItem: { action: () => void }; onDelete: (i: number) => void };
    expect(list().items).toEqual([]);
    h.dialogs.text = "xl";
    h.dialogs.language = "Python";
    list().addItem.action();
    await tick();
    expect(h.current().customExtensions).toEqual({ xl: "Python" });
    expect(h.actions).toEqual(["reread", "refresh"]);
    const rows = renderRows(page().items);
    expect(rows.map((r) => [r.name, r.setting.descText])).toEqual([[".xl", "Opens as Python. Applied at once and at every start."]]);
    h.dialogs.text = "bad ext";
    list().addItem.action();
    await tick();
    expect(h.notices.at(-1)).toMatch(/letters, digits/);
    list().onDelete(0);
    await tick();
    expect(h.current().customExtensions).toEqual({});
  });

  it("the Reload plugin row calls back", () => {
    const h = harness();
    const group = buildDefinitions(h.deps).find((d) => "heading" in d && d.heading === "Plugin") as { items: Array<{ action?: () => void }> };
    group.items[0]?.action?.();
    expect(h.actions).toEqual(["reload"]);
  });

  it("rejects out-of-range and wrong-typed writes without saving", async () => {
    const h = harness();
    await writeSettingValue("shared.tabSize", 99, h.deps);
    await writeSettingValue("shared.lineNumbers", "yes", h.deps);
    await writeSettingValue("device.largeFileMb", -5, h.deps);
    expect(h.current()).toEqual(DEFAULT_SETTINGS);
    expect(h.device.get().largeFileBytes).toBe(DEFAULT_LARGE_FILE_BYTES);
  });
});
