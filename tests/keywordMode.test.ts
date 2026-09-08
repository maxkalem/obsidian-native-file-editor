import { StreamLanguage } from "@codemirror/language";
import { describe, expect, it } from "vitest";
import { tokenize } from "../src/highlight/highlighter";
import { type KeywordLanguage, keywordMode, parseKeywordLanguage } from "../src/highlight/keywordMode";
import { NPP_LANGUAGES } from "../src/highlight/langs.generated";

/**
 * Tier 4: the generic keyword mode and the generated Notepad++ tables.
 * Highlighting from a table is keywords, strings, numbers, comments and
 * punctuation, each proven on a tiny language; the tables are checked for
 * shape and for what the converter promises.
 */

const tiny: KeywordLanguage = {
  id: "tiny",
  name: "Tiny",
  extensions: ["tiny"],
  caseInsensitive: false,
  commentLine: "//",
  commentStart: "/*",
  commentEnd: "*/",
  sets: [
    ["keyword", "if else return"],
    ["type", "int string"],
    ["builtin", "print"],
    ["constant", "true false"],
  ],
};

function classesOf(text: string, def: KeywordLanguage): Array<[string, string | null]> {
  const lang = StreamLanguage.define(keywordMode(def));
  const tokens = tokenize(text, lang);
  if (!tokens) throw new Error("timed out");
  return tokens.filter((t) => t.text.trim().length > 0).map((t) => [t.text.trim(), t.classes]);
}

describe("keywordMode", () => {
  it("colours keywords, types, builtins, constants, strings, numbers, comments and punctuation", () => {
    const out = classesOf('if (x > 3) { print("hi", true); } // done\n/* block\n comment */ int y = 0x1F;', tiny);
    const by = new Map(out.map(([t, c]) => [t, c]));
    expect(by.get("if")).toContain("cm-keyword");
    expect(by.get("print")).toContain("cm-builtin");
    expect(by.get("int")).toContain("cm-type");
    expect(by.get("true")).toContain("cm-atom");
    expect(by.get('"hi"')).toContain("cm-string");
    expect(by.get("3")).toContain("cm-number");
    expect(by.get("0x1F")).toContain("cm-number");
    expect(by.get("// done")).toContain("cm-comment");
    expect(out.some(([t, c]) => t.includes("block") && (c ?? "").includes("cm-comment"))).toBe(true);
    expect(out.some(([t, c]) => t.includes("comment */") && (c ?? "").includes("cm-comment"))).toBe(true);
    expect(by.get("x")).toBeNull();
    expect(by.get(">")).toContain("cm-operator");
    expect(by.get("{")).toContain("cm-bracket");
    expect(by.get(";")).toContain("cm-punctuation");
  });

  it("is case-insensitive only when the language says so", () => {
    expect(classesOf("IF", tiny).find(([t]) => t === "IF")?.[1]).toBeNull();
    expect(classesOf("IF", { ...tiny, caseInsensitive: true }).find(([t]) => t === "IF")?.[1]).toContain("cm-keyword");
  });

  it("works without comments and with a line comment that is a word, as in Batch's REM", () => {
    const batch: KeywordLanguage = { ...tiny, commentLine: "REM", commentStart: null, commentEnd: null, caseInsensitive: true, sets: [["keyword", "echo set"]] };
    const out = classesOf("REM note\nECHO hi", batch);
    expect(out[0]).toEqual(["REM note", expect.stringContaining("cm-comment")]);
    expect(out.find(([t]) => t === "ECHO")?.[1]).toContain("cm-keyword");
    const none: KeywordLanguage = { ...tiny, commentLine: null, commentStart: null, commentEnd: null };
    expect(classesOf("// not a comment", none).find(([t]) => t === "//")?.[1]).toContain("cm-operator");
  });

  it("the first set that names a word wins", () => {
    const dup: KeywordLanguage = { ...tiny, sets: [["keyword", "x"], ["type", "x"]] };
    expect(classesOf("x", dup)[0]?.[1]).toContain("cm-keyword");
  });
});

describe("the generated Notepad++ tables", () => {
  it("has 25 languages, each with extensions, a name and at least the comment syntax or one keyword set", () => {
    // 27 until 2026-09-07: makefile and txt2tags have no keywords in Notepad++'s table and got modes of their own.
    expect(NPP_LANGUAGES).toHaveLength(25);
    expect(NPP_LANGUAGES.map((l) => l.id)).not.toContain("makefile");
    expect(NPP_LANGUAGES.map((l) => l.id)).not.toContain("txt2tags");
    for (const l of NPP_LANGUAGES) {
      expect(l.extensions.length, l.id).toBeGreaterThan(0);
      expect(l.name.length, l.id).toBeGreaterThan(0);
      expect(l.sets.length > 0 || l.commentLine !== null || l.commentStart !== null, l.id).toBe(true);
      for (const [role, words] of l.sets) {
        expect(["keyword", "builtin", "type", "constant", "property", "meta", "special"]).toContain(role);
        expect(words.trim().length).toBeGreaterThan(0);
      }
    }
    expect(NPP_LANGUAGES.map((l) => l.id)).not.toContain("hollywood");
    expect(NPP_LANGUAGES.find((l) => l.id === "batch")).toMatchObject({ caseInsensitive: true, commentLine: "REM", extensions: ["bat", "cmd"] });
  });

  it("every table is a valid definition by the JSON rules, so a vault file can copy one", () => {
    for (const l of NPP_LANGUAGES) {
      const r = parseKeywordLanguage(JSON.parse(JSON.stringify(l)), l.id);
      expect("language" in r, l.id).toBe(true);
    }
  });

  it("Batch keywords colour a real line", () => {
    const batch = NPP_LANGUAGES.find((l) => l.id === "batch");
    if (!batch) throw new Error("no batch");
    const by = new Map(classesOf("@echo off\nset COUNT=3\nREM x\nif exist a.txt goto done", batch));
    expect(by.get("echo")).toContain("cm-keyword");
    expect(by.get("set")).toContain("cm-keyword");
    expect(by.get("REM x")).toContain("cm-comment");
    expect(by.get("goto")).toContain("cm-keyword");
  });
});

describe("parseKeywordLanguage", () => {
  it("accepts the documented shape, with words as a string or a list, and fills the id", () => {
    const r = parseKeywordLanguage({ name: "X", extensions: [".X", "xx"], commentLine: "#", sets: [["keyword", ["a", "b"]], ["type", "c d"]] }, "x-file");
    expect(r).toEqual({
      language: { id: "x-file", name: "X", extensions: ["x", "xx"], caseInsensitive: false, commentLine: "#", commentStart: null, commentEnd: null, sets: [["keyword", "a b"], ["type", "c d"]] },
    });
  });
  it("names what is wrong", () => {
    expect(parseKeywordLanguage(null, "f")).toEqual({ error: "not an object" });
    expect(parseKeywordLanguage({ extensions: ["x"] }, "f")).toEqual({ error: "name is missing" });
    expect(parseKeywordLanguage({ name: "X", extensions: [] }, "f")).toMatchObject({ error: expect.stringContaining("extensions") });
    expect(parseKeywordLanguage({ name: "X", extensions: ["x"], commentStart: "/*" }, "f")).toMatchObject({ error: expect.stringContaining("go together") });
    expect(parseKeywordLanguage({ name: "X", extensions: ["x"], sets: [["colour", "a"]] }, "f")).toMatchObject({ error: expect.stringContaining("role") });
    expect(parseKeywordLanguage({ name: "X", extensions: ["x"], sets: [["keyword", 1]] }, "f")).toMatchObject({ error: expect.stringContaining("words") });
    expect(parseKeywordLanguage({ name: "X", extensions: ["x"], commentLines: "::" }, "f")).toMatchObject({ error: expect.stringContaining("commentLines") });
    expect(parseKeywordLanguage({ name: "X", extensions: ["x"], patterns: [{ regex: "(", token: "labelName" }] }, "f")).toMatchObject({ error: expect.stringContaining("not a valid regular expression") });
    expect(parseKeywordLanguage({ name: "X", extensions: ["x"], patterns: [{ token: "labelName" }] }, "f")).toMatchObject({ error: expect.stringContaining("regex string") });
  });

  it("accepts commentLines and patterns, which a vault file may use as Batch does", () => {
    const r = parseKeywordLanguage({ name: "X", extensions: ["x"], caseInsensitive: true, commentLine: "REM", commentLines: ["::"], patterns: [{ regex: ":\\w+", token: "labelName", sol: true }] }, "f");
    expect(r).toMatchObject({ language: { commentLines: ["::"], patterns: [{ regex: ":\\w+", token: "labelName", sol: true }] } });
    expect(parseKeywordLanguage({ name: "X", extensions: ["x"] }, "f")).not.toHaveProperty("language.commentLines");
  });
});
