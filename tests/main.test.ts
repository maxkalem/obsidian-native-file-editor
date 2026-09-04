import { beforeEach, describe, expect, it } from "vitest";
import { Events, __notices, __resetObsidianMock, mockPlugin } from "./mocks/obsidian";
import { VIEW_TYPE_TEXT } from "../src/constants";
import NativeFileEditorPlugin, { readOwnedExtensions, vaultId } from "../src/main";

/**
 * Load-time orchestration: which extensions are registered, when the yield
 * notice appears, and that the settings tab and the command are wired. The
 * desktop transport is not constructed for real here (no Electron require);
 * the fake app has a plain adapter so the mobile path is chosen, and Node
 * provides the CompressionStream it needs.
 */

function makeApp(owned: Record<string, string>) {
  const vault = new Events() as unknown as Record<string, unknown>;
  vault.adapter = {};
  vault.getName = () => "TestVault";
  return {
    vault,
    workspace: { getActiveViewOfType: () => null },
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
    expect(plugin.commands.map((c) => c.id)).toEqual(["toggle-mode"]);
    expect(plugin.settingTabs).toHaveLength(1);
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
});
