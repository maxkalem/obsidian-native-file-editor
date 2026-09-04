import { describe, expect, it } from "vitest";
import { decideClaims, describeYielded } from "../src/core/claims";

describe("decideClaims", () => {
  it("takes unowned extensions and yields owned ones", () => {
    const d = decideClaims({
      candidates: ["txt", "ts", "log"],
      owned: { ts: "cm-code-editor" },
      toggles: {},
    });
    expect(d.take).toEqual(["txt", "log"]);
    expect(d.yielded).toEqual([{ ext: "ts", viewType: "cm-code-editor" }]);
    expect(d.disabled).toEqual([]);
  });

  it("a toggle set to true takes an owned extension; false disables an unowned one", () => {
    const d = decideClaims({
      candidates: ["txt", "ts"],
      owned: { ts: "cm-code-editor" },
      toggles: { ts: true, txt: false },
    });
    expect(d.take).toEqual(["ts"]);
    expect(d.yielded).toEqual([]);
    expect(d.disabled).toEqual(["txt"]);
  });

  it("never takes what Obsidian owns, whatever the toggle says", () => {
    const d = decideClaims({ candidates: ["md", "pdf", "txt"], owned: {}, toggles: { md: true } });
    expect(d.take).toEqual(["txt"]);
    expect(d.yielded).toEqual([]);
  });

  it("lower-cases and de-duplicates candidates", () => {
    const d = decideClaims({ candidates: ["TXT", "txt", "Log"], owned: {}, toggles: {} });
    expect(d.take).toEqual(["txt", "log"]);
  });
});

describe("describeYielded", () => {
  it("groups by owner", () => {
    expect(
      describeYielded([
        { ext: "ts", viewType: "cm-code-editor" },
        { ext: "js", viewType: "cm-code-editor" },
        { ext: "csv", viewType: "other-view" },
      ])
    ).toBe("Native File Editor left .ts, .js to cm-code-editor; .csv to other-view. Take them over per extension in its settings.");
  });
});
