import { describe, expect, it } from "vitest";
import { DEFAULT_WRAP_OPTIONS, describeWrap, wrapLine, wrapLines } from "../src/fmt/wrap";

const at = (width: number, breakWords = false) => ({ ...DEFAULT_WRAP_OPTIONS, width, breakWords });

const PARAGRAPH = "The quick brown fox jumps over the lazy dog while the five boxing wizards jump quickly, and every sentence here is long enough to be cut.";

describe("wrapLine", () => {
  it("cuts at spaces so that no line is longer than the width", () => {
    const lines = wrapLine(PARAGRAPH, 40, false);
    expect(lines.every((l) => l.length <= 40)).toBe(true);
    expect(lines.join(" ")).toBe(PARAGRAPH);
    expect(lines[0]).toBe("The quick brown fox jumps over the lazy");
  });

  it("keeps the indent on every line it makes", () => {
    const lines = wrapLine(`    ${PARAGRAPH}`, 40, false);
    expect(lines.every((l) => l.startsWith("    ") && l.length <= 40)).toBe(true);
    expect(lines.map((l) => l.slice(4)).join(" ")).toBe(PARAGRAPH);
  });

  it("a word longer than the room stands alone by default, and is cut into pieces when asked", () => {
    const text = "short Supercalifragilisticexpialidocious end";
    expect(wrapLine(text, 12, false)).toEqual(["short", "Supercalifragilisticexpialidocious", "end"]);
    expect(wrapLine(text, 12, true)).toEqual(["short", "Supercalifra", "gilisticexpi", "alidocious", "end"]);
    // The tail of a cut word shares its line with what follows.
    expect(wrapLine("Supercalifragilisticexpialidocious end", 12, true)).toEqual(["Supercalifra", "gilisticexpi", "alidocious", "end"]);
  });

  it("counts characters, not UTF-16 units: Cyrillic and emoji", () => {
    const cyrillic = "Одиннадцать лет жизни я отдал изучению алхимии и ничего не нашёл";
    const lines = wrapLine(cyrillic, 30, false);
    expect(lines.every((l) => Array.from(l).length <= 30)).toBe(true);
    expect(lines.join(" ")).toBe(cyrillic);
    expect(wrapLine("😀😀😀😀😀😀", 3, true)).toEqual(["😀😀😀", "😀😀😀"]);
  });

  it("collapses runs of spaces between words and drops trailing space", () => {
    expect(wrapLine("a  b   c ", 3, false)).toEqual(["a b", "c"]);
  });

  it("the width is inclusive, exactly", () => {
    expect(wrapLine("aaaa bbbb", 9, false)).toEqual(["aaaa bbbb"]);
    expect(wrapLine("aaaa bbbb", 8, false)).toEqual(["aaaa", "bbbb"]);
    expect(wrapLine("aaaa bbbb", 4, false)).toEqual(["aaaa", "bbbb"]);
    expect(wrapLine("aaaa bbbb", 3, true)).toEqual(["aaa", "a", "bbb", "b"]);
  });
});

describe("wrapLines", () => {
  it("cuts only the long ordinary lines and leaves structure, blank and short lines", () => {
    const input = ["# A heading that is longer than the width but a heading", "", PARAGRAPH, "short", "- a list item that is longer than the width and stays a single line", "> a quote that is longer than the width and stays", "```", "code that is longer than the width and stays as it is in the fence", "```", `  ${PARAGRAPH}`].join("\n");
    const result = wrapLines(input, at(40));
    const out = result.text.split("\n");
    expect(out[0]).toBe("# A heading that is longer than the width but a heading");
    expect(out[1]).toBe("");
    expect(out.slice(2, 6).every((l) => l.length <= 40)).toBe(true);
    expect(out.includes("short")).toBe(true);
    expect(out.includes("- a list item that is longer than the width and stays a single line")).toBe(true);
    expect(out.includes("> a quote that is longer than the width and stays")).toBe(true);
    expect(out.includes("code that is longer than the width and stays as it is in the fence")).toBe(true);
    expect(out.at(-1)?.startsWith("  ")).toBe(true);
    expect(result.wrapped).toBe(2);
    expect(result.added).toBe(out.length - input.split("\n").length);
  });

  it("changes nothing when every line fits, keeps CRLF, clamps the width", () => {
    const fits = ["short line", "", "another"].join("\r\n");
    expect(wrapLines(fits, at(40))).toEqual({ text: fits, wrapped: 0, added: 0 });
    const crlf = wrapLines(`${PARAGRAPH}\r\nnext`, at(40));
    expect(crlf.text.includes("\r\n")).toBe(true);
    expect(crlf.text.includes("\n") && !crlf.text.replace(/\r\n/g, "").includes("\n")).toBe(true);
    // Below the minimum the width is 10; a single overlong word stays one line and is not counted.
    expect(wrapLines("abcdefghijklmnop", at(1)).wrapped).toBe(0);
    expect(wrapLines("abcdefghijklmnop", at(1, true)).text).toBe("abcdefghij\nklmnop");
  });

  it("is the reverse of Unwrap on a paragraph: wrap, then the lines all fit", () => {
    const result = wrapLines(PARAGRAPH, at(60));
    expect(result.text.split("\n").every((l) => l.length <= 60)).toBe(true);
    expect(result.text.split("\n").join(" ")).toBe(PARAGRAPH);
  });

  it("describes what it did", () => {
    expect(describeWrap(null, 80)).toBe("Wrap lines: no line is longer than 80 characters.");
    expect(describeWrap({ text: "", wrapped: 0, added: 0 }, 72)).toBe("Wrap lines: no line is longer than 72 characters.");
    expect(describeWrap({ text: "", wrapped: 1, added: 1 }, 72)).toBe("Wrap lines: 1 line cut at 72 characters, 1 line break added.");
    expect(describeWrap({ text: "", wrapped: 3, added: 7 }, 72)).toBe("Wrap lines: 3 lines cut at 72 characters, 7 line breaks added.");
  });
});
