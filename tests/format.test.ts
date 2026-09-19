import { describe, expect, it } from "vitest";
import { compressOwn, detectIndentUnit, formatOwn, planCompress, planFormat, styleFor } from "../src/fmt/format";

/**
 * Which formatter serves a file, and what it formats with. The plan is asked
 * of the language and of the editor (does anything indent this?), never of a
 * generated table, and the indent unit is read from the file before the
 * settings are consulted (USER 2026-09-19).
 */

describe("which formatter serves a file", () => {
  it("prefers the plugin's own formatter where it has one", () => {
    expect(planFormat("JSON", false)).toEqual({ kind: "own" });
    expect(planCompress("JSON")).toEqual({ kind: "own" });
  });

  it("falls back to indentation when the language provides it", () => {
    expect(planFormat("Rust", true)).toEqual({ kind: "indent" });
    // The own formatter wins even where indentation exists too.
    expect(planFormat("JSON", true).kind).toBe("own");
  });

  it("puts an installed formatter before indentation, and a file that WOULD serve before it too", () => {
    // The installed file reprints the code; indentation only moves it sideways.
    expect(planFormat("PHP", true, true, true)).toEqual({ kind: "vault" });
    // Nothing installed, but the repository ships a file for it: the row stays
    // and explains what to copy, instead of quietly doing half the job.
    expect(planFormat("PHP", true, false, true)).toEqual({ kind: "installable" });
  });

  it("says nothing can do it, and the menu then shows no row at all (USER 2026-09-19)", () => {
    expect(planFormat("Makefile", false).kind).toBe("none");
    expect(planCompress("Rust").kind).toBe("none");
    // A file with no language at all is the same case.
    expect(planFormat(null, false).kind).toBe("none");
  });

  it("runs the own formatter only for its own formats", () => {
    expect(formatOwn("Rust", "fn main(){}", { indent: "  ", eol: "\n" })).toBeNull();
    expect(compressOwn("Rust", "fn main(){}", { indent: "  ", eol: "\n" })).toBeNull();
    expect(formatOwn("JSON", '{"a":1}', { indent: "  ", eol: "\n" })?.text).toBe('{\n  "a": 1\n}');
  });
});

describe("the indent to format with", () => {
  it("is the file's own, whatever the setting says", () => {
    expect(detectIndentUnit("function f() {\n  if (x) {\n    return 1;\n  }\n}\n", "    ")).toBe("  ");
    expect(detectIndentUnit("function f() {\n\tif (x) {\n\t\treturn 1;\n\t}\n}\n", "    ")).toBe("\t");
    expect(detectIndentUnit("a:\n    b: 1\n    c: 2\n", "  ")).toBe("    ");
  });

  it("is the setting when the file cannot say", () => {
    expect(detectIndentUnit("one\ntwo\nthree\n", "    ")).toBe("    ");
    expect(detectIndentUnit("", "\t")).toBe("\t");
    // An indent nobody writes (nine spaces on every line) is not a convention.
    expect(detectIndentUnit("x\n         y\n", "  ")).toBe("  ");
  });

  it("takes the line ending from the file too", () => {
    expect(styleFor('{"a":1}\r\n', "  ")).toEqual({ indent: "  ", eol: "\r\n" });
    expect(styleFor('{\n  "a": 1\n}\n', "\t")).toEqual({ indent: "  ", eol: "\n" });
  });
});
