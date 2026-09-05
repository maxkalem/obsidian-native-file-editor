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

  it("keeps CM5 names and line styles as they are, and falls back to the base of an unknown dotted name", () => {
    expect(toCm5Token("builtin")).toBe("builtin");
    expect(toCm5Token("variable-2")).toBe("variable-2");
    expect(toCm5Token("line-background-x")).toBe("line-background-x");
    expect(toCm5Token("mystery.thing")).toBe("mystery");
    expect(toCm5Token("keyword  string")).toBe("keyword string");
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
