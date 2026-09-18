import { afterEach, describe, expect, it } from "vitest";
import { TEXT_LANGUAGES } from "../src/fmt/textLanguages";
import {
  __clearVaultDictionaries,
  activeLexicon,
  allTextLanguageNames,
  buildLexicon,
  bundledDictionary,
  dictionaryJson,
  mergeDictionaries,
  parseDictionary,
  setVaultDictionaries,
} from "../src/fmt/dictionary";

afterEach(() => {
  __clearVaultDictionaries();
});

describe("the bundled dictionaries", () => {
  it("names every language of the request, once", () => {
    const names = TEXT_LANGUAGES.map((d) => d.name);
    expect(names).toEqual([...new Set(names)]);
    for (const name of ["Ukrainian", "Russian", "English", "French", "German", "Italian", "Finnish", "Irish", "Scottish Gaelic", "Welsh", "Arabic", "Crimean Tatar", "Spanish", "Norwegian", "Swedish"]) {
      expect(names).toContain(name);
    }
  });

  it("holds no entry that would be found by a lower-case comparison twice, and none with a hyphen in a particle", () => {
    for (const dictionary of TEXT_LANGUAGES) {
      for (const particle of [...dictionary.prefixes, ...dictionary.suffixes]) {
        expect(particle).not.toMatch(/[-‐‑]/);
        expect(particle).toBe(particle.toLowerCase());
      }
    }
  });

  it("is found by name, whatever the case", () => {
    expect(bundledDictionary("ukrainian")?.name).toBe("Ukrainian");
    expect(bundledDictionary("  Finnish ")?.name).toBe("Finnish");
    expect(bundledDictionary("Klingon")).toBeNull();
  });
});

describe("parseDictionary", () => {
  it("reads a file and takes its name from the file when the JSON has none", () => {
    const parsed = parseDictionary({ prefixes: ["будь"], suffixes: ["небудь"], words: ["будь-що"] }, "Ukrainian");
    expect("dictionary" in parsed && parsed.dictionary.name).toBe("Ukrainian");
    expect("dictionary" in parsed && parsed.dictionary.words).toEqual(["будь-що"]);
  });

  it("keeps the flags and the note, and drops the empty entries", () => {
    const parsed = parseDictionary({ name: "Finnish", words: ["linja-auto", "  ", ""], keepSameVowel: true, replace: true, note: " a note " }, "x");
    expect("dictionary" in parsed && parsed.dictionary).toEqual({ name: "Finnish", prefixes: [], suffixes: [], words: ["linja-auto"], keepSameVowel: true, replace: true, note: "a note" });
  });

  it("refuses what is not a dictionary", () => {
    expect(parseDictionary(["a"], "x")).toEqual({ error: "not a JSON object" });
    expect(parseDictionary({ words: "будь-що" }, "x")).toEqual({ error: `"words" must be an array of strings` });
    expect(parseDictionary({ words: [1] }, "x")).toEqual({ error: `"words" must be an array of strings` });
    expect(parseDictionary({ name: 5 }, "x")).toEqual({ error: `"name" must be a string` });
    expect(parseDictionary({ words: ["a-b"], replace: "yes" }, "x")).toEqual({ error: `"replace" must be true or false` });
    expect(parseDictionary({}, "x")).toEqual({ error: "no prefixes, suffixes or words" });
    expect(parseDictionary({ name: "  " }, "x")).toEqual({ error: "no name" });
  });

  it("reads back what it writes", () => {
    const ukrainian = bundledDictionary("Ukrainian");
    expect(ukrainian).not.toBeNull();
    const parsed = parseDictionary(JSON.parse(dictionaryJson(ukrainian!)), "file");
    expect("dictionary" in parsed && parsed.dictionary.name).toBe("Ukrainian");
    expect("dictionary" in parsed && parsed.dictionary.words).toEqual([...ukrainian!.words]);
    expect("dictionary" in parsed && parsed.dictionary.prefixes).toEqual([...ukrainian!.prefixes]);
  });
});

describe("buildLexicon", () => {
  const lexicon = buildLexicon([{ name: "Test", prefixes: ["Кое", "-по-"], suffixes: ["НЕБУДЬ"], words: ["Будь‑що", "непереносимой", " "] }]);

  it("lower-cases, strips the hyphens of a particle and normalises the hyphen of a word", () => {
    expect([...lexicon.prefixes].sort()).toEqual(["кое", "по"]);
    expect([...lexicon.suffixes]).toEqual(["небудь"]);
    expect(lexicon.hyphenated.has("будь-що")).toBe(true);
    expect(lexicon.plain.has("непереносимой")).toBe(true);
  });

  it("asks for the same-vowel rule outside the Latin script only when a dictionary does", () => {
    expect(lexicon.sameVowelEverywhere).toBe(false);
    expect(buildLexicon([{ name: "T", prefixes: [], suffixes: [], words: ["a-a"], keepSameVowel: true }]).sameVowelEverywhere).toBe(true);
  });
});

describe("a vault dictionary beside the bundled ones", () => {
  const vault = { name: "ukrainian", prefixes: ["мега"], suffixes: [], words: ["мега-байт"] };

  it("extends the bundled language of the same name, whatever the case", () => {
    const merged = mergeDictionaries(TEXT_LANGUAGES, [vault]);
    const ukrainian = merged.find((d) => d.name === "Ukrainian");
    expect(ukrainian?.prefixes).toContain("мега");
    expect(ukrainian?.prefixes).toContain("будь");
    expect(merged.length).toBe(TEXT_LANGUAGES.length);
  });

  it("replaces it when it says so", () => {
    const merged = mergeDictionaries(TEXT_LANGUAGES, [{ ...vault, replace: true }]);
    const ukrainian = merged.find((d) => d.name === "ukrainian");
    expect(ukrainian?.prefixes).toEqual(["мега"]);
    expect(merged.some((d) => d.name === "Ukrainian")).toBe(false);
  });

  it("adds a language of its own under a new name", () => {
    const merged = mergeDictionaries(TEXT_LANGUAGES, [{ name: "Klingon", prefixes: [], suffixes: [], words: ["nuq-neH"] }]);
    expect(merged.length).toBe(TEXT_LANGUAGES.length + 1);
    expect(merged[merged.length - 1]?.name).toBe("Klingon");
  });

  it("is in force for the lexicon and the names as soon as it is set, and gone when it is cleared", () => {
    expect(activeLexicon().hyphenated.has("nuq-neh")).toBe(false);
    setVaultDictionaries([{ name: "Klingon", prefixes: [], suffixes: [], words: ["nuq-neH"] }]);
    expect(activeLexicon().hyphenated.has("nuq-neh")).toBe(true);
    expect(allTextLanguageNames()).toContain("Klingon");
    __clearVaultDictionaries();
    expect(activeLexicon().hyphenated.has("nuq-neh")).toBe(false);
    expect(activeLexicon().hyphenated.has("будь-що")).toBe(true);
  });
});
