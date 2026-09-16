import { describe, expect, it } from "vitest";
import { DEFAULT_LARGE_FILE_BYTES } from "../src/constants";
import { chordText } from "../src/core/hotkeys";
import { DEFAULT_DEVICE_STATE, DeviceLocalStore, type StorageLike, normalizeDeviceState } from "../src/settings/DeviceLocalStore";
import { Setting, __fakeEl, __findAllByClass, __fire, __textOf } from "./mocks/obsidian";
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
    // The interpreter list starts empty and stays whatever the user added; a stored list without version 2 was the old bundled defaults and is dropped.
    expect(normalizeDeviceState({}).runners).toEqual([]);
    expect(normalizeDeviceState({ runners: [{ language: "Python", name: "p", argv: ["python", "{file}"] }] }).runners).toEqual([]);
    expect(normalizeDeviceState({ version: 2, runners: [{ language: "Python", name: "p", argv: ["python", "{file}"] }] }).runners).toHaveLength(1);
    expect(normalizeDeviceState({}).version).toBe(2);
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
    const dialogs = { folder: null as string | null, file: null as string | null, language: null as string | null, text: null as string | null, confirm: true, asked: [] as string[] };
    /** What Obsidian would say holds a chord (`Ctrl+B` → ["Toggle bold"]); empty by default. */
    const obsidianKeys: Record<string, string[]> = {};
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
      confirm: async (title, description, button) => (dialogs.asked.push(`${title} | ${description} | ${button}`), dialogs.confirm),
      reread: async () => void actions.push("reread"),
      createExamplePalette: async (l) => void actions.push(`palette ${l}`),
      createExampleLanguage: async (l) => void actions.push(`language ${l}`),
      reloadPlugin: async () => void actions.push("reload"),
      regexHelp: () => void actions.push("regex-help"),
      obsidianHoldersOf: (chord) => (obsidianKeys[chordText(chord)] ?? []),
      isDesktop: () => desktop,
      notice: (m: string) => void notices.push(m),
      refresh: () => void actions.push("refresh"),
    };
    return { deps, device, current: () => current, actions, notices, dialogs, obsidianKeys };
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

  it("a folder row has choose, reread and create-example buttons on the desktop; choose creates the current folder first and opens the dialog there", async () => {
    const h = harness({ ...DEFAULT_SETTINGS, customPalettes: true, customLanguages: true });
    const rows = renderRows(buildDefinitions(h.deps));
    const palette = rows.find((r) => r.name === "Palette folder")?.setting;
    if (!palette) throw new Error("no palette row");
    expect(palette.descText.startsWith(".obsidian/plugins/native-file-editor/palettes.")).toBe(true);
    expect(palette.buttons.map((b) => b.text)).toEqual(["Choose folder…", "Reread", "Create example…"]);
    // Cancelled: the folder was still created, nothing else happens.
    h.dialogs.folder = null;
    palette.__click("Choose folder");
    await tick();
    expect(h.actions).toEqual(["mkdir .obsidian/plugins/native-file-editor/palettes"]);
    // A folder outside the vault is refused.
    h.actions.length = 0;
    h.dialogs.folder = "/elsewhere/p";
    palette.__click("Choose folder");
    await tick();
    expect(h.notices[0]).toMatch(/inside the vault/);
    expect(h.current().paletteFolder).toBe("");
    // One inside is saved and reread.
    h.actions.length = 0;
    h.dialogs.folder = "/vault/Palettes";
    palette.__click("Choose folder");
    await tick();
    expect(h.current().paletteFolder).toBe("Palettes");
    expect(h.actions).toEqual(["mkdir .obsidian/plugins/native-file-editor/palettes", "reread", "refresh"]);
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

  it("the Run group exists on the desktop only; its rows hide until Run is on; there is no interpreter until one is added", async () => {
    desktop = false;
    expect(JSON.stringify(buildDefinitions(harness().deps))).not.toContain("Enable Run");
    desktop = true;
    const h = harness();
    let defs = buildDefinitions(h.deps);
    expect(JSON.stringify(defs)).toContain("Enable Run");
    expect(JSON.stringify(defs)).not.toContain("Interpreters");
    expect(JSON.stringify(defs)).not.toContain("Reset interpreters");
    expect(visibleOf(defs, "Timeout (seconds)")).toBe(false);
    expect(visibleOf(defs, "Add interpreter…")).toBe(false);
    expect(h.device.get().runners).toEqual([]);
    await writeSettingValue("device.runEnabled", true, h.deps);
    expect(h.actions).toEqual(["refresh"]);
    defs = buildDefinitions(h.deps);
    expect(visibleOf(defs, "Timeout (seconds)")).toBe(true);
    expect(visibleOf(defs, "Add interpreter…")).toBe(true);
    const run = defs.find((d) => "heading" in d && d.heading === "Run (this device)") as { items: Array<{ name: string }> };
    expect(run.items.map((i) => i.name)).toEqual(["Enable Run", "Timeout (seconds)", "Output limit (KB)", "Add interpreter…"]);
    await writeSettingValue("device.runTimeoutS", 5, h.deps);
    await writeSettingValue("device.runOutputCapKb", 64, h.deps);
    expect(h.device.get()).toMatchObject({ runEnabled: true, runTimeoutMs: 5000, runOutputCapBytes: 65536 });
  });

  it("Add offers only languages without an interpreter, then the program; rows sit at the bottom of the Run group with folder, pencil and trash", async () => {
    const h = harness();
    h.device.update({ runEnabled: true, runners: [{ language: "Python", name: "python", argv: ["python", "{file}"] }] });
    const runGroup = () => buildDefinitions(h.deps).find((d) => "heading" in d && d.heading === "Run (this device)") as { items: Array<{ name: string; action?: () => void }> };
    expect(runGroup().items.map((i) => i.name)).toEqual(["Enable Run", "Timeout (seconds)", "Output limit (KB)", "Python", "Add interpreter…"]);
    // The picker's list excludes Python; the standard command's arguments follow the picked program.
    let offered: string[] = [];
    h.deps = { ...h.deps, pickLanguage: async (languages) => ((offered = languages), h.dialogs.language) };
    h.dialogs.language = "JavaScript";
    h.dialogs.file = "C:\\nodejs\\node.exe";
    runGroup().items.find((i) => i.name === "Add interpreter…")?.action?.();
    await tick();
    expect(offered).toEqual(["JavaScript", "Batch"]);
    expect(h.device.get().runners.at(-1)).toEqual({ language: "JavaScript", name: "node", argv: ["C:\\nodejs\\node.exe", "{file}"] });
    // A language with a standard command gets its arguments; a compile-then-run language gets its steps around the compiler.
    h.dialogs.language = "Batch";
    h.dialogs.file = "/usr/bin/wine";
    runGroup().items.find((i) => i.name === "Add interpreter…")?.action?.();
    await tick();
    expect(h.device.get().runners.at(-1)).toEqual({ language: "Batch", name: "wine", argv: ["/usr/bin/wine", "/c", "{file}"] });
    h.dialogs.language = "Rust";
    h.dialogs.file = "C:\\rust\\rustc.exe";
    runGroup().items.find((i) => i.name === "Add interpreter…")?.action?.();
    await tick();
    expect(h.device.get().runners.at(-1)).toEqual({ language: "Rust", name: "rustc", steps: [["C:\\rust\\rustc.exe", "{file}", "-o", "{tmp}/{stem}"], ["{tmp}/{stem}"]] });
    // A steps row shows ` && `, its folder button swaps the compiler, its pencil edits every step.
    const rust = renderRows(buildDefinitions(h.deps)).find((r) => r.name === "Rust")!.setting;
    expect(rust.descText).toBe("C:\\rust\\rustc.exe {file} -o {tmp}/{stem} && {tmp}/{stem}");
    expect(rust.buttons.map((b) => b.icon)).toEqual(["folder", "pencil", "trash"]);
    h.dialogs.file = "/opt/rustc";
    rust.__click("Choose the program");
    await tick();
    expect(h.device.get().runners.at(-1)?.steps?.[0]?.[0]).toBe("/opt/rustc");
    const rust2 = renderRows(buildDefinitions(h.deps)).find((r) => r.name === "Rust")!.setting;
    rust2.__click("Edit the command line");
    rust2.texts[0]!.inputEl.value = "/opt/rustc -O {file} -o {tmp}/{stem} && {tmp}/{stem} --fast";
    __fire(rust2.texts[0]!.inputEl, "keydown", { key: "Enter" });
    expect(h.device.get().runners.at(-1)?.steps).toEqual([["/opt/rustc", "-O", "{file}", "-o", "{tmp}/{stem}"], ["{tmp}/{stem}", "--fast"]]);
    rust2.__click("Remove this interpreter");
    // Rows: name, line, buttons; the folder button swaps the program, the pencil edits, the trash removes.
    let rows = renderRows(buildDefinitions(h.deps)).filter((r) => ["Python", "JavaScript", "Batch"].includes(r.name));
    expect(rows.map((r) => r.name)).toEqual(["Python", "JavaScript", "Batch"]);
    const python = rows[0]!.setting;
    expect(python.descText).toBe("python {file}");
    expect(python.buttons.map((b) => b.icon)).toEqual(["folder", "pencil", "trash"]);
    h.dialogs.file = "C:\\Python312\\python.exe";
    python.__click("Choose the program");
    await tick();
    expect(h.device.get().runners[0]?.argv).toEqual(["C:\\Python312\\python.exe", "{file}"]);
    rows = renderRows(buildDefinitions(h.deps));
    const row = rows.find((r) => r.name === "Python")!.setting;
    row.__click("Edit the command line");
    expect(row.texts[0]?.value).toBe("C:\\Python312\\python.exe {file}");
    row.texts[0]!.inputEl.value = '"C:\\Python312\\python.exe" -u {file} --flag';
    __fire(row.texts[0]!.inputEl, "keydown", { key: "Enter" });
    expect(h.device.get().runners[0]?.argv).toEqual(["C:\\Python312\\python.exe", "-u", "{file}", "--flag"]);
    // A saved line is done with: the row is re-rendered, the old field is dead.
    const notices0 = h.notices.length;
    __fire(row.texts[0]!.inputEl, "blur", {});
    expect(h.notices.length).toBe(notices0);
    const row2 = renderRows(buildDefinitions(h.deps)).find((r) => r.name === "Python")!.setting;
    row2.__click("Edit the command line");
    row2.texts[0]!.inputEl.value = "";
    __fire(row2.texts[0]!.inputEl, "keydown", { key: "Enter" });
    expect(h.notices.at(-1)).toMatch(/needs a program first, then its arguments\.$/);
    // Enter on a bad line keeps the field; leaving it puts the saved line back, once, and Escape cancels outright (2026-09-16: an emptied field had no way out).
    expect(row2.texts[0]!.inputEl.parent).not.toBeNull();
    __fire(row2.texts[0]!.inputEl, "blur", {});
    expect(h.notices.at(-1)).toMatch(/Kept: C:\\Python312\\python\.exe -u \{file\} --flag$/);
    expect(row2.texts[0]!.inputEl.parent).toBeNull();
    expect(h.device.get().runners[0]?.argv).toEqual(["C:\\Python312\\python.exe", "-u", "{file}", "--flag"]);
    const notices = h.notices.length;
    __fire(row2.texts[0]!.inputEl, "blur", {});
    expect(h.notices.length).toBe(notices);
    row2.__click("Edit the command line");
    expect(row2.texts).toHaveLength(2);
    row2.texts[1]!.inputEl.value = "garbage {file}";
    __fire(row2.texts[1]!.inputEl, "keydown", { key: "Escape" });
    expect(row2.texts[1]!.inputEl.parent).toBeNull();
    expect(h.notices.length).toBe(notices);
    expect(h.device.get().runners[0]?.argv).toEqual(["C:\\Python312\\python.exe", "-u", "{file}", "--flag"]);
    // The pencil opens again after a cancel.
    row2.__click("Edit the command line");
    expect(row2.texts).toHaveLength(3);
    renderRows(buildDefinitions(h.deps)).find((r) => r.name === "JavaScript")!.setting.__click("Remove this interpreter");
    expect(h.device.get().runners.map((r) => r.language)).toEqual(["Python", "Batch"]);
  });

  it("hotkeys live on their own page: a row per action with its key, a recorder that saves the next chord, a reset, and the conflict named", async () => {
    const h = harness();
    const page = () => buildDefinitions(h.deps).find((d) => "type" in d && d.type === "page" && (d as { name?: string }).name === "Hotkeys") as unknown as { displayValue: () => string; items: Array<{ items: unknown[] }> };
    expect(page().displayValue()).toBe("defaults");
    let rows = renderRows(page().items[0]!.items as never);
    const descOf = (r: { setting: Setting }) => __textOf(r.setting.descEl);
    const above = rows.find((r) => r.name === "Add cursor above")!;
    expect(descOf(above)).toContain("Ctrl+Alt+↑");
    expect(descOf(above)).toContain("does not reach it");
    expect(above.setting.settingEl.hasClass("nfe-hotkey-conflict")).toBe(false);
    // The pencil opens the recorder; the next key pressed becomes the chord and is saved.
    above.setting.__click("Change: press");
    const field = above.setting.texts[0]!;
    __fire(field.inputEl, "keydown", { code: "ArrowUp", key: "ArrowUp", altKey: true, shiftKey: true, ctrlKey: false, metaKey: false });
    await tick();
    expect(h.current().hotkeys).toEqual({ win: { "add-cursor-above": "Shift+Alt+ArrowUp" }, mac: {}, linux: {} });
    expect(page().displayValue()).toBe("1 changed");
    // Taken by Copy line up: a notice at once, and both rows marked as a conflict with the other named.
    expect(h.notices.at(-1)).toBe("Native File Editor: Shift+Alt+↑ is already used by Copy line up. Both rows keep it; the first in the list wins. Change one of them.");
    rows = renderRows(page().items[0]!.items as never);
    const changed = rows.find((r) => r.name === "Add cursor above")!;
    expect(descOf(changed)).toContain("Shift+Alt+↑");
    expect(descOf(changed)).toContain("default Ctrl+Alt+↑");
    expect(descOf(changed)).toContain("already used by Copy line up");
    expect(changed.setting.settingEl.hasClass("nfe-hotkey-conflict")).toBe(true);
    const copyUp = rows.find((r) => r.name === "Copy line up")!;
    expect(descOf(copyUp)).toContain("already used by Add cursor above");
    expect(copyUp.setting.settingEl.hasClass("nfe-hotkey-conflict")).toBe(true);
    // The row's element is reused across refreshes: rendered again into the SAME Setting after the clash is gone, the class goes too (2026-09-09: two rows stayed red without a conflict).
    await h.deps.saveSettings({ ...h.current(), hotkeys: { ...h.current().hotkeys, win: { ...h.current().hotkeys.win, "copy-line-up": "Ctrl+ArrowUp" } } });
    const copyUpItem = (page().items[0]!.items as Array<{ name: string; render: (s: Setting) => void }>).find((i) => i.name === "Copy line up")!;
    copyUpItem.render(copyUp.setting);
    expect(copyUp.setting.settingEl.hasClass("nfe-hotkey-conflict")).toBe(false);
    expect(descOf(copyUp)).not.toContain("already used");
    expect(descOf(copyUp)).toContain("Ctrl+↑");
    // The reset arrow appears on a changed row; it removes the override.
    expect(changed.setting.buttons).toHaveLength(2);
    changed.setting.__click("Back to the default");
    await tick();
    expect(h.current().hotkeys).toEqual({ win: { "copy-line-up": "Ctrl+ArrowUp" }, mac: {}, linux: {} });
  });

  it("an editor-bound action on a key Obsidian holds shows the holder as a warning, at recording time and on the row; a Scope-bound one does not", async () => {
    const h = harness();
    h.obsidianKeys["Ctrl+B"] = ["Toggle bold"];
    const page = () => buildDefinitions(h.deps).find((d) => "type" in d && d.type === "page" && (d as { name?: string }).name === "Hotkeys") as unknown as { items: Array<{ items: unknown[] }> };
    let rows = renderRows(page().items[0]!.items as never);
    const descOf = (r: { setting: Setting }) => __textOf(r.setting.descEl);
    // Add cursor above (inside the text) onto Ctrl+B: Obsidian's bold runs first, so the row says so in the warning colour and the notice too; saved all the same.
    const above = rows.find((r) => r.name === "Add cursor above")!;
    above.setting.__click("Change: press");
    __fire(above.setting.texts[0]!.inputEl, "keydown", { code: "KeyB", key: "b", altKey: false, shiftKey: false, ctrlKey: true, metaKey: false });
    await tick();
    expect(h.current().hotkeys.win).toEqual({ "add-cursor-above": "Ctrl+B" });
    expect(h.notices.at(-1)).toBe("Native File Editor: Ctrl+B is Obsidian's Toggle bold, which runs first: inside the text it will not reach Add cursor above. Saved anyway; change it here or under Obsidian's Hotkeys.");
    rows = renderRows(page().items[0]!.items as never);
    const changed = rows.find((r) => r.name === "Add cursor above")!;
    expect(changed.setting.settingEl.hasClass("nfe-hotkey-conflict")).toBe(false);
    expect(descOf(changed)).toContain("Obsidian's Toggle bold takes this key first");
    expect(__findAllByClass(changed.setting.descEl, "nfe-hotkey-obsidian")).toHaveLength(1);
    // Search (the pane's Scope, ahead of Obsidian) onto Ctrl+B: allowed, no warning.
    const search = rows.find((r) => r.name === "Search")!;
    search.setting.__click("Change: press");
    __fire(search.setting.texts[0]!.inputEl, "keydown", { code: "KeyB", key: "b", altKey: false, shiftKey: false, ctrlKey: true, metaKey: false });
    await tick();
    expect(h.notices.filter((n) => n.includes("Obsidian's Toggle bold"))).toHaveLength(1);
    rows = renderRows(page().items[0]!.items as never);
    const searchRow = rows.find((r) => r.name === "Search")!;
    // …marked as a changed key that Obsidian also holds: the note in the warning colour, the keycap plain.
    expect(__findAllByClass(searchRow.setting.descEl, "nfe-hotkey-obsidian")).toHaveLength(1);
    expect(descOf(searchRow)).not.toContain("takes this key first");
    // …but says, muted, that Obsidian has it too and the pane wins.
    expect(descOf(searchRow)).toContain("also Obsidian's Toggle bold: this pane takes it first while the text has the focus");
    // Both plugin rows now share Ctrl+B: the conflict (error) is what the keycap shows, the warning text stays beside it.
    const aboveAgain = rows.find((r) => r.name === "Add cursor above")!;
    expect(aboveAgain.setting.settingEl.hasClass("nfe-hotkey-conflict")).toBe(true);
    // Back to the default: the warning class is toggled off on the reused element.
    const item = (page().items[0]!.items as Array<{ name: string; render: (s: Setting) => void }>).find((i) => i.name === "Add cursor above")!;
    await h.deps.saveSettings({ ...h.current(), hotkeys: { ...h.current().hotkeys, win: { search: "Ctrl+B" } } });
    item.render(aboveAgain.setting);
    expect(aboveAgain.setting.settingEl.hasClass("nfe-hotkey-conflict")).toBe(false);
    // The page's entry carries Obsidian's warning indicator while a row needs a look (Search still on Ctrl+B), none at the defaults.
    const status = () => (buildDefinitions(h.deps).find((d) => "type" in d && d.type === "page" && (d as { name?: string }).name === "Hotkeys") as unknown as { status: () => string | null }).status();
    expect(status()).toBe("warning");
    await h.deps.saveSettings({ ...h.current(), hotkeys: { win: {}, mac: {}, linux: {} } });
    expect(status()).toBe(null);
  });

  it("custom file types live on the File types page: add asks for the extension and a language, delete removes, both reread", async () => {
    const h = harness();
    const page = () => buildDefinitions(h.deps).find((d) => "type" in d && d.type === "page" && (d as { name?: string }).name === "File types") as unknown as { items: Array<Record<string, unknown>> };
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

  it("the Plugin group: Reload calls back; Reset asks first and forgets this device's state only on yes", async () => {
    const h = harness();
    h.device.update({ runEnabled: true, runners: [{ language: "Python", name: "p", argv: ["python", "{file}"] }], largeFileBytes: 5 });
    const group = buildDefinitions(h.deps).find((d) => "heading" in d && d.heading === "Plugin") as { items: Array<{ name: string; action?: () => void }> };
    expect(group.items.map((i) => i.name)).toEqual(["Reload plugin", "Reset this device's settings"]);
    group.items[0]?.action?.();
    expect(h.actions).toEqual(["reload"]);
    // Dismissed (Escape, the X, a tap outside): nothing happens, no notice.
    h.dialogs.confirm = false;
    group.items[1]?.action?.();
    await tick();
    expect(h.dialogs.asked).toEqual(["Reset this device's settings? | Native File Editor forgets what it keeps for this device: 1 interpreter, the Run switch, the timeout and output limit, the large-file limit and the remembered panel heights and modes. Shared settings in data.json are not touched. There is no undo. | Reset"]);
    expect(h.device.get()).toMatchObject({ runEnabled: true, largeFileBytes: 5 });
    expect(h.device.get().runners).toHaveLength(1);
    expect(h.notices.some((n) => /device settings reset/.test(n))).toBe(false);
    // Confirmed: reset, and the notice.
    h.dialogs.confirm = true;
    group.items[1]?.action?.();
    await tick();
    expect(h.device.get()).toMatchObject({ runEnabled: false, runners: [], largeFileBytes: DEFAULT_LARGE_FILE_BYTES });
    expect(h.notices.at(-1)).toMatch(/device settings reset/);
    // With no interpreter the question says so.
    group.items[1]?.action?.();
    await tick();
    expect(h.dialogs.asked.at(-1)).toContain("the interpreters (none now)");
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
