import { afterEach, describe, expect, it } from "vitest";
import { Logger } from "../src/core/log";
import { activeLocale, formatMessage, knownKeys, plural, setLocale, t } from "../src/core/i18n";
import { LOCALIZATION_FILE, loadLocalization, localizationExample, parseLocalization } from "../src/core/localization";
import { EN } from "../src/i18n/en";
import { isRightToLeft } from "../src/i18n/locales";
import { type Transport, TransportError } from "../src/platform/transport";

/**
 * Translation: English inside the plugin, ONE file beside it that replaces it,
 * and a key the file does not carry falling back to English.
 */

class MemoryTransport implements Transport {
  readonly kind = "desktop" as const;
  files = new Map<string, Uint8Array>();
  async readBinary(p: string): Promise<Uint8Array> {
    const f = this.files.get(p);
    if (!f) throw new TransportError("not-found", p, p);
    return f;
  }
  async writeBinaryAtomic(p: string, bytes: Uint8Array): Promise<void> {
    this.files.set(p, bytes);
  }
  inflateRaw(d: Uint8Array): Promise<Uint8Array> {
    return Promise.resolve(d);
  }
  deflateRaw(d: Uint8Array): Promise<Uint8Array> {
    return Promise.resolve(d);
  }
  async listDir(): Promise<{ files: string[]; folders: string[] }> {
    return { files: [], folders: [] };
  }
  async mkdir(): Promise<void> {}
  put(path: string, text: string): void {
    this.files.set(path, new TextEncoder().encode(text));
  }
}

const FOLDER = ".obsidian/plugins/native-file-editor";
const PATH = `${FOLDER}/${LOCALIZATION_FILE}`;
const log = () => new Logger({ sink: null, timers: { setTimeout: () => 0, clearTimeout: () => undefined }, now: () => 0 });

afterEach(() => setLocale(null));

describe("t and the fallback", () => {
  it("answers in English until a file is in force, and per key after that", () => {
    const key = knownKeys()[0] as string;
    expect(t(key)).toBe(EN[key]);
    setLocale({ code: "custom", name: "Українська", strings: { [key]: "перекладено" } });
    expect(activeLocale().name).toBe("Українська");
    expect(t(key)).toBe("перекладено");
    // A key the file does not carry, and an empty translation, both stay English.
    const other = knownKeys()[1] as string;
    expect(t(other)).toBe(EN[other]);
    setLocale({ code: "custom", name: "Українська", strings: { [other]: "" } });
    expect(t(other)).toBe(EN[other]);
  });

  it("fills the placeholders, leaves an unknown one alone and knows two plural forms", () => {
    expect(formatMessage("{count} of {total}", { count: 2, total: 5 })).toBe("2 of 5");
    expect(formatMessage("{count} of {total}", { count: 2 })).toBe("2 of {total}");
    expect(formatMessage("nothing to fill")).toBe("nothing to fill");
    setLocale({ code: "custom", name: "X", strings: { "a.one": "one thing", "a.other": "{count} things" } });
    expect(plural(1, "a.one", "a.other")).toBe("one thing");
    expect(plural(3, "a.one", "a.other")).toBe("3 things");
  });

  it("an unknown key is its own name, which is what the catalogue test catches", () => {
    expect(t("no.such.key")).toBe("no.such.key");
  });
});

describe("the catalogue", () => {
  it("every English value is a non-empty string and every placeholder is named", () => {
    for (const [key, value] of Object.entries(EN)) {
      expect(value.trim().length, key).toBeGreaterThan(0);
      for (const match of value.matchAll(/\{(\w*)\}/g)) expect(match[1], key).not.toBe("");
    }
  });

  it("knows which scripts run right to left, for a file that does not say", () => {
    expect(isRightToLeft("ar")).toBe(true);
    expect(isRightToLeft("he")).toBe(true);
    expect(isRightToLeft("fa-IR")).toBe(true);
    expect(isRightToLeft("uk")).toBe(false);
    expect(isRightToLeft("")).toBe(false);
  });
});

describe("parseLocalization", () => {
  it("takes the language's name, its direction and its strings from the file itself", () => {
    const parsed = parseLocalization({ locale: "uk", name: "Українська", strings: { "a.b": "текст", "c.d": "  " } });
    expect("localization" in parsed && parsed.localization).toEqual({ name: "Українська", rtl: false, strings: { "a.b": "текст" }, translated: 1 });
    // No name: the code; no code either: the file's own name, so something is always shown.
    expect("localization" in (parseLocalization({ locale: "de", strings: { a: "b" } }) as never) && (parseLocalization({ locale: "de", strings: { a: "b" } }) as { localization: { name: string } }).localization.name).toBe("de");
    const anonymous = parseLocalization({ strings: { a: "b" } });
    expect("localization" in anonymous && anonymous.localization.name).toBe(LOCALIZATION_FILE);
    // Right to left: the file's flag, or the script of the code.
    expect("localization" in (parseLocalization({ locale: "fa", strings: { a: "ب" } }) as never) && (parseLocalization({ locale: "fa", strings: { a: "ب" } }) as { localization: { rtl: boolean } }).localization.rtl).toBe(true);
    const forced = parseLocalization({ locale: "xx", rtl: true, strings: { a: "b" } });
    expect("localization" in forced && forced.localization.rtl).toBe(true);
  });

  it("refuses what is not a localization file", () => {
    expect(parseLocalization([])).toEqual({ error: "not a JSON object" });
    expect(parseLocalization({ strings: "x" })).toEqual({ error: `"strings" must be an object of key -> text` });
    expect(parseLocalization({ strings: { "a.b": 5 } })).toEqual({ error: `"a.b" must be a string` });
    expect(parseLocalization({ strings: {} })).toEqual({ error: "no strings" });
    expect(parseLocalization({ locale: 5, strings: { a: "b" } })).toEqual({ error: `"locale" must be a string` });
    expect(parseLocalization({ rtl: "yes", strings: { a: "b" } })).toEqual({ error: `"rtl" must be true or false` });
  });
});

describe("loadLocalization", () => {
  const key = knownKeys()[0] as string;

  it("puts the file beside the plugin in force, and says how much of the plugin it translates", async () => {
    const transport = new MemoryTransport();
    transport.put(PATH, JSON.stringify({ locale: "uk", name: "Українська", strings: { [key]: "переклад" } }));
    const report = await loadLocalization(transport, FOLDER, log());
    expect(report.path).toBe(PATH);
    expect(report.problem).toBeNull();
    expect(report.localization).toMatchObject({ name: "Українська", translated: 1, rtl: false });
    expect(t(key)).toBe("переклад");
    // Everything it does not translate is English.
    expect(t(knownKeys()[1] as string)).toBe(EN[knownKeys()[1] as string]);
  });

  it("no file at all is English and not a problem", async () => {
    setLocale({ code: "custom", name: "stale", strings: { [key]: "залишок" } });
    const report = await loadLocalization(new MemoryTransport(), FOLDER, log());
    expect(report).toMatchObject({ localization: null, problem: null });
    // The previous file is dropped, not kept: a deleted file means English again.
    expect(t(key)).toBe(EN[key]);
  });

  it("an empty file is the same as no file", async () => {
    const transport = new MemoryTransport();
    transport.put(PATH, "   \n");
    const report = await loadLocalization(transport, FOLDER, log());
    expect(report).toMatchObject({ localization: null, problem: null });
  });

  it("a file that is not valid is reported, and the plugin stays in English", async () => {
    const transport = new MemoryTransport();
    transport.put(PATH, "{ not json");
    const broken = await loadLocalization(transport, FOLDER, log());
    expect(broken.localization).toBeNull();
    expect(broken.problem).not.toBeNull();
    expect(t(key)).toBe(EN[key]);
    transport.put(PATH, JSON.stringify({ strings: {} }));
    const empty = await loadLocalization(transport, FOLDER, log());
    expect(empty.problem).toBe("no strings");
    expect(t(key)).toBe(EN[key]);
  });
});

describe("the example file", () => {
  it("carries every key with its English text, so a translator writes over it", () => {
    const body = JSON.parse(localizationExample("en", "English")) as { locale: string; name: string; rtl: boolean; strings: Record<string, string> };
    expect(body).toMatchObject({ locale: "en", name: "English", rtl: false });
    expect(Object.keys(body.strings).sort()).toEqual(Object.keys(EN).sort());
    expect(body.strings["menu.unwrap"]).toBe(EN["menu.unwrap"]);
    expect(JSON.parse(localizationExample("fa", "فارسی")).rtl).toBe(true);
  });

  it("loads as it is: copied in unedited, the plugin is still in English", async () => {
    const transport = new MemoryTransport();
    transport.put(PATH, localizationExample("en", "English"));
    const report = await loadLocalization(transport, FOLDER, log());
    expect(report.localization?.translated).toBe(Object.keys(EN).length);
    expect(t(knownKeys()[0] as string)).toBe(EN[knownKeys()[0] as string]);
  });
});
