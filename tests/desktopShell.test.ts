import { describe, expect, it } from "vitest";
import { openObsidianHotkeys, reloadPlugin } from "../src/platform/desktopShell";

function fakeApp(tabs: string[]) {
  const calls: string[] = [];
  const app = {
    plugins: {
      disablePlugin: async (id: string) => void calls.push(`disable ${id}`),
      enablePlugin: async (id: string) => void calls.push(`enable ${id}`),
    },
    setting: {
      close: () => void calls.push("close"),
      open: () => void calls.push("open"),
      openTabById: (id: string) => {
        calls.push(`tab ${id}`);
        return tabs.includes(id) ? { id } : null;
      },
    },
  };
  return { app, calls };
}

describe("reloadPlugin", () => {
  it("closes settings, restarts the plugin and reopens settings on the plugin's own tab", async () => {
    const { app, calls } = fakeApp(["native-file-editor", "community-plugins"]);
    expect(await reloadPlugin(app, "native-file-editor")).toBeNull();
    expect(calls).toEqual(["close", "disable native-file-editor", "enable native-file-editor", "open", "tab native-file-editor"]);
  });

  it("falls back to Community plugins when the plugin's tab is not registered", async () => {
    const { app, calls } = fakeApp(["community-plugins"]);
    expect(await reloadPlugin(app, "native-file-editor")).toBeNull();
    expect(calls.slice(-2)).toEqual(["tab native-file-editor", "tab community-plugins"]);
  });

  it("names a missing plugin manager instead of throwing", async () => {
    expect(await reloadPlugin({}, "native-file-editor")).toMatch(/plugin manager/);
  });

  it("returns the error text when the restart fails", async () => {
    const app = { plugins: { disablePlugin: async () => undefined, enablePlugin: async () => Promise.reject(new Error("boom")) } };
    expect(await reloadPlugin(app, "x")).toBe("boom");
  });
});

describe("openObsidianHotkeys", () => {
  it("opens Obsidian's Hotkeys tab and sets its search to the plugin's name", () => {
    const calls: string[] = [];
    const app = {
      setting: {
        open: () => void calls.push("open"),
        openTabById: (id: string) => {
          calls.push(`tab ${id}`);
          return { setQuery: (q: string) => void calls.push(`query ${q}`) };
        },
      },
    };
    expect(openObsidianHotkeys(app, "Native File Editor")).toBe(true);
    expect(calls).toEqual(["open", "tab hotkeys", "query Native File Editor"]);
  });

  it("still opens the tab when it has no search to set, and reports a build that has no tab at all", () => {
    const bare = { setting: { open: () => undefined, openTabById: () => ({}) } };
    expect(openObsidianHotkeys(bare, "x")).toBe(true);
    expect(openObsidianHotkeys({}, "x")).toBe(false);
    expect(openObsidianHotkeys({ setting: { openTabById: () => null } }, "x")).toBe(false);
  });
});
