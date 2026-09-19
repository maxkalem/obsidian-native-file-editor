import { describe, expect, it } from "vitest";
import { compressJson, formatJson, scanJson } from "../src/fmt/json";

/**
 * The plugin's own JSON formatter: the user's reference is Notepad++'s
 * JSONViewer, with comments KEPT (his rule, 2026-09-19). What a parse would
 * throw away — the order of the keys, the spelling of the numbers, the
 * escapes — is kept too, because the formatter never builds a value tree.
 */

const style = { indent: "  ", eol: "\n" };

describe("the JSON scanner", () => {
  it("reads strings, numbers, literals and both kinds of comment, and remembers where a line ended", () => {
    const { tokens, problem } = scanJson('{"a": 1, // one\n "b": [true, null] /* two */}');
    expect(problem).toBeNull();
    expect(tokens.map((t) => t.kind)).toEqual(["open", "string", "colon", "number", "comma", "line-comment", "string", "colon", "open", "literal", "comma", "literal", "close", "block-comment", "close"]);
    // The comment after `1,` stood on that line; the key after it did not.
    expect(tokens[5]?.newlineBefore).toBe(false);
    expect(tokens[6]?.newlineBefore).toBe(true);
  });

  it("says where it stopped instead of guessing", () => {
    expect(scanJson('{"a": "unterminated}').problem?.reason).toBe("unterminated string");
    expect(scanJson("{/* open").problem?.reason).toBe("unterminated comment");
    expect(scanJson("{@}").problem?.reason).toBe('unexpected "@"');
  });
});

describe("Format on JSON", () => {
  it("puts one value on a line and keeps an empty object or array on its own", () => {
    expect(formatJson('{"a":1,"b":{"c":[1,2]},"d":{},"e":[]}', style).text).toBe(
      ['{', '  "a": 1,', '  "b": {', '    "c": [', "      1,", "      2", "    ]", "  },", '  "d": {},', '  "e": []', "}"].join("\n")
    );
  });

  it("keeps the comments, a trailing one where it was and a standing one on its own line", () => {
    const out = formatJson('{\n// about a\n"a": 1, // trailing\n"b": 2\n}', style).text;
    expect(out).toBe(['{', "  // about a", '  "a": 1, // trailing', '  "b": 2', "}"].join("\n"));
  });

  it("keeps the number as it was written and the string as it was escaped", () => {
    const out = formatJson('{"n":1.50,"e":1e3,"z":-0,"s":"a\\u00e9\\\\b"}', style).text;
    expect(out).toContain('"n": 1.50');
    expect(out).toContain('"e": 1e3');
    expect(out).toContain('"z": -0');
    expect(out).toContain('"s": "a\\u00e9\\\\b"');
  });

  it("formatting twice is formatting once", () => {
    const once = formatJson('{"a":[1,{"b":2}],"c":"x"}', style).text;
    expect(formatJson(once, style).text).toBe(once);
  });

  it("uses the indent and the line ending it was given", () => {
    const out = formatJson('{"a":1}', { indent: "\t", eol: "\r\n" }).text;
    expect(out).toBe('{\r\n\t"a": 1\r\n}');
  });

  it("leaves a file it cannot read alone and says why", () => {
    const broken = '{"a": }x@';
    const result = formatJson(broken, style);
    expect(result.text).toBe(broken);
    expect(result.problem).toContain("unexpected");
  });
});

describe("Compress on JSON", () => {
  it("removes every space between tokens", () => {
    expect(compressJson('{\n  "a": 1,\n  "b": [ 1, 2 ]\n}', style).text).toBe('{"a":1,"b":[1,2]}');
  });

  it("keeps a block comment as it is and turns a line comment into one, so nothing is swallowed", () => {
    expect(compressJson('{\n// one\n"a": 1 /* two */\n}', style).text).toBe('{/* one */"a":1/* two */}');
  });

  it("keeps the line break when a line comment cannot become a block comment", () => {
    expect(compressJson('{\n// ends with */\n"a": 1\n}', style).text).toBe('{// ends with */\n"a":1}');
  });

  it("leaves a file it cannot read alone", () => {
    const broken = '{"a": "no end';
    expect(compressJson(broken, style)).toEqual({ text: broken, problem: "unterminated string at 6" });
  });
});
