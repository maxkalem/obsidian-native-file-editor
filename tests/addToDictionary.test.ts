import { beforeEach, describe, expect, it } from "vitest";
import { __resetObsidianMock, __settingInstances } from "./mocks/obsidian";
import { AddToDictionaryModal, type DictionaryChoice } from "../src/ui/AddToDictionaryModal";
import { wordAtPosition } from "../src/core/words";

/**
 * "Add to dictionary…": the dialog picks the kind, the language and, for a
 * programming language, the element; the word is prefilled and editable.
 */

const TEXT = ["Ukrainian", "English"];
const CODE = ["Batch", "AutoIt"];

function open(word: string, language: string | null = null) {
  const added: DictionaryChoice[] = [];
  const modal = new AddToDictionaryModal({} as never, {
    word,
    textLanguages: () => TEXT,
    programmingLanguages: () => CODE,
    currentLanguage: language,
    onAdd: (choice) => void added.push(choice),
  });
  modal.onOpen();
  const rows = () => __settingInstances;
  return { modal: modal as unknown as { finish(): void }, added, rows };
}

beforeEach(() => __resetObsidianMock());

describe("AddToDictionaryModal", () => {
  it("offers the text languages first, with the word prefilled, and adds to the one picked", () => {
    const { modal, added, rows } = open(" будь-що ");
    expect(rows()[0]?.texts[0]?.value).toBe("будь-що");
    expect(rows()[1]?.dropdowns[0]?.options).toEqual([
      ["text", "Text language"],
      ["programming", "Programming language"],
    ]);
    const language = rows()[2];
    expect(language?.dropdowns[0]?.options.map((o: [string, string]) => o[1])).toEqual(["Ukrainian", "English", "New dictionary…"]);
    language?.__choose(0, "English");
    modal.finish();
    expect(added).toEqual([{ kind: "text", language: "English", word: "будь-що" }]);
  });

  it("asks for a name when the dictionary does not exist yet, and refuses to add without one", () => {
    const { modal, added, rows } = open("nuq-neH");
    const before = rows().length;
    rows()[2]?.__choose(0, "__new__");
    const nameRow = rows()[rows().length - 1];
    expect(rows().length).toBeGreaterThan(before);
    expect(nameRow?.nameText).toBe("New dictionary name");
    modal.finish();
    expect(added).toEqual([]);
    nameRow?.texts[0]?.onChange?.(" Klingon ");
    modal.finish();
    expect(added).toEqual([{ kind: "text", language: "Klingon", word: "nuq-neH" }]);
  });

  it("for a programming language offers the element sets and preselects the open file's language", () => {
    const { modal, added, rows } = open("ENDLOCAL", "AutoIt");
    rows()[1]?.__choose(0, "programming");
    const language = rows()[rows().length - 2];
    const element = rows()[rows().length - 1];
    expect(language?.dropdowns[0]?.value).toBe("AutoIt");
    expect(element?.dropdowns[0]?.options.map((o: [string, string]) => o[0])).toEqual(["keyword", "builtin", "type", "constant", "property", "meta", "special"]);
    element?.__choose(0, "builtin");
    modal.finish();
    expect(added).toEqual([{ kind: "programming", language: "AutoIt", role: "builtin", word: "ENDLOCAL" }]);
  });

  it("names the open file's language when it has a grammar and so cannot be the one preselected", () => {
    const { rows } = open("export", "Python");
    rows()[1]?.__choose(0, "programming");
    const language = rows()[rows().length - 2];
    expect(language?.dropdowns[0]?.value).toBe("Batch");
    // The sentence is a warning line of its own under the ordinary description, not part of it.
    const warning = language?.descEl.querySelector(".nfe-add-word-grammar");
    expect(warning?.textContent).toBe("Python, the language of this file, is coloured by a grammar and has no word list, so it is not in the list above.");
    expect(language?.descText).not.toContain("the language of this file");
    // A file whose language has lists says nothing extra.
    __resetObsidianMock();
    const known = open("ENDLOCAL", "Batch");
    known.rows()[1]?.__choose(0, "programming");
    expect(known.rows()[known.rows().length - 2]?.descEl.querySelector(".nfe-add-word-grammar")).toBeNull();
  });

  it("does nothing without a word", () => {
    const { modal, added, rows } = open("");
    rows()[0]?.texts[0]?.onChange?.("   ");
    modal.finish();
    expect(added).toEqual([]);
  });
});

describe("wordAtPosition", () => {
  it("takes the word the cursor stands in, hyphens and apostrophes included", () => {
    expect(wordAtPosition("он сказал будь-що важное", 12)).toBe("будь-що");
    expect(wordAtPosition("он сказал будь-що важное", 10)).toBe("будь-що");
    expect(wordAtPosition("it doesn't matter", 8)).toBe("doesn't");
    expect(wordAtPosition("віч-на-віч з ним", 5)).toBe("віч-на-віч");
  });

  it("takes the word that ends right before the cursor, and nothing where there is none", () => {
    expect(wordAtPosition("one two", 3)).toBe("one");
    expect(wordAtPosition("one  two", 4)).toBe("");
    expect(wordAtPosition("", 0)).toBe("");
    // A dash at either end is punctuation, not the word's own hyphen.
    expect(wordAtPosition("— слово", 3)).toBe("слово");
    expect(wordAtPosition("непере-", 4)).toBe("непере");
  });
});
