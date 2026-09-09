import { describe, expect, it } from "vitest";
import { __findAllByClass, __fire } from "./mocks/obsidian";
import { filterExtensions, isSubsequence, newFilePath, ownExtension, sanitizeBaseName, typedExtension } from "../src/core/newFile";
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

  it("no extension makes a bare name; a typed extension is cleaned", () => {
    expect(newFilePath("d", "1", "", () => false)).toBe("d/1");
    expect(sanitizeBaseName("1", "")).toBe("1");
    expect(typedExtension(" .zzz ")).toBe("zzz");
    expect(typedExtension("my ext!")).toBe("myext");
    expect(typedExtension("...")).toBe("");
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

describe("ownExtension", () => {
  it("reads the extension typed in a name, none for a dot-file or a trailing dot", () => {
    expect(ownExtension("1.ts")).toBe("ts");
    expect(ownExtension(" notes.TXT ")).toBe("TXT");
    expect(ownExtension("archive.tar.gz")).toBe("gz");
    expect(ownExtension("notes")).toBeNull();
    expect(ownExtension(".gitignore")).toBeNull();
    expect(ownExtension("archive.")).toBeNull();
    expect(ownExtension("a.this-extension-is-too-long-x")).toBeNull();
  });
});

describe("NewFileModal", () => {
  const open = (onCreate: (c: { path: string; extension: string }) => void, last = "txt") => {
    const modal = new NewFileModal({} as never, { folder: "d", lastExtension: last, exists: () => false, onCreate: (c) => onCreate({ path: c.path, extension: c.extension }) });
    modal.onOpen();
    const name = __findAllByClass(modal.contentEl, "nfe-newfile-name")[0];
    const ext = __findAllByClass(modal.contentEl, "nfe-newfile-ext")[0];
    const list = __findAllByClass(modal.contentEl, "nfe-newfile-list")[0];
    const warning = __findAllByClass(modal.contentEl, "nfe-newfile-warning")[0];
    const items = () => __findAllByClass(modal.contentEl, "nfe-newfile-item").map((i: { textContent: string; hasClass: (c: string) => boolean }) => `${i.hasClass("is-selected") ? "*" : ""}${i.textContent}`);
    return { modal, name, ext, list, warning, items, create: __findAllByClass(modal.contentEl, "mod-cta")[0] };
  };

  it("starts with an empty type field naming the last type in its placeholder, and no list until something is typed; the list then stays", () => {
    const m = open(() => undefined, "ts");
    expect(m.ext.value).toBe("");
    expect(m.ext.placeholder).toBe("Extension or language (last: .ts)");
    expect(m.list.hasClass("nfe-hidden")).toBe(true);
    expect(m.items()).toEqual([]);
    m.ext.value = "t";
    __fire(m.ext, "input");
    expect(m.list.hasClass("nfe-hidden")).toBe(false);
    expect(m.items().length).toBeGreaterThan(5);
    m.ext.value = "";
    __fire(m.ext, "input");
    expect(m.list.hasClass("nfe-hidden")).toBe(false);
    expect(m.items().length).toBeGreaterThan(200);
    expect(open(() => undefined, "").ext.placeholder).toBe("Extension or language");
  });

  it("filters the type list as the user types, moves the selection with the arrows, and creates with the selected type", () => {
    const created: Array<{ path: string; extension: string }> = [];
    const m = open((c) => void created.push(c));
    m.ext.value = "tt";
    __fire(m.ext, "input");
    const shown = m.items();
    expect(shown.some((s) => s.endsWith(".txt  (Plain text)"))).toBe(true);
    expect(shown.some((s) => s.includes(".http"))).toBe(true);
    expect(shown.some((s) => s.includes(".targets"))).toBe(true);
    expect(shown[0]?.startsWith("*")).toBe(true);
    __fire(m.ext, "keydown", { key: "ArrowDown" });
    expect(m.items()[1]?.startsWith("*")).toBe(true);
    __fire(m.ext, "keydown", { key: "ArrowUp" });
    expect(m.items()[0]?.startsWith("*")).toBe(true);
    // A click picks a type; Enter in the name field creates with it, stripping the same suffix from the name.
    const target = __findAllByClass(m.modal.contentEl, "nfe-newfile-item").find((i: { getAttribute: (k: string) => string | null }) => i.getAttribute("data-extension") === "targets");
    __fire(target, "click");
    expect(m.ext.value).toBe("targets");
    m.name.value = "build.targets";
    __fire(m.name, "keydown", { key: "Enter" });
    expect(created).toEqual([{ path: "d/build.targets", extension: "targets" }]);
    // Nothing matching: no selection, Create does nothing.
    const again = open((c) => void created.push(c));
    again.ext.value = "zzzz";
    __fire(again.ext, "input");
    expect(__findAllByClass(again.modal.contentEl, "nfe-newfile-none")).toHaveLength(1);
    __fire(again.create, "click");
    expect(created).toHaveLength(1);
  });

  it("an extension typed in the name is the file's while the type field is empty, list shown or not; a type in the field wins over it", () => {
    const created: Array<{ path: string; extension: string }> = [];
    let m = open((c) => void created.push(c));
    m.name.value = "1.ts";
    __fire(m.name, "keydown", { key: "Enter" });
    expect(created).toEqual([{ path: "d/1.ts", extension: "ts" }]);
    // The list was opened and emptied again: the field is empty, the name decides (2026-09-09: 1.ts.4th).
    m = open((c) => void created.push(c));
    m.ext.value = "x";
    __fire(m.ext, "input");
    m.ext.value = "";
    __fire(m.ext, "input");
    m.name.value = "1.ts";
    __fire(m.create, "click");
    expect(created[1]).toEqual({ path: "d/1.ts", extension: "ts" });
    // A type in the field: the name keeps its own dots, the type is appended.
    m = open((c) => void created.push(c));
    m.ext.value = "ts";
    __fire(m.ext, "input");
    m.name.value = "archive.tar";
    __fire(m.create, "click");
    expect(created[2]).toEqual({ path: "d/archive.tar.ts", extension: "ts" });
    // No type anywhere (2026-09-09: Create did nothing): a warning, then a file without an extension.
    m = open((c) => void created.push(c));
    m.name.value = "1";
    __fire(m.create, "click");
    expect(created).toHaveLength(3);
    expect(m.warning.textContent).toBe("Native File Editor does not open a file without an extension. The file is created all the same; Obsidian decides what opens it.");
    __fire(m.create, "click");
    expect(created[3]).toEqual({ path: "d/1", extension: "" });
    // A type typed into the field that matches nothing ("No file type matches") is taken as typed, after the warning.
    m = open((c) => void created.push(c));
    m.name.value = "1";
    m.ext.value = "zzz";
    __fire(m.ext, "input");
    expect(__findAllByClass(m.modal.contentEl, "nfe-newfile-none")).toHaveLength(1);
    __fire(m.name, "keydown", { key: "Enter" });
    expect(m.warning.textContent).toBe("Native File Editor does not open .zzz files. The file is created all the same; Obsidian decides what opens it.");
    __fire(m.name, "keydown", { key: "Enter" });
    expect(created[4]).toEqual({ path: "d/1.zzz", extension: "zzz" });
  });

  it("a type the plugin does not open warns once, then Create anyway goes through; editing clears the warning", () => {
    const created: Array<{ path: string; extension: string }> = [];
    const m = open((c) => void created.push(c));
    m.name.value = "report.docy";
    __fire(m.name, "keydown", { key: "Enter" });
    expect(created).toEqual([]);
    expect(m.warning.hasClass("nfe-hidden")).toBe(false);
    expect(m.warning.textContent).toBe("Native File Editor does not open .docy files. The file is created all the same; Obsidian decides what opens it.");
    expect(m.create.textContent).toBe("Create anyway");
    // A change to the name withdraws the warning; the same extension again warns again.
    m.name.value = "report2.docy";
    __fire(m.name, "input");
    expect(m.warning.hasClass("nfe-hidden")).toBe(true);
    expect(m.create.textContent).toBe("Create");
    __fire(m.create, "click");
    expect(created).toEqual([]);
    __fire(m.create, "click");
    expect(created).toEqual([{ path: "d/report2.docy", extension: "docy" }]);
  });
});
