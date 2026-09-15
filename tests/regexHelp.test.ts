import { describe, expect, it } from "vitest";
import { __findAllByClass, __fire, __notices, __textOf } from "./mocks/obsidian";
import { RegexHelpModal } from "../src/ui/RegexHelpModal";

type Cell = { children: Array<{ textContent: string; hasClass: (c: string) => boolean }>; textContent: string };
type Table = { children: Array<{ children: Cell[] }> };

describe("RegexHelpModal", () => {
  it("renders the syntax table, the common searches with their Replace fields, and the keys of the editor", () => {
    const modal = new RegexHelpModal({} as never);
    modal.onOpen();
    expect(modal.titleEl.textContent).toBe("Keys and regular expressions");
    const text = __textOf(modal.contentEl);
    expect(text).toContain("\\d{4}-\\d{2}-\\d{2}");
    expect(text).toContain("$3-$2-$1");
    expect(text).toContain("Alt+Enter");
    expect(text).toContain("Ctrl+Alt+↑");
    expect(text).toContain("Shift+Alt+↓");
    expect(text).toContain("Alt+drag");
    expect(text).toContain("Ctrl+Space");
    // One table per key group first, then the two pattern tables.
    const tables = __findAllByClass(modal.contentEl, "nfe-regex-table") as Table[];
    expect(tables.length).toBe(6);
    // Every example (the last table) is a valid JavaScript regular expression.
    const examples = tables[5]!.children.map((tr) => tr.children[0]?.children[0]?.textContent ?? "");
    expect(examples.length).toBeGreaterThan(10);
    for (const code of examples) expect(() => new RegExp(code), code).not.toThrow();
    // Every pattern in the two pattern tables is clickable (a click copies); the key rows are not.
    expect(__findAllByClass(modal.contentEl, "nfe-regex-copy")).toHaveLength(tables[4]!.children.length + tables[5]!.children.length);
    // The keys are keycaps as on the Hotkeys page, one per key ("Ctrl+Z  Ctrl+Y" is two), not code like the patterns.
    const caps = __findAllByClass(modal.contentEl, "nfe-hotkey-key") as Array<{ tagName?: string; textContent: string }>;
    expect(caps.length).toBeGreaterThan(30);
    expect(caps.map((c) => c.textContent)).toContain("Ctrl+Y");
    expect(caps.every((c) => (c.tagName ?? "KBD").toUpperCase() === "KBD")).toBe(true);
    expect(tables[0]!.children[0]!.children[0]!.children[0]!.hasClass("nfe-hotkey-key")).toBe(true);
    // The copy note stands under the regular-expression heading, not at the top with the keys.
    expect(text).toContain("Click a pattern below to copy it.");
    expect(text.indexOf("Click a pattern below")).toBeGreaterThan(text.indexOf("Regular expressions in search"));
  });

  it("names the keys as the user has mapped them", () => {
    const modal = new RegexHelpModal({} as never, { win: { "add-cursor-above": "Shift+Alt+ArrowUp", search: "Ctrl+Shift+F" }, mac: {}, linux: {} });
    modal.onOpen();
    const text = __textOf(modal.contentEl);
    expect(text).toContain("Shift+Alt+↑ a cursor on the line above");
    expect(text).toContain("Ctrl+Shift+F open the search panel");
    expect(text).not.toContain("Ctrl+Alt+↑");
  });

  it("a click on a pattern copies it and says so", async () => {
    const modal = new RegexHelpModal({} as never);
    modal.onOpen();
    const written: string[] = [];
    const g = globalThis as { navigator?: unknown };
    const saved = g.navigator;
    Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async (t: string) => void written.push(t) } }, configurable: true });
    try {
      __fire(__findAllByClass(modal.contentEl, "nfe-regex-copy")[0], "click");
      await Promise.resolve();
    } finally {
      Object.defineProperty(globalThis, "navigator", { value: saved, configurable: true });
    }
    expect(written).toEqual(["."]);
    expect(__notices.at(-1)).toBe("Copied .");
  });
});
