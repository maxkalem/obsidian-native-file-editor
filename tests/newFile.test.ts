import { describe, expect, it } from "vitest";
import { __findAllByClass, __fire } from "./mocks/obsidian";
import { filterExtensions, isSubsequence, newFilePath, sanitizeBaseName } from "../src/core/newFile";
import { NewFileModal } from "../src/ui/NewFileModal";

describe("sanitizeBaseName", () => {
  it("drops forbidden characters and trims", () => {
    expect(sanitizeBaseName('  a<b>:c"d/e\\f|g?h*i#j^k[l]m  ', "ts")).toBe("abcdefghijklm");
  });

  it("strips a typed extension, once, case-insensitively", () => {
    expect(sanitizeBaseName("notes.TS", "ts")).toBe("notes");
    expect(sanitizeBaseName("notes.ts.ts", "ts")).toBe("notes.ts");
    expect(sanitizeBaseName("archive.tar", "gz")).toBe("archive.tar");
  });

  it("falls back to Untitled", () => {
    expect(sanitizeBaseName("", "ts")).toBe("Untitled");
    expect(sanitizeBaseName(" . ", "ts")).toBe("Untitled");
    expect(sanitizeBaseName(".ts", "ts")).toBe("Untitled");
  });
});

describe("newFilePath", () => {
  it("joins folder, name and extension, the root without a prefix", () => {
    expect(newFilePath("", "a", "ts", () => false)).toBe("a.ts");
    expect(newFilePath("/", "a", "ts", () => false)).toBe("a.ts");
    expect(newFilePath("dir/sub/", "a", "ts", () => false)).toBe("dir/sub/a.ts");
  });

  it("adds a counter while the name is taken", () => {
    const taken = new Set(["d/a.ts", "d/a 1.ts"]);
    expect(newFilePath("d", "a", "ts", (p) => taken.has(p))).toBe("d/a 2.ts");
  });
});

describe("NewFileModal options", () => {
  it("lists every registered extension once, sorted, labelled with its language", () => {
    const opts = NewFileModal.options();
    const exts = opts.map((o) => o.extension);
    expect(new Set(exts).size).toBe(exts.length);
    expect(exts).toEqual([...exts].sort((a, b) => a.localeCompare(b)));
    expect(opts.find((o) => o.extension === "ts")?.label).toBe(".ts  (TypeScript)");
    expect(exts.length).toBeGreaterThan(200);
  });

  it("filterExtensions finds the letters in order (tt: txt, http, targets), exact and prefix matches first, then language names", () => {
    expect(isSubsequence("tt", "targets")).toBe(true);
    expect(isSubsequence("tt", "tex")).toBe(false);
    expect(isSubsequence("tt", ".tex  (LaTeX)")).toBe(true);
    expect(isSubsequence("", "x")).toBe(true);
    const all = NewFileModal.options();
    const tt = filterExtensions("tt", all).map((o) => o.extension);
    expect(tt).toEqual(expect.arrayContaining(["txt", "http", "targets"]));
    expect(tt).not.toContain("md");
    // An exact extension first, then extensions starting with the query, then the rest in list order.
    const ts = filterExtensions("ts", all).map((o) => o.extension);
    expect(ts[0]).toBe("ts");
    expect(ts.slice(1, 3)).toEqual(["tsql", "tsx"]);
    expect(ts).toContain("targets");
    // A leading dot and case do not matter; a language name works.
    expect(filterExtensions(".TS", all)[0]?.extension).toBe("ts");
    expect(filterExtensions("typescript", all).map((o) => o.extension)).toEqual(expect.arrayContaining(["ts", "mts", "cts"]));
    expect(filterExtensions("zzzz", all)).toEqual([]);
    expect(filterExtensions("", all)).toHaveLength(all.length);
  });
});

describe("NewFileModal", () => {
  it("filters the type list as the user types, moves the selection with the arrows, and creates with the selected type", () => {
    const created: Array<{ path: string; extension: string }> = [];
    const modal = new NewFileModal({} as never, { folder: "d", initialExtension: "txt", exists: () => false, onCreate: (c) => void created.push({ path: c.path, extension: c.extension }) });
    modal.onOpen();
    const name = __findAllByClass(modal.contentEl, "nfe-newfile-name")[0];
    const ext = __findAllByClass(modal.contentEl, "nfe-newfile-ext")[0];
    const items = () => __findAllByClass(modal.contentEl, "nfe-newfile-item").map((i: { textContent: string; hasClass: (c: string) => boolean }) => `${i.hasClass("is-selected") ? "*" : ""}${i.textContent}`);
    // Starts on the remembered extension, alone at the top of its matches.
    expect(ext.value).toBe("txt");
    expect(items()[0]).toBe("*.txt  (Plain text)");
    ext.value = "tt";
    __fire(ext, "input");
    const shown = items();
    expect(shown.some((s) => s.endsWith(".txt  (Plain text)"))).toBe(true);
    expect(shown.some((s) => s.includes(".http"))).toBe(true);
    expect(shown.some((s) => s.includes(".targets"))).toBe(true);
    expect(shown[0]?.startsWith("*")).toBe(true);
    __fire(ext, "keydown", { key: "ArrowDown" });
    expect(items()[1]?.startsWith("*")).toBe(true);
    __fire(ext, "keydown", { key: "ArrowUp" });
    expect(items()[0]?.startsWith("*")).toBe(true);
    // A click picks a type; Enter in the name field creates with it.
    const target = __findAllByClass(modal.contentEl, "nfe-newfile-item").find((i: { getAttribute: (k: string) => string | null }) => i.getAttribute("data-extension") === "targets");
    __fire(target, "click");
    expect(ext.value).toBe("targets");
    name.value = "build";
    __fire(name, "keydown", { key: "Enter" });
    expect(created).toEqual([{ path: "d/build.targets", extension: "targets" }]);
    // Nothing matching: no selection, Create does nothing.
    const again = new NewFileModal({} as never, { folder: "d", initialExtension: "txt", exists: () => false, onCreate: () => void created.push({ path: "x", extension: "x" }) });
    again.onOpen();
    const ext2 = __findAllByClass(again.contentEl, "nfe-newfile-ext")[0];
    ext2.value = "zzzz";
    __fire(ext2, "input");
    expect(__findAllByClass(again.contentEl, "nfe-newfile-none")).toHaveLength(1);
    __fire(__findAllByClass(again.contentEl, "mod-cta")[0], "click");
    expect(created).toHaveLength(1);
  });
});
