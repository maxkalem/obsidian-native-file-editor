import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { localizationExample, parseLocalization } from "../src/core/localization";
import { EN } from "../src/i18n/en";

/**
 * The two example files in the repository: the English one a translator writes
 * over, and the Ukrainian one as a finished example. They are installed by
 * hand and never pass through a build, so this is what checks them: they have
 * to parse, carry no key the plugin does not know, and keep every placeholder
 * of the English text — a translation that loses a `{count}` loses the number
 * it was meant to show.
 */

const DIR = fileURLToPath(new URL("../locales", import.meta.url));
const read = (name: string) => JSON.parse(readFileSync(`${DIR}/${name}`, "utf8")) as { locale?: string; name?: string; strings: Record<string, string> };
const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();

describe("the example localization files", () => {
  it("english.json is the catalogue as it stands, so a translator starts from something current", () => {
    expect(readFileSync(`${DIR}/english.json`, "utf8")).toBe(localizationExample("en", "English"));
  });

  for (const file of ["english.json", "uk.json"]) {
    it(`${file} parses, translates only keys the plugin has, and keeps every placeholder`, () => {
      const raw = read(file);
      const parsed = parseLocalization(raw);
      if (!("localization" in parsed)) throw new Error(`${file}: ${parsed.error}`);
      expect(parsed.localization.name.length).toBeGreaterThan(0);
      const unknown = Object.keys(parsed.localization.strings).filter((key) => EN[key] === undefined);
      expect(unknown, `${file}: keys the plugin does not know`).toEqual([]);
      const mismatched = Object.entries(parsed.localization.strings)
        .filter(([key, value]) => placeholders(EN[key] as string).join() !== placeholders(value).join())
        .map(([key]) => key);
      expect(mismatched, `${file}: placeholders differ from the English text`).toEqual([]);
    });
  }

  it("uk.json is complete, so one file proves the whole catalogue can be translated", () => {
    const uk = read("uk.json");
    expect(Object.keys(EN).filter((key) => uk.strings[key] === undefined)).toEqual([]);
  });
});
