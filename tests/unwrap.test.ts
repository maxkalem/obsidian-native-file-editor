import { describe, expect, it } from "vitest";
import { DEFAULT_UNWRAP_OPTIONS, columns, describeUnwrap, restoreHyphens, measureWrapWidth, unwrapLines } from "../src/fmt/unwrap";
import { buildLexicon } from "../src/fmt/dictionary";

// A book annotation as a PDF hands it over: a page number, a title and a
// heading on lines of their own, then one paragraph cut every ~90 characters
// with one line the source had already half-joined.
const ANNOTATION_WRAPPED = [
  "2",
  "Пауло Коэльо: «Алхимик»",
  "Аннотация",
  "Одиннадцать лет жизни я отдал изучению алхимии. Уже одна возможность превращать металл",
  "в золото или открыть Эликсир Бессмертия слишком соблазнительна для всякого, кто делает первые",
  "шаги в магии. Признаюсь, что Эликсир произвел на меня впечатление более сильное, ибо до тех пор, пока",
  "я не осознал и не прочувствовал существования Бога, мысль о том, что когда-нибудь все кончится",
  "навсегда, казалась мне непереносимой. Так что, узнав о возможности создать некую жидкость, способную на многие-многие годы продлить наше земное бытие, я решил всецело посвятить себя изготовлению",
  "этого эликсира.",
].join("\n");

const ANNOTATION_UNWRAPPED = [
  "2",
  "Пауло Коэльо: «Алхимик»",
  "Аннотация",
  "Одиннадцать лет жизни я отдал изучению алхимии. Уже одна возможность превращать металл в золото или открыть Эликсир Бессмертия слишком соблазнительна для всякого, кто делает первые шаги в магии. Признаюсь, что Эликсир произвел на меня впечатление более сильное, ибо до тех пор, пока я не осознал и не прочувствовал существования Бога, мысль о том, что когда-нибудь все кончится навсегда, казалась мне непереносимой. Так что, узнав о возможности создать некую жидкость, способную на многие-многие годы продлить наше земное бытие, я решил всецело посвятить себя изготовлению этого эликсира.",
].join("\n");

const plain = { ...DEFAULT_UNWRAP_OPTIONS, markdown: false };

describe("unwrapLines on the acceptance sample", () => {
  it("joins the paragraph and leaves the page number, title and heading on their lines", () => {
    const result = unwrapLines(ANNOTATION_WRAPPED);
    expect(result.text).toBe(ANNOTATION_UNWRAPPED);
    expect(result.joined).toBe(5);
    expect(result.dehyphenated).toBe(0);
    expect(result.width).toBe(101);
    expect(result.refused).toBeNull();
  });

  it("does the same as plain text and is idempotent", () => {
    expect(unwrapLines(ANNOTATION_WRAPPED, plain).text).toBe(ANNOTATION_UNWRAPPED);
    const once = unwrapLines(ANNOTATION_WRAPPED).text;
    const twice = unwrapLines(once);
    expect(twice.text).toBe(once);
    expect(twice.joined).toBe(0);
  });

  it("keeps CRLF line endings", () => {
    const result = unwrapLines(ANNOTATION_WRAPPED.replace(/\n/g, "\r\n"));
    expect(result.text).toBe(ANNOTATION_UNWRAPPED.replace(/\n/g, "\r\n"));
    expect(result.joined).toBe(5);
  });
});

const WRAP = 72;
/** Wrap `words` greedily at WRAP columns, the way a mail client does. */
function wrap(text: string, width = WRAP): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line.length > 0 && line.length + 1 + word.length > width) {
      out.push(line);
      line = word;
    } else line = line.length === 0 ? word : `${line} ${word}`;
  }
  if (line.length > 0) out.push(line);
  return out;
}

const PARAGRAPH_A =
  "The quick brown fox jumps over the lazy dog while the five boxing wizards jump quickly, and every sentence in this paragraph is here only to be long enough to wrap several times at the chosen width.";
const PARAGRAPH_B =
  "A second paragraph follows without a blank line between them; its first line starts with a capital letter after a full stop, and the last line of the one before is short.";

describe("unwrapLines and Markdown structure", () => {
  it("joins wrapped paragraphs between headings, lists, quotes, tables and fences without touching them", () => {
    const input = [
      "---",
      "title: A note",
      "tags: [x]",
      "---",
      "# Heading one",
      "",
      ...wrap(PARAGRAPH_A),
      "",
      "- a list item that is long enough to be measured as a line of the paragraph width",
      "- another item",
      "1. numbered",
      "2\\. numbered with the backslash a converter leaves, long enough to be measured too",
      "> a quote line that is long enough to be measured as a line of the paragraph width",
      "| a | table | row that is long enough to be measured as a line of the width |",
      "a table row without a leading pipe | still a table | row that is long enough",
      "![](image.png)",
      "```",
      "code that is long enough to be measured as a line of the paragraph width",
      "more code",
      "```",
      "",
      "    indented code that is long enough to be measured as a line of the width",
      "",
      "Setext heading",
      "==============",
      "",
      ...wrap(PARAGRAPH_B),
      "",
      "---",
      "<div>",
      "[ref]: https://example.com",
    ].join("\n");
    const result = unwrapLines(input);
    const expected = [
      "---",
      "title: A note",
      "tags: [x]",
      "---",
      "# Heading one",
      "",
      PARAGRAPH_A,
      "",
      "- a list item that is long enough to be measured as a line of the paragraph width",
      "- another item",
      "1. numbered",
      "2\\. numbered with the backslash a converter leaves, long enough to be measured too",
      "> a quote line that is long enough to be measured as a line of the paragraph width",
      "| a | table | row that is long enough to be measured as a line of the width |",
      "a table row without a leading pipe | still a table | row that is long enough",
      "![](image.png)",
      "```",
      "code that is long enough to be measured as a line of the paragraph width",
      "more code",
      "```",
      "",
      "    indented code that is long enough to be measured as a line of the width",
      "",
      "Setext heading",
      "==============",
      "",
      PARAGRAPH_B,
      "",
      "---",
      "<div>",
      "[ref]: https://example.com",
    ].join("\n");
    expect(result.text).toBe(expected);
    expect(result.joined).toBe(wrap(PARAGRAPH_A).length - 1 + wrap(PARAGRAPH_B).length - 1);
  });

  it("a hard line break (two trailing spaces or a backslash) is the author's and stays", () => {
    const lines = wrap(`${PARAGRAPH_A} ${PARAGRAPH_B}`);
    expect(lines.length).toBeGreaterThan(4);
    lines[1] = `${lines[1]}  `;
    lines[2] = `${lines[2]}\\`;
    const result = unwrapLines(lines.join("\n"));
    const out = result.text.split("\n");
    expect(out).toHaveLength(3);
    expect(out[0]).toBe(`${lines[0]} ${lines[1]}`);
    expect(out[1]).toBe(lines[2]);
    expect(out[2]).toBe(lines.slice(3).join(" "));
  });

  it("an indented first line joins the flush lines after it and loses its indent in Markdown, not in plain text", () => {
    const lines = wrap(PARAGRAPH_A);
    lines[0] = `     ${lines[0]}`;
    expect(unwrapLines(lines.join("\n")).text).toBe(PARAGRAPH_A);
    expect(unwrapLines(lines.join("\n"), plain).text).toBe(`     ${PARAGRAPH_A}`);
    // A real code block: after a blank line, several indented lines, a blank after.
    const code = ["Intro paragraph line that is long enough to be measured for the width here", "", "    const a = 1; // a code line that is long enough to be measured as well", "    const b = 2;", "", ...wrap(PARAGRAPH_B)].join("\n");
    const result = unwrapLines(code);
    expect(result.text).toBe(["Intro paragraph line that is long enough to be measured for the width here", "", "    const a = 1; // a code line that is long enough to be measured as well", "    const b = 2;", "", PARAGRAPH_B].join("\n"));
  });

  it("a line that starts as dialogue (an en dash) begins a paragraph", () => {
    const lines = [...wrap(PARAGRAPH_A).slice(0, -1), "and this is where the narrator stops and the speaker starts talking:", "– Existe three kinds of alchemists, he said, and this line goes on for a bit more."];
    const result = unwrapLines(lines.join("\n"));
    expect(result.text.split("\n").at(-1)).toBe("– Existe three kinds of alchemists, he said, and this line goes on for a bit more.");
  });
});

describe("unwrapLines and spaced text (a blank line after every wrapped line)", () => {
  const spaced = (paragraphs: string[]): string => paragraphs.map((p) => wrap(p, 80).join("\n\n")).join("\n\n");

  it("treats the single blank line between wrapped lines as part of the wrap, and keeps the paragraph gap", () => {
    const result = unwrapLines(spaced([PARAGRAPH_A, PARAGRAPH_B]));
    expect(result.text).toBe([PARAGRAPH_A, "", PARAGRAPH_B].join("\n"));
    expect(result.joined).toBe(wrap(PARAGRAPH_A, 80).length - 1 + wrap(PARAGRAPH_B, 80).length - 1);
  });

  it("leaves a normal note with blank lines between wrapped paragraphs in the adjacent mode", () => {
    const input = [...wrap(PARAGRAPH_A), "", ...wrap(PARAGRAPH_B)].join("\n");
    expect(unwrapLines(input).text).toBe([PARAGRAPH_A, "", PARAGRAPH_B].join("\n"));
  });
});

describe("unwrapLines at paragraph boundaries without a blank line", () => {
  it("does not join a short last line to the next paragraph", () => {
    const first = wrap(PARAGRAPH_A).slice(0, -1);
    const lines = [...first, "and it ends here", ...wrap(PARAGRAPH_B)];
    expect(unwrapLines(lines.join("\n")).text).toBe([[...first, "and it ends here"].join(" "), PARAGRAPH_B].join("\n"));
  });

  it("does not join a line that ends a sentence when the next word would have fit on it", () => {
    const first = wrap(PARAGRAPH_A).slice(0, -1);
    // A last line that is fairly long, ends with a full stop and leaves room for "A".
    const lastLine = "and this last line of the paragraph is long, but it ends here.";
    expect(lastLine.length).toBeGreaterThan(WRAP * 0.6);
    expect(lastLine.length + 2).toBeLessThanOrEqual(WRAP);
    const input = [...first, lastLine, ...wrap(PARAGRAPH_B)].join("\n");
    const result = unwrapLines(input);
    expect(result.text.split("\n")).toEqual([[...first, lastLine].join(" "), PARAGRAPH_B]);
  });

  it("joins a line that ends a sentence when the next word had no room on it", () => {
    const first = wrap(PARAGRAPH_A).slice(0, -1);
    const full = "this line is filled right up to the wrap width and ends a sentence.";
    expect(full.length + 1 + "Whatever".length).toBeGreaterThan(WRAP);
    const input = [...first, full, "Whatever came next was on the following line, and so on to the end here."].join("\n");
    expect(unwrapLines(input).text.includes("sentence. Whatever")).toBe(true);
  });

  it("joins a lowercase continuation even after a short line", () => {
    const lines = [...wrap(PARAGRAPH_A).slice(0, -1), "a shortish line of thirty-eight chars", "continues here in lowercase, which no paragraph starts with."];
    const result = unwrapLines(lines.join("\n"));
    expect(result.text.includes("chars continues here")).toBe(true);
  });
});

describe("unwrapLines and hyphens at the line end", () => {
  const lines = [...wrap(PARAGRAPH_A).slice(0, -1), "the printer split this word across the line end as a contin-", "uation and the text goes on for a while after that as well."];
  const withTail = (last: string, next: string) => [...wrap(PARAGRAPH_A).slice(0, -1), last, next].join("\n");

  it("drops the hyphen of a word the printer split, by default", () => {
    const result = unwrapLines(lines.join("\n"));
    expect(result.text.includes("as a continuation and")).toBe(true);
    expect(result.dehyphenated).toBe(1);
    expect(describeUnwrap(result)).toMatch(/1 hyphenated word rejoined/);
    expect(unwrapLines(withTail("he had learned since then, and it was not much, but it was непере-", "носимой, as the saying goes, and the paragraph runs on to its end.")).text.includes("непереносимой, as")).toBe(true);
  });

  it("keeps a hyphen that is the word's own: a short or known prefix, a particle after it, a repeat, a name, a digit", () => {
    const keeps: Array<[string, string, string]> = [
      ["he had learned since then, and it was not much, but it was кое-", "что, as the saying goes, and the paragraph runs on to its end.", "кое-что,"],
      ["he had learned since then, and it was not much, but it was по-", "прежнему, as the saying goes, and the paragraph runs on to its end.", "по-прежнему,"],
      ["he had learned since then, and it was not much, but it was когда-", "нибудь, as the saying goes, and the paragraph runs on to its end.", "когда-нибудь,"],
      ["he had learned since then, and it was not much, but it was где-", "то, as the saying goes, and the paragraph runs on to its end here.", "где-то,"],
      ["he had learned since then, and it was not much, but it was ха-", "ха, as the saying goes, and the paragraph runs on to its end here.", "ха-ха,"],
      ["he had learned since then, and it was not much, but it was Нью-", "йоркской, as the saying goes, and the paragraph runs on to its end.", "Нью-йоркской,"],
      ["he had learned since then, and it was not much, but it was self-", "evident, as the saying goes, and the paragraph runs on to its end.", "self-evident,"],
      ["he had learned since then, and it was not much, but it was time-", "based, as the saying goes, and the paragraph runs on to its end.", "time-based,"],
      ["he had learned since then, and it was not much, but it was the 1-", "й, as the saying goes, and the paragraph runs on to its end here.", "1-й,"],
    ];
    for (const [last, next, expected] of keeps) {
      const result = unwrapLines(withTail(last, next));
      expect(result.text.includes(expected)).toBe(true);
      expect(result.dehyphenated).toBe(0);
    }
  });

  it("keeps every hyphen when asked, joining without a space", () => {
    const result = unwrapLines(lines.join("\n"), { ...DEFAULT_UNWRAP_OPTIONS, joinHyphens: false });
    expect(result.text.includes("as a contin-uation and")).toBe(true);
    expect(result.dehyphenated).toBe(0);
  });

  it("a dash after a space or a comma is not a hyphen, and a hyphen before a capitalised word is left alone", () => {
    expect(unwrapLines(withTail("the printer left the dash at the line end, like this one here -", "and the text goes on for a while after that as well as before.")).text.includes("here - and")).toBe(true);
    expect(unwrapLines(withTail("the printer left the dash at the line end after a comma, here,-", "and the text goes on for a while after that as well as before.")).text.includes("here,- and")).toBe(true);
    expect(unwrapLines(withTail("the printer split this word across the line end as a contin-", "Uation and the text goes on for a while after that as well.")).text.includes("contin- Uation")).toBe(true);
  });
});

describe("unwrapLines and justified text", () => {
  it("makes the doubled spaces of a justified line single when it is joined, and leaves them elsewhere", () => {
    const justified = wrap(PARAGRAPH_A).map((l, i) => (i % 2 === 0 ? l.replace(/ /g, "  ") : l));
    expect(unwrapLines(justified.join("\n")).text).toBe(PARAGRAPH_A);
    const alone = "a  short  line  with  doubled  spaces";
    expect(unwrapLines([...wrap(PARAGRAPH_A), "", alone].join("\n")).text.endsWith(alone)).toBe(true);
  });
});

describe("unwrapLines when the text is not wrapped prose", () => {
  it("leaves text of one paragraph per line unchanged", () => {
    const input = [PARAGRAPH_A, PARAGRAPH_B, "Short title", PARAGRAPH_A].join("\n");
    const result = unwrapLines(input);
    expect(result.text).toBe(input);
    expect(result.width).toBeNull();
    expect(result.joined).toBe(0);
  });

  it("leaves a poem of short lines unchanged", () => {
    const input = ["Roses are red,", "violets are blue,", "this poem is short,", "and so are you."].join("\n");
    expect(unwrapLines(input).text).toBe(input);
    expect(unwrapLines("").text).toBe("");
    expect(unwrapLines("one line").text).toBe("one line");
  });

  it("refuses a changelog of one item per line: nothing starts lowercase", () => {
    const input = [
      "Dialog system compatibility with the content core of the game",
      "Decrease the number of dialogs and phrases on levels eight to fourteen",
      "Disperse the food earlier while the character is feeding at the table",
      "Adjust the moment when the quest completion is processed by the server",
      "Simplify the process of collecting buildings to the shop's storage room",
      "Display an approximate path to inaccessible objects on the island map",
      "Divide quest tooltip animations into stages for the new tutorial flow",
    ].join("\n");
    const result = unwrapLines(input);
    expect(result.text).toBe(input);
    expect(result.refused).toBe("not-prose");
    expect(describeUnwrap(result)).toMatch(/does not look like wrapped prose/);
  });

  it("refuses song lyrics: lowercase lines, but few of them near the width", () => {
    const input = [
      "For a lifetime she had dark thoughts on her mind",
      "always knowing that the menace grew",
      "facing her fate she's screaming:",
      "\"I don't wanna live forever!\"",
      "she takes her cloak and asks them: \"why do you?\"",
      "",
      "our minds and our will they can never break",
      "our freedom is something they can never take",
      "their world and order will soon come undone",
      "our legacy is something they will never overcome",
      "",
      "FATE!",
      "in all these tears we will survive...will survive",
      "like the saints we will ascend...",
      "FATE!",
      "a thousand years we'll be alive...be alive!",
      "let us take it to the end!",
      "straight to the end!",
      "",
      "WE'LL TAKE THE WORLD BY STORM",
      "IN DEATH WE ARE ONE",
      "WE TAKE THE WORLD BY STORM",
      "",
      "FATE!",
      "we will survive",
      "like the saints",
      "FATE!",
      "be alive!",
      "to the end!",
      "straight to the end!",
      "to the end!",
      "",
      "smoke is rising as they set the world on fire",
      "caressed by warmth and a golden light",
      "they expect her screaming",
      "but all she does is roar with laughter",
      "and they know that she is goddamn right...",
    ].join("\n");
    const result = unwrapLines(input);
    expect(result.text).toBe(input);
    expect(result.refused).toBe("not-prose");
  });

  it("does not apply the gate to a handful of lines the user selected, but always to a whole document", () => {
    const input = ["A first line long enough to be measured, without any punctuation", "Another line that starts with a capital and is also long enough here"].join("\n");
    expect(unwrapLines(input, { ...DEFAULT_UNWRAP_OPTIONS, selection: true }).joined).toBe(1);
    const whole = unwrapLines(input);
    expect(whole.joined).toBe(0);
    expect(whole.refused).toBe("not-prose");
  });

  it("lettered list items (а. б. or a) b)) are structure", () => {
    const input = ["а. условия уровня не были выполнены и начинается анимация проигрыша", "б. условия уровня были выполнены и уровень завершен, окно закрыто", "c) a third item in Latin letters that is long enough to be measured"].join("\n");
    expect(unwrapLines(input, { ...DEFAULT_UNWRAP_OPTIONS, selection: true }).joined).toBe(0);
  });

  it("does not join two one-line paragraphs on the strength of a width measured on one of them", () => {
    const input = ["Buy milk at the store today, because we are out of it again.", "Call the dentist tomorrow morning."].join("\n");
    const result = unwrapLines(input);
    expect(result.text).toBe(input);
    expect(result.width).toBe(60);
    expect(result.joined).toBe(0);
  });

  it("measures the width as the 80th percentile of the long ordinary lines, outliers dropped", () => {
    const lines = ["x".repeat(50), "x".repeat(60), "x".repeat(70), "x".repeat(80), "x".repeat(300), "short"];
    expect(measureWrapWidth(lines, lines.map(() => false))).toEqual({ width: 80, samples: 4 });
    expect(measureWrapWidth(["x".repeat(80)], [false])).toEqual({ width: 80, samples: 1 });
    expect(measureWrapWidth(["x".repeat(39), "short"], [false, false])).toBeNull();
    expect(measureWrapWidth(["x".repeat(30), "x".repeat(35)], [false, false])).toBeNull();
    expect(measureWrapWidth(["x".repeat(200), "x".repeat(300)], [false, false])).toBeNull();
    expect(measureWrapWidth(["x".repeat(80), "x".repeat(80)], [true, false])).toEqual({ width: 80, samples: 1 });
  });
});

describe("the hyphen decision: the text first, the dictionaries second, the rules last", () => {
  const body = wrap(PARAGRAPH_A).slice(0, -1);
  /** A wrapped paragraph whose last line ends in a hyphen, plus short lines of evidence that never join. */
  const doc = (last: string, next: string, ...evidence: string[]) => [...body, `he had learned since then, and it was not much, but it was ${last}`, `${next}, as the saying goes, and the paragraph runs on to its end.`, ...evidence].join("\n");

  it("keeps the hyphen when the text writes that hyphenated word elsewhere", () => {
    const result = unwrapLines(doc("zog-", "lin", "A zog-lin was seen."));
    expect(result.text.includes("zog-lin,")).toBe(true);
    expect(result.dehyphenated).toBe(0);
  });

  it("drops it when the text writes the joined word elsewhere, although a dictionary knows the prefix", () => {
    const result = unwrapLines(doc("self-", "less", "It was selfless."));
    expect(result.text.includes("selfless,")).toBe(true);
    expect(result.dehyphenated).toBe(1);
    // Without that word in the text the dictionary's prefix decides the other way.
    expect(unwrapLines(doc("self-", "less")).text.includes("self-less,")).toBe(true);
  });

  it("the more frequent form wins when the text has both", () => {
    expect(unwrapLines(doc("zog-", "lin", "A zog-lin was seen.", "Another zoglin and a zoglin.")).text.includes("zoglin,")).toBe(true);
    expect(unwrapLines(doc("zog-", "lin", "A zog-lin and a zog-lin.", "One zoglin.")).text.includes("zog-lin,")).toBe(true);
  });

  it("keeps it when the part begins or ends two other hyphenated words of the text", () => {
    expect(unwrapLines(doc("qux-", "gamma", "Both qux-alpha and qux-beta.")).text.includes("qux-gamma,")).toBe(true);
    expect(unwrapLines(doc("gamma-", "zeta", "Both alpha-zeta and beta-zeta.")).text.includes("gamma-zeta,")).toBe(true);
    // One other word is not evidence.
    expect(unwrapLines(doc("qux-", "gamma", "Only qux-alpha.")).text.includes("quxgamma,")).toBe(true);
  });

  it("falls back to the dictionaries: a known word, prefix or particle", () => {
    expect(unwrapLines(doc("кое-", "что")).text.includes("кое-что,")).toBe(true);
    expect(unwrapLines(doc("будь-", "ласка")).text.includes("будь-ласка,")).toBe(true);
    expect(unwrapLines(doc("когда-", "нибудь")).text.includes("когда-нибудь,")).toBe(true);
    expect(unwrapLines(doc("time-", "based")).text.includes("time-based,")).toBe(true);
  });

  it("takes a lexicon handed to it instead of the dictionaries in force", () => {
    const lexicon = buildLexicon([{ name: "Test", prefixes: ["frob"], suffixes: [], words: ["wibble-wobble"] }]);
    expect(unwrapLines(doc("frob-", "nicate"), { ...DEFAULT_UNWRAP_OPTIONS, lexicon }).text.includes("frob-nicate,")).toBe(true);
    expect(unwrapLines(doc("wibble-", "wobble"), { ...DEFAULT_UNWRAP_OPTIONS, lexicon }).text.includes("wibble-wobble,")).toBe(true);
    // The bundled lists are not consulted when a lexicon is given.
    expect(unwrapLines(doc("кое-", "что"), { ...DEFAULT_UNWRAP_OPTIONS, lexicon }).text.includes("коечто,")).toBe(true);
  });

  it("the rules that hold in every language: a repeat, one letter, an abbreviation, the same vowel", () => {
    expect(unwrapLines(doc("ха-", "ха")).text.includes("ха-ха,")).toBe(true);
    expect(unwrapLines(doc("e-", "mail")).text.includes("e-mail,")).toBe(true);
    expect(unwrapLines(doc("PDF-", "файлов")).text.includes("PDF-файлов,")).toBe(true);
    expect(unwrapLines(doc("re-", "elect")).text.includes("re-elect,")).toBe(true);
    expect(unwrapLines(doc("linja-", "auto")).text.includes("linja-auto,")).toBe(true);
    // A different vowel is no reason to keep it.
    expect(unwrapLines(doc("linja-", "outo")).text.includes("linjaouto,")).toBe(true);
  });

  it("drops the printer's hyphen when nothing claims it, whatever the case of the part before", () => {
    expect(unwrapLines(doc("непере-", "носимой")).text.includes("непереносимой,")).toBe(true);
    expect(unwrapLines(doc("Возмож-", "ные")).text.includes("Возможные,")).toBe(true);
    expect(unwrapLines(doc("та-", "ких")).text.includes("таких,")).toBe(true);
  });

  it("reads the evidence from the whole document when only a selection is joined", () => {
    const selection = [`he had learned since then, and it was not much, but it was zog-`, `lin, as the saying goes, and the paragraph runs on to its end.`].join("\n");
    const document = [...body, selection, "A zog-lin was seen."].join("\n");
    expect(unwrapLines(selection, { ...DEFAULT_UNWRAP_OPTIONS, selection: true }).text.includes("zoglin,")).toBe(true);
    expect(unwrapLines(selection, { ...DEFAULT_UNWRAP_OPTIONS, selection: true, evidenceText: document }).text.includes("zog-lin,")).toBe(true);
  });
});

describe("the words Unwrap put back together", () => {
  const body = wrap(PARAGRAPH_A).slice(0, -1);
  const doc = (last: string, next: string) => [...body, last, next, "And the paragraph is finished here."].join("\n");

  it("names each one, with the hyphen's place in the result, so the review step can put it back", () => {
    const result = unwrapLines(doc("he had learned since then, and it was not much, but it was непере-", "носимой, as the saying goes, and the paragraph runs on to its end."));
    expect(result.rejoined).toHaveLength(result.dehyphenated);
    const join = result.rejoined[0];
    expect(join?.word).toBe("непереносимой");
    expect(join?.hyphenated).toBe("непере-носимой");
    // The offsets are into the text Unwrap produced, not into the original.
    expect(result.text.slice(join?.at, (join?.at ?? 0) + (join?.word.length ?? 0))).toBe("непереносимой");
    expect(restoreHyphens(result.text, result.rejoined).includes("непере-носимой,")).toBe(true);
  });

  it("says nothing about a hyphen it kept, or about a join that needed none", () => {
    expect(unwrapLines(doc("he had learned since then, and it was not much, but it was кое-", "что, as the saying goes, and the paragraph runs on to its end.")).rejoined).toEqual([]);
    expect(unwrapLines([...body, "a plain line that simply goes on", "into the next one without any hyphen at all."].join("\n")).rejoined).toEqual([]);
  });

  it("counts the places in a text with several, each against its own paragraph", () => {
    const first = ["he had learned since then, and it was not much, but it was непере-", "носимой, as the saying goes, and the paragraph runs on to its end."];
    const second = ["another paragraph of the same book that was set by the same обыкно-", "венный printer with the same habits, and it runs on to its own end."];
    const result = unwrapLines([...body, ...first, "", ...second].join("\n"));
    expect(result.rejoined.map((r) => r.word)).toEqual(["непереносимой", "обыкновенный"]);
    for (const join of result.rejoined) expect(result.text.slice(join.at, join.at + join.word.length)).toBe(join.word);
    expect(restoreHyphens(result.text, result.rejoined)).toContain("обыкно-венный");
  });
});

describe("scripts with no case, and scripts with no word spaces", () => {
  // One wrapped paragraph per script, cut the way a converter cuts. Measured
  // 2026-09-18 on these very samples: before the caseless rule every one of
  // them was refused ("not-prose"), or its width was never even measured.
  const arabic = [
    "في قديم الزمان كان هناك تاجر يعيش في مدينة صغيرة على شاطئ",
    "البحر، وكان له ثلاثة أبناء يعملون معه في التجارة كل يوم",
    "من الصباح حتى المساء، ولم يكن أحد منهم يشكو من التعب أبدا.",
    "وفي يوم من الأيام جاء رجل غريب إلى المدينة يحمل معه صندوقا",
    "كبيرا مغلقا بقفل من حديد، وقال إنه يبيعه لمن يدفع ثمنه ذهبا.",
  ];
  const chinese = [
    "很久以前在海边的一座小城里住着一位商人他有三个儿子每天从",
    "早到晚都和他一起做生意从来没有一个人抱怨过辛苦或者劳累。",
    "有一天一个陌生人来到城里他带着一个很大的箱子上面锁着一把",
    "铁锁他说谁愿意用黄金付钱他就把箱子卖给谁绝不讨价还价。",
    "商人的三个儿子都想知道箱子里面到底装着什么样的东西呢。",
  ];
  const korean = [
    "옛날 옛적에 바닷가의 작은 도시에 한 상인이 살고 있었는데 그에게는",
    "세 아들이 있어서 날마다 아침부터 저녁까지 함께 장사를 하였고 그",
    "누구도 힘들다고 불평하는 일이 한 번도 없었다고 합니다 그러던",
    "어느 날 낯선 사람이 도시에 와서 커다란 상자를 가지고 왔는데 그",
    "상자에는 쇠자물쇠가 달려 있었고 금으로 값을 치르면 판다고 했다.",
  ];
  const plain = { ...DEFAULT_UNWRAP_OPTIONS, markdown: false };

  it("joins a caseless script, where a lowercase letter can never be the sign of a continuation", () => {
    const result = unwrapLines(arabic.join("\n"), plain);
    expect(result.refused).toBeNull();
    expect(result.joined).toBe(4);
    expect(result.text.split("\n")).toHaveLength(1);
    expect(result.text).toContain("على شاطئ البحر");
  });

  it("counts a line in columns, so a paragraph of wide characters is wrapped prose and not a stack of short lines", () => {
    // 28 Chinese characters are 56 columns: read as 28 the text was below the
    // minimum wrap width and nothing was measured at all.
    expect(columns("很久以前")).toBe(8);
    expect(columns("abcd")).toBe(4);
    expect(columns("ab很久")).toBe(6);
    const result = unwrapLines(chinese.join("\n"), plain);
    expect(result.width).toBeGreaterThanOrEqual(40);
    expect(result.joined).toBe(4);
  });

  it("joins Chinese without a space, and Korean with one", () => {
    expect(unwrapLines(chinese.join("\n"), plain).text).toContain("每天从早到晚");
    const hangul = unwrapLines(korean.join("\n"), plain).text;
    expect(hangul).toContain("그에게는 세 아들이");
    expect(hangul).not.toContain("그에게는세");
  });

  it("still refuses a list of short lines in a caseless script", () => {
    const list = ["苹果", "香蕉", "橙子", "葡萄", "西瓜", "草莓", "桃子", "樱桃"].join("\n");
    const result = unwrapLines(list, plain);
    expect(result.text).toBe(list);
  });

  it("takes the Armenian hyphen and the Hebrew maqaf as hyphens", () => {
    const body = wrap(PARAGRAPH_A).slice(0, -1);
    const armenian = [...body, "he had learned since then, and it was not much, but it was непере֊", "носимой, as the saying goes, and the paragraph runs on to its end."].join("\n");
    // The word is put back together, and the Armenian hyphen goes with it.
    expect(unwrapLines(armenian).text).toContain("непереносимой,");
    const hebrew = [...body, "he had learned since then, and it was not much, but it was непере־", "носимой, as the saying goes, and the paragraph runs on to its end."].join("\n");
    expect(unwrapLines(hebrew).text).toContain("непереносимой,");
  });
});
