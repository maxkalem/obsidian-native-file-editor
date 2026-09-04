import { describe, expect, it } from "vitest";
import { decideOpenMode } from "../src/core/openMode";

const base = { remembered: null, sizeBytes: 100, largeFileBytes: 1000, lossy: false } as const;

describe("decideOpenMode", () => {
  it("preview first by default", () => {
    expect(decideOpenMode({ ...base, setting: "preview" })).toEqual({ mode: "preview", large: false, readOnly: false });
  });

  it("always editing when asked", () => {
    expect(decideOpenMode({ ...base, setting: "edit" }).mode).toBe("edit");
  });

  it("remember uses the remembered mode and falls back to preview", () => {
    expect(decideOpenMode({ ...base, setting: "remember", remembered: "edit" }).mode).toBe("edit");
    expect(decideOpenMode({ ...base, setting: "remember", remembered: null }).mode).toBe("preview");
  });

  it("a large file opens in preview whatever the setting says, and is flagged", () => {
    const d = decideOpenMode({ ...base, setting: "edit", sizeBytes: 1001 });
    expect(d).toEqual({ mode: "preview", large: true, readOnly: false });
    // Exactly at the threshold is not large.
    expect(decideOpenMode({ ...base, setting: "edit", sizeBytes: 1000 }).large).toBe(false);
  });

  it("a lossy decode is read-only in either mode", () => {
    expect(decideOpenMode({ ...base, setting: "edit", lossy: true })).toEqual({ mode: "edit", large: false, readOnly: true });
  });
});
