import { describe, expect, it } from "vitest";
import { newFilePath, sanitizeBaseName } from "../src/core/newFile";
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
});
