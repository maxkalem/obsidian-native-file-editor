import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeText, encodeText } from "../../src/model/text/encoding";
import { DesktopTransport } from "../../src/platform/desktop";
import { type AdapterLike, MobileTransport } from "../../src/platform/mobile";
import type { Transport } from "../../src/platform/transport";

/**
 * Every fixture under fixtures/text goes through both transports and the text
 * model: read, decode, encode, write back, and the bytes on disk must be
 * identical to the fixture. Then an edit is written and read back through the
 * other transport, which is the closest the desktop machine gets to "the
 * phone reads what the desktop wrote".
 */

const FIXTURES = fileURLToPath(new URL("./fixtures/text/", import.meta.url));

/** A real-filesystem adapter, so the mobile transport also touches real files. */
class DirectoryAdapter implements AdapterLike {
  constructor(private readonly base: string) {}
  private abs(p: string): string {
    return path.join(this.base, ...p.split("/"));
  }
  async exists(p: string): Promise<boolean> {
    return fs.existsSync(this.abs(p));
  }
  async readBinary(p: string): Promise<ArrayBuffer> {
    const b = fs.readFileSync(this.abs(p));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  }
  async writeBinary(p: string, data: ArrayBuffer): Promise<void> {
    fs.writeFileSync(this.abs(p), new Uint8Array(data));
  }
  async rename(from: string, to: string): Promise<void> {
    fs.renameSync(this.abs(from), this.abs(to));
  }
  async remove(p: string): Promise<void> {
    fs.rmSync(this.abs(p), { force: true });
  }
  async list(p: string): Promise<{ files: string[]; folders: string[] }> {
    const prefix = p === "" ? "" : `${p}/`;
    const files: string[] = [];
    const folders: string[] = [];
    for (const d of fs.readdirSync(this.abs(p), { withFileTypes: true })) {
      (d.isDirectory() ? folders : files).push(prefix + d.name);
    }
    return { files, folders };
  }
}

let tmp: string;
let desktop: Transport;
let mobile: Transport;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nfe-e2e-"));
  desktop = new DesktopTransport(tmp, { fs: fs as never, path, zlib });
  mobile = new MobileTransport(new DirectoryAdapter(tmp), {
    DecompressionStream: globalThis.DecompressionStream as never,
    CompressionStream: globalThis.CompressionStream as never,
  });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const fixtures = fs.readdirSync(FIXTURES).filter((n) => !n.startsWith("."));

describe("text fixtures", () => {
  it("has fixtures to run, or the suite went dead", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  describe.each(fixtures)("%s", (name) => {
    const original = new Uint8Array(fs.readFileSync(path.join(FIXTURES, name)));

    it.each([
      ["desktop", () => desktop],
      ["mobile", () => mobile],
    ])("%s: read, decode, encode, write gives identical bytes", async (_k, get) => {
      fs.writeFileSync(path.join(tmp, name), original);
      const t = get();
      const bytes = await t.readBinary(name);
      expect(bytes).toEqual(original);
      const d = decodeText(bytes);
      if (d.info.lossy) {
        // A guessed decode is read-only by design; the model refuses to encode it.
        expect(() => encodeText(d.text, d.info)).toThrow();
        return;
      }
      await t.writeBinaryAtomic(name, encodeText(d.text, d.info));
      expect(new Uint8Array(fs.readFileSync(path.join(tmp, name)))).toEqual(original);
      expect(fs.readdirSync(tmp)).toEqual([name]);
    });

    it("an edit written by one transport is read by the other with the file's own line ending", async () => {
      fs.writeFileSync(path.join(tmp, name), original);
      const d = decodeText(await desktop.readBinary(name));
      if (d.info.lossy) return;
      const edited = `${d.text}\nappended line`;
      await desktop.writeBinaryAtomic(name, encodeText(edited, d.info));
      const back = decodeText(await mobile.readBinary(name));
      expect(back.text).toBe(edited);
      expect(back.info).toEqual(d.info);
      const raw = fs.readFileSync(path.join(tmp, name));
      if (d.info.eol === "\r\n" && d.info.encoding === "utf-8") {
        expect(raw.subarray(raw.length - 15).toString("latin1")).toBe("\r\nappended line");
      }
    });
  });
});
