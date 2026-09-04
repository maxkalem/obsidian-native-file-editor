import { describe, expect, it } from "vitest";
import { OBSIDIAN_OWNED_EXTENSIONS } from "../src/constants";
import { __allEntries, languageFor, registeredExtensions, resolveLanguage } from "../src/highlight/registry";

/**
 * What the two plugins this one replaces register, read 2026-09-04 (handoff
 * §17). A user switching to Native File Editor must not lose a file type.
 */
const CM_CODE_EDITOR = "ts js py css scss less html json xml svg xsl xsd sql yaml yml rs go c cpp h java php sh rb lua toml r ps1 dockerfile swift".split(" ");
const OBSIDIAN_CODE_EDITOR =
  "js ts jsx tsx py rb go rs java c cpp h cs php swift kt scala lua pl r m mm json yaml yml toml xml ini env conf html htm css scss sass less sh bash zsh fish ps1 bat cmd sql graphql dockerfile makefile gitignore txt log".split(" ");

/**
 * Still uncovered, each with the tier that will cover it. This list shrinks;
 * an extension may leave it only by entering the registry.
 */
const NOT_YET_COVERED: Record<string, string> = {
  graphql: "tier 3 (cm6-graphql)",
  bat: "tier 4 (Notepad++ batch keywords)",
  cmd: "tier 4 (Notepad++ batch keywords)",
  makefile: "tier 4 (Notepad++ makefile keywords)",
  svg: "Obsidian owns it (image view)",
};

describe("language registry", () => {
  it("has no duplicate extension across entries", () => {
    const seen = new Map<string, string>();
    for (const e of __allEntries()) {
      for (const ext of e.extensions) {
        expect(seen.get(ext), `.${ext} in both ${seen.get(ext)} and ${e.name}`).toBeUndefined();
        seen.set(ext, e.name);
      }
    }
  });

  it("names extensions lower-case without a dot", () => {
    for (const ext of registeredExtensions()) expect(ext).toMatch(/^[a-z0-9_+-]+$/);
  });

  it("never lists an extension Obsidian owns", () => {
    for (const ext of registeredExtensions()) expect(OBSIDIAN_OWNED_EXTENSIONS.has(ext), ext).toBe(false);
  });

  it("looks up case-insensitively and returns null for the unknown", () => {
    expect(languageFor("TXT")?.name).toBe("Plain text");
    expect(languageFor("Py")?.name).toBe("Python");
    expect(languageFor("nope")).toBeNull();
  });

  it("covers every extension the two replaced plugins register, minus the documented remainder", () => {
    const union = [...new Set([...CM_CODE_EDITOR, ...OBSIDIAN_CODE_EDITOR])];
    const missing = union.filter((ext) => languageFor(ext) === null && !(ext in NOT_YET_COVERED));
    expect(missing).toEqual([]);
    // The remainder list may not hide something that is in fact covered.
    for (const ext of Object.keys(NOT_YET_COVERED)) expect(languageFor(ext), ext).toBeNull();
  });

  it("tier 1 wins where tier 2 also offers the language", () => {
    for (const ext of ["js", "ts", "json", "py", "css", "html", "xml", "yaml", "sql", "rs", "go", "java", "c", "cpp"]) {
      expect(languageFor(ext)?.source, ext).toBe("lezer");
    }
    for (const ext of ["cs", "kt", "sh", "ini", "toml", "lua", "rb", "ps1", "swift", "r"]) {
      expect(languageFor(ext)?.source, ext).toBe("legacy");
    }
  });

  it("every entry with a source resolves to a Language, once", () => {
    for (const e of __allEntries()) {
      if (e.source === null) {
        expect(e.load).toBeNull();
        expect(resolveLanguage(e)).toBeNull();
        continue;
      }
      const first = resolveLanguage(e);
      expect(first, e.name).not.toBeNull();
      expect(first?.language.parser, e.name).toBeDefined();
      expect(resolveLanguage(e)).toBe(first);
    }
  });

  it("is large enough to be the one plugin for every language", () => {
    expect(registeredExtensions().length).toBeGreaterThan(200);
    expect(__allEntries().filter((e) => e.source === "lezer").length).toBeGreaterThanOrEqual(14);
    expect(__allEntries().filter((e) => e.source === "legacy").length).toBeGreaterThanOrEqual(90);
  });
});
