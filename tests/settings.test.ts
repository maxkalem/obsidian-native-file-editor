import { describe, expect, it } from "vitest";
import { DEFAULT_LARGE_FILE_BYTES } from "../src/constants";
import { DeviceLocalStore, type StorageLike, normalizeDeviceState } from "../src/settings/DeviceLocalStore";
import { buildDefinitions, readSettingValue, writeSettingValue } from "../src/settings/SettingsTab";
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
    expect(normalizeDeviceState({ lastMode: { a: "nope", b: "edit" }, largeFileBytes: -1 })).toEqual({
      lastMode: { b: "edit" },
      largeFileBytes: DEFAULT_LARGE_FILE_BYTES,
      yieldNoticeKey: "",
    });
  });
});

describe("settings tab definitions", () => {
  function harness(initial: SharedSettings = DEFAULT_SETTINGS, owned: Record<string, string> = {}) {
    let current = initial;
    const device = new DeviceLocalStore("v", new MapStorage());
    const deps = {
      settings: () => current,
      saveSettings: async (n: SharedSettings) => void (current = n),
      device,
      ownedElsewhere: () => owned,
    };
    return { deps, device, current: () => current };
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

  it("rejects out-of-range and wrong-typed writes without saving", async () => {
    const h = harness();
    await writeSettingValue("shared.tabSize", 99, h.deps);
    await writeSettingValue("shared.lineNumbers", "yes", h.deps);
    await writeSettingValue("device.largeFileMb", -5, h.deps);
    expect(h.current()).toEqual(DEFAULT_SETTINGS);
    expect(h.device.get().largeFileBytes).toBe(DEFAULT_LARGE_FILE_BYTES);
  });
});
