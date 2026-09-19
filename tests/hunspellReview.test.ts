import { describe, expect, it } from "vitest";
import { __fire, __resetObsidianMock, __settingInstances, __textOf } from "./mocks/obsidian";
import { HunspellReviewModal } from "../src/ui/HunspellReviewModal";
import type { HunspellPair } from "../src/fmt/vaultHunspell";
import { type RejoinedWord, restoreHyphens } from "../src/fmt/unwrap";

/**
 * The review dialog: it asks before reading anyone's dictionary, it shows only
 * the words the dictionary does not know, and what it changes is what the user
 * pressed — nothing else in the text.
 */

const PAIR: HunspellPair = { name: "uk_UA", dic: "d/uk_UA.dic", aff: "d/uk_UA.aff" };

const JOINS: RejoinedWord[] = [
  { word: "ньюйоркської", hyphenated: "нью-йоркської", at: 10, hyphenAt: 13 },
  { word: "попередній", hyphenated: "попе-редній", at: 40, hyphenAt: 44 },
];

function open(known: string[], onApply: (r: readonly RejoinedWord[]) => void = () => undefined, extra: Partial<Parameters<typeof deps>[0]> = {}) {
  const modal = new HunspellReviewModal({} as never, deps({ known, onApply, ...extra }));
  modal.onOpen();
  return modal;
}

function deps(o: {
  known: string[];
  onApply: (r: readonly RejoinedWord[]) => void;
  added?: Array<{ word: string; language: string }>;
  problem?: string;
  joins?: RejoinedWord[];
}) {
  return {
    joins: o.joins ?? JOINS,
    dictionaries: [PAIR],
    check: async () => ({ known: new Set(o.known), entries: 3, wholeFile: true, problem: o.problem ?? null }),
    textLanguages: () => ["Ukrainian", "English"],
    onApply: o.onApply,
    onAddWord: (word: string, language: string) => o.added?.push({ word, language }),
    onProblem: () => undefined,
  };
}

/** Every element of the dialog, so a button can be found by the words on it. */
function all(root: { children?: unknown[] }): Array<{ tagName?: string; textContent?: string }> {
  const out: Array<{ tagName?: string; textContent?: string }> = [];
  for (const child of (root.children ?? []) as Array<{ children?: unknown[] }>) {
    out.push(child as { tagName?: string; textContent?: string });
    out.push(...all(child));
  }
  return out;
}

/** Click one of the dialog's own buttons (the ones that are not Setting rows). */
function click(root: unknown, text: string): void {
  const button = all(root as { children?: unknown[] }).find((el) => (el.tagName ?? "").toUpperCase() === "BUTTON" && el.textContent === text);
  if (!button) throw new Error(`no button "${text}"`);
  __fire(button, "click");
}

function press(label: string): void {
  for (const setting of __settingInstances) {
    for (const button of setting.buttons as Array<{ text: string; click: () => void }>) {
      if (button.text === label) {
        button.click();
        return;
      }
    }
  }
  throw new Error(`no button "${label}"`);
}

describe("the review after Unwrap", () => {
  it("asks before it reads the dictionary, and says how many words it would check", () => {
    __resetObsidianMock();
    const modal = open([]);
    const text = __textOf(modal.contentEl);
    expect(text).toContain("2 words back together");
    expect(text).toContain("uk_UA");
    // Nothing is read until the button is pressed.
    expect(text).toContain("Check");
  });

  it("shows only the words the dictionary does not know, and recommends the hyphen where it knows that form", async () => {
    __resetObsidianMock();
    const applied: RejoinedWord[][] = [];
    const modal = open(["попередній", "нью-йоркської"], (r) => applied.push([...r]));
    await modal["run"]();
    const rows = __settingInstances.filter((s) => (s.classes as string[]).includes("nfe-hunspell-row"));
    // "попередній" is known, so it is not in the list at all.
    expect(rows.map((s) => s.nameText)).toEqual(["ньюйоркської"]);
    // The dictionary knows the hyphenated form: the row says so, and that is
    // the whole reason to put the hyphen back.
    expect(rows[0]?.descText).toContain("нью-йоркської");
    expect(__textOf(modal.contentEl)).toContain("One word the dictionary does not know.");
  });

  it("applies the hyphen the user kept, and only that one", async () => {
    __resetObsidianMock();
    const applied: RejoinedWord[][] = [];
    const modal = open([], (r) => applied.push([...r]));
    await modal["run"]();
    // Neither form is known: nothing is recommended, so both rows start on Keep.
    press("Restore the hyphen");
    click(modal.contentEl, "Apply");
    expect(applied).toHaveLength(1);
    expect(applied[0]?.map((j) => j.word)).toEqual(["ньюйоркської"]);
  });

  it("says so when the dictionary knows every word", async () => {
    __resetObsidianMock();
    const modal = open(["ньюйоркської", "попередній"]);
    await modal["run"]();
    expect(__textOf(modal.contentEl)).toContain("knows all 2 words");
  });

  it("hands the chosen form to the plugin's own dictionary", async () => {
    __resetObsidianMock();
    const added: Array<{ word: string; language: string }> = [];
    const modal = new HunspellReviewModal({} as never, deps({ known: ["нью-йоркської"], onApply: () => undefined, added }));
    modal.onOpen();
    await modal["run"]();
    // The row's decision decides the form: the hyphen was recommended, so the
    // hyphenated word is what teaches the plugin.
    const book = __settingInstances.flatMap((s) => s.buttons as Array<{ icon: string; click: () => void }>).find((b) => b.icon === "book-plus");
    book?.click();
    expect(added).toEqual([{ word: "нью-йоркської", language: "Ukrainian" }]);
  });
});

describe("putting the hyphens back", () => {
  it("writes them at the recorded places, later ones first, so the offsets hold", () => {
    const text = "початок ньюйоркської середина попередній кінець";
    const joins: RejoinedWord[] = [
      { word: "ньюйоркської", hyphenated: "нью-йоркської", at: 8, hyphenAt: 11 },
      { word: "попередній", hyphenated: "попе-редній", at: 30, hyphenAt: 34 },
    ];
    expect(restoreHyphens(text, joins)).toBe("початок нью-йоркської середина попе-редній кінець");
    expect(restoreHyphens(text, [joins[1] as RejoinedWord])).toBe("початок ньюйоркської середина попе-редній кінець");
    expect(restoreHyphens(text, [])).toBe(text);
  });
});
