import { describe, expect, it } from "vitest";
import { changeCase, formatDate, formatDateTime, invertCase, menuExcerpt, sentenceCase, titleCase, webSearchUrl } from "../src/core/editText";

describe("case changes for the context menu", () => {
  it("UPPERCASE and lowercase, Unicode-aware", () => {
    expect(changeCase("Привіт, world", "upper")).toBe("ПРИВІТ, WORLD");
    expect(changeCase("Привіт, WORLD", "lower")).toBe("привіт, world");
  });

  it("Title Case: the first letter of every word up, the rest down, apostrophes inside a word", () => {
    expect(titleCase("hello WORLD, it's o'clock")).toBe("Hello World, It's O'clock");
    expect(titleCase("мій_код 2nd x")).toBe("Мій_код 2nd X");
    expect(changeCase("a-b", "title")).toBe("A-B");
  });

  it("Sentence case: everything down, the first letter of the text and of every sentence up, quotes kept", () => {
    expect(sentenceCase("HELLO world. THIS is it! really? yes… \"quoted\" one")).toBe('Hello world. This is it! Really? Yes… "Quoted" one');
    expect(sentenceCase("first line\n\nSECOND paragraph")).toBe("First line\n\nSecond paragraph");
    expect(sentenceCase("  leading spaces")).toBe("  Leading spaces");
    expect(sentenceCase("")).toBe("");
  });

  it("iNVERT cASE swaps every letter and leaves the rest", () => {
    expect(invertCase("Hello, Світ 42")).toBe("hELLO, сВІТ 42");
    expect(changeCase("ab", "invert")).toBe("AB");
  });
});

describe("dates and the web search", () => {
  it("formats the local date and time in the sortable order", () => {
    const d = new Date(2026, 8, 9, 17, 1, 25);
    expect(formatDate(d)).toBe("2026-09-09");
    expect(formatDateTime(d)).toBe("2026-09-09 17:01:25");
    expect(formatDateTime(new Date(2026, 0, 1, 0, 0, 0))).toBe("2026-01-01 00:00:00");
  });

  it("builds the search address from the trimmed selection, encoded", () => {
    expect(webSearchUrl("  hello world & co  ")).toBe("https://www.google.com/search?q=hello%20world%20%26%20co");
  });

  it("the menu excerpt is one line, cut with an ellipsis", () => {
    expect(menuExcerpt("a  b\n\tc")).toBe("a b c");
    expect(menuExcerpt("x".repeat(40))).toBe(`${"x".repeat(29)}…`);
    expect(menuExcerpt("x".repeat(30))).toBe("x".repeat(30));
  });
});
