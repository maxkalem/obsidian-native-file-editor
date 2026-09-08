import { describe, expect, it } from "vitest";
import { adaptStreamParser, cm5Classes, forkLineHighlighter, forkTokenClassProp, isObsidianStreamFork, toCm5Token } from "../src/highlight/obsidianFork";
import { logMode } from "../src/highlight/logMode";

/**
 * Against npm's @codemirror/language the fork exports are absent, so this
 * suite proves the vocabulary mapping and that everything else is a no-op. The
 * fork itself can only be exercised on the device; the load-time self-test
 * reports what it finds there.
 */

describe("Obsidian fork detection", () => {
  it("sees no fork in the npm package and leaves parsers alone", () => {
    expect(isObsidianStreamFork).toBe(false);
    expect(forkTokenClassProp).toBeNull();
    expect(forkLineHighlighter).toBeNull();
    expect(adaptStreamParser(logMode)).toBe(logMode);
  });
});

describe("toCm5Token", () => {
  it("maps modern tag names and dotted legacy-mode forms to the CM5 classes Obsidian styles", () => {
    expect(toCm5Token("keyword")).toBe("keyword");
    expect(toCm5Token("variableName.standard")).toBe("builtin");
    expect(toCm5Token("string.special")).toBe("string-2");
    expect(toCm5Token("variableName.definition")).toBe("def");
    expect(toCm5Token("invalid")).toBe("error");
    expect(toCm5Token("propertyName")).toBe("property");
    expect(toCm5Token("typeName")).toBe("type");
    expect(toCm5Token("changed")).toBe("qualifier");
    expect(toCm5Token("atom")).toBe("atom");
    expect(toCm5Token("comment")).toBe("comment");
  });

  it("keeps CM5 names Obsidian styles and the fork's line styles as they are", () => {
    expect(toCm5Token("builtin")).toBe("builtin");
    expect(toCm5Token("variable-2")).toBe("variable-2");
    expect(toCm5Token("def")).toBe("def");
    expect(toCm5Token("header")).toBe("header");
    expect(toCm5Token("hr")).toBe("hr");
    expect(toCm5Token("line-background-x")).toBe("line-background-x");
    expect(toCm5Token("keyword  string")).toBe("keyword string");
  });

  it("resolves a modern name the table does not list through the tag hierarchy, as npm's StreamLanguage does", () => {
    // LiveScript returns operatorKeyword; its set is operatorKeyword > keyword.
    expect(toCm5Token("operatorKeyword")).toBe("keyword");
    expect(toCm5Token("angleBracket")).toBe("bracket");
    expect(toCm5Token("labelName")).toBe("variable-2");
    expect(toCm5Token("variableName.function.standard")).toBe("def");
    expect(toCm5Token("heading1")).toBe("header");
    expect(toCm5Token("attributeValue")).toBe("string");
  });

  it("drops a name nothing styles instead of emitting cm-<name>: `content` is CodeMirror's own container class", () => {
    // 2026-09-07: the LiveScript mode names whitespace `content`; `cm-content` made every space a line break.
    expect(toCm5Token("content")).toBe("");
    expect(toCm5Token("paren")).toBe("bracket");
    expect(toCm5Token("mystery")).toBe("");
    expect(toCm5Token("mystery.thing")).toBe("");
    expect(toCm5Token("keyword content")).toBe("keyword");
    expect(toCm5Token("scroller gutter line cursor")).toBe("");
  });
});

describe("cm5Classes", () => {
  it("emits the cm-* class and the matching nfe-tok-* names", () => {
    expect(cm5Classes("keyword")).toBe("cm-keyword nfe-tok-keyword");
    expect(cm5Classes("error")).toBe("cm-error nfe-tok-invalid");
    expect(cm5Classes("builtin")).toBe("cm-builtin nfe-tok-builtin");
    expect(cm5Classes("weird")).toBe("cm-weird");
    expect(cm5Classes("")).toBeNull();
  });
});
