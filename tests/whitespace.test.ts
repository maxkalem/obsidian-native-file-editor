import { describe, expect, it } from "vitest";
import { __allEntries, isProseLanguage } from "../src/highlight/registry";
import { NO_LANGUAGE_RULE, UNKNOWN_RULE, asiLanguages, ruledLanguages, whitespaceRuleFor } from "../src/fmt/whitespace";

/**
 * The classification is only worth having if it is complete, so this file
 * fails both ways: on a language the registry knows and the table forgot, and
 * on a row the registry has no language for. A new language cannot be added
 * without deciding what Compress may do to it.
 */

const REGISTRY_NAMES = [...new Set(__allEntries().map((e) => e.name))];

describe("the whitespace classification", () => {
  it("covers every language the registry has", () => {
    const missing = REGISTRY_NAMES.filter((name) => !ruledLanguages().includes(name));
    expect(missing).toEqual([]);
  });

  it("has no row for a language the registry does not have", () => {
    const orphans = ruledLanguages().filter((name) => !REGISTRY_NAMES.includes(name));
    expect(orphans).toEqual([]);
  });

  it("decides one of the three classes for each of them", () => {
    for (const name of REGISTRY_NAMES) {
      expect(["free", "significant", "none"], name).toContain(whitespaceRuleFor(name).whitespace);
    }
  });

  it("keeps the two caveats for the free languages only", () => {
    for (const name of REGISTRY_NAMES) {
      const rule = whitespaceRuleFor(name);
      if (rule.whitespace === "free") continue;
      expect(rule.runs, name).toBeUndefined();
      expect(rule.lineBreaks, name).toBeUndefined();
    }
  });

  it("explains itself wherever the answer is not the plain one", () => {
    for (const name of REGISTRY_NAMES) {
      const rule = whitespaceRuleFor(name);
      if (rule.whitespace === "none" || rule.runs === "single") expect(rule.note, name).toBeTruthy();
    }
  });
});

describe("the caveat lists", () => {
  it("names the languages where a newline can end a statement", () => {
    const asi = asiLanguages();
    for (const name of ["JavaScript", "TypeScript", "TSX", "Go", "Kotlin", "Swift", "Ruby"]) expect(asi, name).toContain(name);
    // A language that writes its own separators is not on it.
    for (const name of ["Java", "Rust", "JSON", "CSS"]) expect(asi, name).not.toContain(name);
  });

  it("reads the list out of the table rather than from a second copy", () => {
    for (const name of asiLanguages()) expect(whitespaceRuleFor(name).lineBreaks, name).toBe("statements");
  });
});

describe("the classes themselves", () => {
  it("frees the languages that write their own separators", () => {
    for (const name of ["JSON", "XML", "CSS", "Rust", "Java", "SQL"]) expect(whitespaceRuleFor(name).whitespace, name).toBe("free");
  });

  it("protects indentation where it is the syntax", () => {
    for (const name of ["Python", "YAML", "Haskell", "Makefile", "Fortran", "COBOL"]) expect(whitespaceRuleFor(name).whitespace, name).toBe("significant");
  });

  it("refuses the record formats", () => {
    for (const name of ["Diff", "Intel HEX", "Motorola S-record", "MHTML", "mbox", "Log", "NFO"]) expect(whitespaceRuleFor(name).whitespace, name).toBe("none");
  });

  it("collapses a run to one space where whitespace separates the tokens", () => {
    for (const name of ["Forth", "Factor", "PostScript", "Tcl", "REBOL", "APL", "Raku"]) expect(whitespaceRuleFor(name).runs, name).toBe("single");
  });

  it("keeps the line break of a preprocessor directive", () => {
    for (const name of ["C/C++", "C#", "Objective-C", "Shader", "Verilog"]) expect(whitespaceRuleFor(name).lineBreaks, name).toBe("directives");
  });

  it("never frees a language that is read as prose", () => {
    for (const name of REGISTRY_NAMES) {
      if (isProseLanguage(name)) expect(whitespaceRuleFor(name).whitespace, name).not.toBe("free");
    }
  });
});

describe("a language the table cannot know", () => {
  it("gives a definition from the vault the cautious row", () => {
    expect(whitespaceRuleFor("A language of the user's own")).toBe(UNKNOWN_RULE);
    expect(UNKNOWN_RULE.whitespace).toBe("significant");
  });

  it("reads a file with no language as text", () => {
    expect(whitespaceRuleFor(null)).toBe(NO_LANGUAGE_RULE);
    expect(NO_LANGUAGE_RULE.whitespace).toBe("significant");
  });

  it("does not inherit a row from a name that only looks alike", () => {
    expect(whitespaceRuleFor("javascript").whitespace).toBe("significant");
    expect(whitespaceRuleFor("toString")).toBe(UNKNOWN_RULE);
  });
});
