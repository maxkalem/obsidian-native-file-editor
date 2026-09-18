import { beforeEach, describe, expect, it } from "vitest";
import { Events, Menu, TFile, TFolder, __modalInstances, __notices, __openedModals, __resetObsidianMock, mockPlugin } from "./mocks/obsidian";
import { VIEW_TYPE_TEXT } from "../src/constants";
import NativeFileEditorPlugin, { logFilePath, obsidianCommandsOn, readOwnedExtensions, selfTestStreamLanguage, vaultId } from "../src/main";
import { PALETTE_STYLE_ID } from "../src/ui/styleSink";

/**
 * Load-time orchestration: which extensions are registered, when the yield
 * notice appears, and that the settings tab and the command are wired. The
 * desktop transport is not constructed for real here (no Electron require);
 * the fake app has a plain adapter so the mobile path is chosen, and Node
 * provides the CompressionStream it needs.
 */

/** An adapter that records log appends; everything else the sink needs is a no-op. */
function makeAdapter() {
  const appended: string[] = [];
  const written: string[] = [];
  return {
    appended,
    exists: async () => true,
    stat: async () => ({ size: 0 }),
    append: async (_p: string, text: string) => void appended.push(text),
    rename: async () => undefined,
    remove: async () => undefined,
    mkdir: async () => undefined,
    list: async () => ({ files: [], folders: [] }),
    readBinary: async () => new ArrayBuffer(0),
    writeBinary: async (p: string) => void written.push(p),
    written,
  };
}

function makeApp(owned: Record<string, string>) {
  const vault = new Events() as unknown as Record<string, unknown>;
  const adapter = makeAdapter();
  vault.adapter = adapter;
  vault.getName = () => "TestVault";
  vault.configDir = ".obsidian";
  vault.getAbstractFileByPath = () => null;
  const workspace = new Events() as unknown as Record<string, unknown>;
  workspace.getActiveViewOfType = () => null;
  workspace.getActiveFile = () => null;
  workspace.onLayoutReady = (cb: () => void) => cb();
  vault.getFiles = () => [];
  return {
    vault,
    workspace,
    adapter,
    viewRegistry: { typeByExtension: owned },
  };
}

const storage = new Map<string, string>();
beforeEach(() => {
  __resetObsidianMock();
  storage.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v) },
  });
});

describe("plugin load", () => {
  it("registers the view and the unowned extensions, yields the owned ones with one notice", async () => {
    const app = makeApp({ log: "cm-code-editor", md: "markdown" });
    const plugin = mockPlugin(new NativeFileEditorPlugin(app as never, { id: "native-file-editor" } as never));
    await plugin.onload();
    expect(plugin.registeredViews.has(VIEW_TYPE_TEXT)).toBe(true);
    expect(plugin.registeredExtensions).toHaveLength(1);
    const taken = plugin.registeredExtensions[0]!;
    expect(taken.viewType).toBe(VIEW_TYPE_TEXT);
    expect(taken.extensions).toContain("txt");
    expect(taken.extensions).toContain("py");
    expect(taken.extensions).not.toContain("log");
    expect(taken.extensions).not.toContain("md");
    expect(__notices).toEqual(["Native File Editor left .log to cm-code-editor. Take them over per extension in its settings."]);
    expect(plugin.commands.map((c) => c.id)).toEqual(["toggle-mode", "new-file", "reload-palettes", "write-example-palette"]);
    expect(plugin.settingTabs).toHaveLength(1);
  });

  it("writes load, transport, self-test and claims lines to the log file after the flush delay", async () => {
    const app = makeApp({});
    const plugin = mockPlugin(new NativeFileEditorPlugin(app as never, { version: "0.1.0" } as never));
    await plugin.onload();
    await new Promise((r) => setTimeout(r, 1100));
    const text = app.adapter.appended.join("");
    expect(text).toContain("[plugin] load 0.1.0 build dev on");
    expect(text).toContain("[plugin] transport mobile");
    expect(text).toContain("self-test: builtin log: ok");
    expect(text).toContain("legacy shell: ok");
    expect(text).toMatch(/\[claims\] took \d+ extensions/);
    expect(text.endsWith("\n")).toBe(true);
  });

  it("after load, asks Obsidian to drop listed files the disk lacks, and logs the sweep", async () => {
    const app = makeApp({});
    (app.vault as Record<string, unknown>).getFiles = () => [new TFile("code/sample.py"), new TFile("code/py sample.py"), new TFile("notes.md")];
    (app.adapter as Record<string, unknown>).list = async () => ({ files: ["code/py sample.py"], folders: [] });
    const dropped: string[] = [];
    (app.adapter as Record<string, unknown>).reconcileDeletion = (normalized: string, real: string) => void dropped.push(`${normalized}|${real}`);
    const plugin = mockPlugin(new NativeFileEditorPlugin(app as never, { version: "0.1.0" } as never));
    await plugin.onload();
    await new Promise((r) => setTimeout(r, 1100));
    expect(dropped).toEqual(["code/sample.py|code/sample.py"]);
    const text = app.adapter.appended.join("");
    expect(text).toContain("[vault] after load: 2 listed files checked against the disk; 1 stale (code/sample.py); 0 on disk but not listed");
  });

  it("after load, asks Obsidian to index the files the disk has under its extensions that the list lacks", async () => {
    // The 2026-09-07 case: a batch rename whose create events the watcher lost.
    const app = makeApp({});
    (app.vault as Record<string, unknown>).getFiles = () => [new TFile("code/015 c sample.c"), new TFile("code/ceylon sample.ceylon")];
    (app.adapter as Record<string, unknown>).list = async () => ({ files: ["code/015 c sample.c", "code/016 ceylon sample.ceylon", "code/.016 ceylon sample.ceylon.nfe-tmp-1", "code/notes.md"], folders: [] });
    const dropped: string[] = [];
    const adopted: string[] = [];
    (app.adapter as Record<string, unknown>).reconcileDeletion = (p: string) => void dropped.push(p);
    (app.adapter as Record<string, unknown>).reconcileInternalFile = (p: string) => void adopted.push(p);
    const plugin = mockPlugin(new NativeFileEditorPlugin(app as never, { version: "0.1.0" } as never));
    await plugin.onload();
    await new Promise((r) => setTimeout(r, 1100));
    expect(dropped).toEqual(["code/ceylon sample.ceylon"]);
    expect(adopted).toEqual(["code/016 ceylon sample.ceylon"]);
    const text = app.adapter.appended.join("");
    expect(text).toContain("[vault] after load: 2 listed files checked against the disk; 1 stale (code/ceylon sample.ceylon); 1 on disk but not listed (code/016 ceylon sample.ceylon)");
  });

  it("without adapter.reconcileInternalFile the sweep logs that and moves on", async () => {
    const app = makeApp({});
    (app.vault as Record<string, unknown>).getFiles = () => [new TFile("code/a.py")];
    (app.adapter as Record<string, unknown>).list = async () => ({ files: ["code/a.py", "code/b.py"], folders: [] });
    const plugin = mockPlugin(new NativeFileEditorPlugin(app as never, { version: "0.1.0" } as never));
    await plugin.onload();
    await new Promise((r) => setTimeout(r, 1100));
    expect(app.adapter.appended.join("")).toContain("this Obsidian build has no adapter.reconcileInternalFile");
  });

  it("sweeps again two seconds after a burst of created or deleted files with its extensions", async () => {
    const app = makeApp({});
    let files = [new TFile("code/a.py")];
    (app.vault as Record<string, unknown>).getFiles = () => files;
    (app.adapter as Record<string, unknown>).list = async () => ({ files: ["code/b.py"], folders: [] });
    const dropped: string[] = [];
    const adopted: string[] = [];
    (app.adapter as Record<string, unknown>).reconcileDeletion = (p: string) => void dropped.push(p);
    (app.adapter as Record<string, unknown>).reconcileInternalFile = (p: string) => void adopted.push(p);
    const plugin = mockPlugin(new NativeFileEditorPlugin(app as never, { version: "0.1.0" } as never));
    await plugin.onload();
    await new Promise((r) => setTimeout(r, 20));
    expect(dropped).toEqual(["code/a.py"]);
    expect(adopted).toEqual(["code/b.py"]);
    files = [new TFile("code/a.py"), new TFile("code/b.py")];
    const vault = app.vault as unknown as Events;
    vault.trigger("create", new TFile("code/b.py"));
    vault.trigger("create", new TFile("notes.md"));
    vault.trigger("create", new TFile("code/b.py"));
    await new Promise((r) => setTimeout(r, 1500));
    expect(dropped).toEqual(["code/a.py"]);
    await new Promise((r) => setTimeout(r, 1200));
    expect(dropped).toEqual(["code/a.py", "code/a.py"]);
    expect(adopted).toEqual(["code/b.py"]);
    vault.trigger("delete", new TFile("code/a.py"));
    await new Promise((r) => setTimeout(r, 2300));
    expect(dropped).toEqual(["code/a.py", "code/a.py", "code/a.py"]);
  }, 10000);

  it("loads palettes into one <style> element without writing anything, and offers the palette and reread commands", async () => {
    const head = (globalThis as unknown as { activeDocument: { head: { children: Array<{ id?: string; textContent?: string }> } } }).activeDocument.head;
    head.children.length = 0;
    const app = makeApp({});
    const plugin = mockPlugin(new NativeFileEditorPlugin(app as never, {} as never));
    await plugin.onload();
    await new Promise((r) => setTimeout(r, 20));
    expect(app.adapter.written).toEqual([]);
    expect(head.children.map((c) => c.id)).toEqual([PALETTE_STYLE_ID]);
    expect(head.children[0]?.textContent).toBe("");
    expect(plugin.commands.map((c) => c.id)).toContain("reload-palettes");
    expect(plugin.commands.map((c) => c.id)).toContain("write-example-palette");
    head.children.length = 0;
  });

  it("writes an example dictionary into the default folder, turns the switch on and puts the lists in force", async () => {
    const app = makeApp({});
    const plugin = mockPlugin(new NativeFileEditorPlugin(app as never, { id: "native-file-editor" } as never));
    await plugin.onload();
    expect(plugin.dictionaryFolder()).toBe(".obsidian/plugins/native-file-editor/dictionaries");
    __notices.length = 0;
    await plugin.createExampleDictionary("Finnish");
    expect(app.adapter.written.some((p) => p.includes("dictionaries/"))).toBe(true);
    expect(__notices.join(" ")).toContain("dictionaries/Finnish.json");
    // A language nothing bundles says so instead of writing a file.
    __notices.length = 0;
    await plugin.createExampleDictionary("Klingon");
    expect(__notices.join(" ")).toMatch(/no bundled dictionary/);
  });

  it("takes the palette <style> out of the head on unload", async () => {
    const head = (globalThis as unknown as { activeDocument: { head: { children: Array<{ id?: string }> } } }).activeDocument.head;
    head.children.length = 0;
    const app = makeApp({});
    const plugin = mockPlugin(new NativeFileEditorPlugin(app as never, {} as never));
    await plugin.onload();
    await new Promise((r) => setTimeout(r, 20));
    expect(head.children.map((c) => c.id)).toEqual([PALETTE_STYLE_ID]);
    plugin.onunload();
    expect(head.children).toEqual([]);
    // A second unload, or one before any palette was set, is harmless.
    plugin.onunload();
    expect(head.children).toEqual([]);
  });

  it("adds New file to a folder's context menu and opens the dialog with the extensions", async () => {
    const app = makeApp({});
    const plugin = mockPlugin(new NativeFileEditorPlugin(app as never, {} as never));
    await plugin.onload();
    const menu = new Menu();
    (app.workspace as unknown as Events).trigger("file-menu", menu, new TFolder("notes"));
    expect(menu.items.map((i) => i.title)).toEqual(["New file (Native File Editor)"]);
    menu.items[0]?.click();
    expect(__openedModals).toEqual(["NewFileModal"]);
    const modal = __modalInstances[0];
    modal.onOpen();
    expect(modal.contentEl.children.length).toBeGreaterThan(0);
    // A file gets "New file here", creating beside it.
    __openedModals.length = 0;
    __modalInstances.length = 0;
    const fileMenu = new Menu();
    const file = new TFile("notes/sub/a.txt");
    (file as unknown as { parent: TFolder }).parent = new TFolder("notes/sub");
    (app.workspace as unknown as Events).trigger("file-menu", fileMenu, file);
    expect(fileMenu.items.map((i) => i.title)).toEqual(["New file here (Native File Editor)"]);
    fileMenu.items[0]?.click();
    expect(__openedModals).toEqual(["NewFileModal"]);
    expect((__modalInstances[0] as { folder: string }).folder).toBe("notes/sub");
    // Something that is neither gets nothing.
    const otherMenu = new Menu();
    (app.workspace as unknown as Events).trigger("file-menu", otherMenu, { path: "x" });
    expect(otherMenu.items).toHaveLength(0);
  });

  it("adds Unwrap lines to a note's editor menu, acting through Obsidian's editor", async () => {
    const app = makeApp({});
    const plugin = mockPlugin(new NativeFileEditorPlugin(app as never, {} as never));
    await plugin.onload();
    const lines = ["A paragraph cut by a mail client at seventy-two columns, the first line here", "and the second one, which runs on to the end of the row as well before it", "stops."];
    const transactions: unknown[] = [];
    const editor = {
      somethingSelected: () => false,
      getCursor: () => ({ line: 0, ch: 0 }),
      lineCount: () => lines.length,
      getLine: (n: number) => lines[n] ?? "",
      getRange: () => lines.join("\n"),
      getValue: () => lines.join("\n"),
      getSelection: () => "",
      transaction: (tx: unknown) => void transactions.push(tx),
    };
    const menu = new Menu();
    (app.workspace as unknown as Events).trigger("editor-menu", menu, editor, { file: new TFile("notes/a.md") });
    expect(menu.items.map((i) => [i.title, i.icon])).toEqual([
      ["Unwrap lines (Native File Editor)", "unfold-horizontal"],
      ["Wrap lines… (Native File Editor)", "wrap-text"],
      ["Add to dictionary… (Native File Editor)", "book-plus"],
    ]);
    __notices.length = 0;
    menu.items[0]?.click();
    expect(transactions).toEqual([{ changes: [{ from: { line: 0, ch: 0 }, to: { line: 2, ch: 6 }, text: lines.join(" ") }], selection: undefined }]);
    expect(__notices).toEqual(["Unwrap lines: 2 line breaks removed at a wrap width of 76."]);
    // Wrap lines… opens the modal; its choice cuts the long line through the same editor.
    lines.splice(0, lines.length, lines.join(" "));
    transactions.length = 0;
    __notices.length = 0;
    __openedModals.length = 0;
    __modalInstances.length = 0;
    menu.items[1]?.click();
    expect(__openedModals).toEqual(["WrapLinesModal"]);
    const modal = __modalInstances[0] as { onOpen(): void; width: number; breakWords: boolean; finish(): void };
    modal.onOpen();
    modal.width = 50;
    modal.finish();
    expect(transactions).toHaveLength(1);
    const written = (transactions[0] as { changes: Array<{ text: string }> }).changes[0]?.text ?? "";
    expect(written.split("\n").every((l) => l.length <= 50)).toBe(true);
    expect(written.split("\n").join(" ")).toBe(lines[0]);
    expect(__notices).toEqual([expect.stringMatching(/^Wrap lines: 1 line cut at 50 characters, \d+ line breaks added\.$/)]);
    // Add to dictionary…: the word the cursor stands in is prefilled.
    __openedModals.length = 0;
    __modalInstances.length = 0;
    menu.items[2]?.click();
    expect(__openedModals).toEqual(["AddToDictionaryModal"]);
    expect((__modalInstances[0] as { word: string }).word).toBe("A");
    // Not a note: nothing added.
    const other = new Menu();
    (app.workspace as unknown as Events).trigger("editor-menu", other, editor, { file: new TFile("notes/a.canvas") });
    (app.workspace as unknown as Events).trigger("editor-menu", other, editor, { file: null });
    expect(other.items).toHaveLength(0);
  });

  it("does not repeat the notice at the next start for the same yielded set, and repeats it when the set changes", async () => {
    const app = makeApp({ log: "cm-code-editor" });
    await new NativeFileEditorPlugin(app as never, {} as never).onload();
    expect(__notices).toHaveLength(1);
    await new NativeFileEditorPlugin(app as never, {} as never).onload();
    expect(__notices).toHaveLength(1);
    await new NativeFileEditorPlugin(makeApp({ log: "some-other-view" }) as never, {} as never).onload();
    expect(__notices).toHaveLength(2);
  });

  it("a toggle in data.json takes an owned extension over", async () => {
    const app = makeApp({ log: "cm-code-editor" });
    const plugin = mockPlugin(new NativeFileEditorPlugin(app as never, {} as never));
    plugin.__setData({ extensions: { log: true } });
    await plugin.onload();
    expect(plugin.registeredExtensions[0]?.extensions).toContain("log");
    expect(__notices).toEqual([]);
  });

  it("the settings tab resolves its values and the file-type toggle names the owner", async () => {
    const app = makeApp({ log: "cm-code-editor" });
    const plugin = mockPlugin(new NativeFileEditorPlugin(app as never, {} as never));
    await plugin.onload();
    const tab = plugin.settingTabs[0];
    expect(tab.getControlValue("ext.log")).toBe(false);
    expect(tab.getControlValue("ext.txt")).toBe(true);
    expect(tab.getControlValue("shared.initialMode")).toBe("preview");
    await tab.setControlValue("shared.initialMode", "edit");
    expect(await plugin.loadData()).toMatchObject({ initialMode: "edit" });
  });
});

describe("readOwnedExtensions and vaultId", () => {
  it("reads the registry when it has the expected shape and is empty otherwise", () => {
    expect(readOwnedExtensions({ viewRegistry: { typeByExtension: { TXT: "x", n: 1 } } } as never)).toEqual({ txt: "x" });
    expect(readOwnedExtensions({} as never)).toEqual({});
    expect(readOwnedExtensions({ viewRegistry: { typeByExtension: "nope" } } as never)).toEqual({});
  });

  it("prefers appId and falls back to the vault name", () => {
    expect(vaultId({ appId: "abc", vault: { getName: () => "V" } } as never)).toBe("abc");
    expect(vaultId({ vault: { getName: () => "V" } } as never)).toBe("V");
  });

  it("names Obsidian's commands on a chord through the hotkey manager's baked arrays, and answers [] when the shape is not there", () => {
    let baked = 0;
    const app = {
      hotkeyManager: {
        bake: () => void baked++,
        bakedHotkeys: [
          { modifiers: "Ctrl", key: "b" },
          { modifiers: "Alt", key: "Enter" },
          { modifiers: "Ctrl", key: "b" },
        ],
        bakedIds: ["editor:toggle-bold", "editor:follow-link", "other-plugin:thing"],
      },
      commands: { findCommand: (id: string) => (id === "editor:toggle-bold" ? { name: "Toggle bold" } : id === "editor:follow-link" ? { name: "Follow link under cursor" } : undefined) },
    };
    expect(obsidianCommandsOn(app as never, { mod: true, shift: false, alt: false, key: "B" }, false)).toEqual(["Toggle bold", "other-plugin:thing"]);
    expect(obsidianCommandsOn(app as never, { mod: false, shift: false, alt: true, key: "Enter" }, false)).toEqual(["Follow link under cursor"]);
    expect(obsidianCommandsOn(app as never, { mod: true, shift: false, alt: true, key: "ArrowUp" }, false)).toEqual([]);
    expect(baked).toBe(3);
    // On macOS the chord's Mod is Meta; a Ctrl entry is not it.
    expect(obsidianCommandsOn(app as never, { mod: true, shift: false, alt: false, key: "B" }, true)).toEqual([]);
    expect(obsidianCommandsOn({} as never, { mod: true, shift: false, alt: false, key: "B" }, false)).toEqual([]);
    expect(obsidianCommandsOn({ hotkeyManager: { bake: () => { throw new Error("no"); } } } as never, { mod: true, shift: false, alt: false, key: "B" }, false)).toEqual([]);
    expect(obsidianCommandsOn({ hotkeyManager: { bake: () => undefined, bakedHotkeys: "x", bakedIds: [] } } as never, { mod: true, shift: false, alt: false, key: "B" }, false)).toEqual([]);
  });

  it("the log lives in the plugin folder under the config dir", () => {
    expect(logFilePath(".obsidian")).toBe(".obsidian/plugins/native-file-editor/nfe.log");
    expect(logFilePath(".obsidian-work")).toBe(".obsidian-work/plugins/native-file-editor/nfe.log");
  });

  it("the stream-language self-test passes against npm's CodeMirror", () => {
    expect(selfTestStreamLanguage()).toMatch(/^builtin log: ok .*; legacy shell: ok/);
  });
});
