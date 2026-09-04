import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PLUGIN_ID } from "../src/constants";

/**
 * `PLUGIN_ID` is the one string manifest.json and the code have to agree on:
 * Obsidian installs the plugin into a folder named after the manifest id, and
 * every vault path the plugin builds hangs off the constant. Nothing else
 * checks the two against each other.
 */

function repoJson(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8")) as Record<string, unknown>;
}

describe("manifest, package and versions agree", () => {
  it("PLUGIN_ID equals manifest.json id", () => {
    expect(repoJson("manifest.json").id).toBe(PLUGIN_ID);
  });

  it("the install copy of the manifest is the root manifest", () => {
    // native-file-editor/ is build output, but it is also what a manual install
    // copies into .obsidian/plugins/, so a stale copy there is a wrong folder or
    // a wrong version on the device.
    expect(repoJson("native-file-editor/manifest.json")).toEqual(repoJson("manifest.json"));
  });

  it("package.json version equals manifest.json version", () => {
    expect(repoJson("package.json").version).toBe(repoJson("manifest.json").version);
  });

  it("versions.json maps the manifest version to the manifest minAppVersion", () => {
    const manifest = repoJson("manifest.json");
    const versions = repoJson("versions.json");
    expect(versions[String(manifest.version)]).toBe(manifest.minAppVersion);
  });

  it("package.json declares no runtime dependencies", () => {
    const pkg = repoJson("package.json");
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  it("licence is stated identically in package.json and LICENSE", () => {
    expect(repoJson("package.json").license).toBe("GPL-3.0-only");
    const licence = readFileSync(fileURLToPath(new URL("../LICENSE", import.meta.url)), "utf8");
    expect(licence).toContain("GNU GENERAL PUBLIC LICENSE");
    expect(licence).toContain("Version 3");
  });
});
