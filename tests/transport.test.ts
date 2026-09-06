import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DesktopTransport } from "../src/platform/desktop";
import { type AdapterLike, MobileTransport } from "../src/platform/mobile";
import { chooseTransportKind } from "../src/platform/select";
import { type Transport, TransportError, tempSiblingPath } from "../src/platform/transport";

/**
 * Both transports against the same expectations: the desktop one over a real
 * temp directory with the real Node modules, the mobile one over an in-memory
 * adapter with Node's own CompressionStream (the same Web API the WebView has).
 */

class FakeAdapter implements AdapterLike {
  files = new Map<string, Uint8Array>();
  /** Set to make rename refuse, the way an adapter that will not overwrite would. */
  renameFails = false;
  writes: string[] = [];
  async exists(p: string): Promise<boolean> {
    return this.files.has(p);
  }
  async readBinary(p: string): Promise<ArrayBuffer> {
    const f = this.files.get(p);
    if (!f) throw new Error("ENOENT");
    return f.slice().buffer;
  }
  async writeBinary(p: string, data: ArrayBuffer): Promise<void> {
    this.writes.push(p);
    this.files.set(p, new Uint8Array(data.slice(0)));
  }
  async rename(from: string, to: string): Promise<void> {
    if (this.renameFails) throw new Error("Destination exists");
    const f = this.files.get(from);
    if (!f) throw new Error("ENOENT");
    this.files.delete(from);
    this.files.set(to, f);
  }
  async remove(p: string): Promise<void> {
    this.files.delete(p);
  }
  dirs = new Set<string>();
  async mkdir(p: string): Promise<void> {
    this.dirs.add(p);
  }
  async list(p: string): Promise<{ files: string[]; folders: string[] }> {
    const prefix = p === "" ? "" : `${p}/`;
    const files = new Set<string>();
    const folders = new Set<string>();
    for (const k of this.files.keys()) {
      if (!k.startsWith(prefix)) continue;
      const rest = k.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash < 0) files.add(k);
      else folders.add(prefix + rest.slice(0, slash));
    }
    return { files: [...files], folders: [...folders] };
  }
}

let tmp: string;
let adapter: FakeAdapter;
const fixedRandom = () => "abc12345";

function makeDesktop(): DesktopTransport {
  return new DesktopTransport(tmp, { fs: fs as never, path, zlib }, fixedRandom);
}
function makeMobile(): MobileTransport {
  return new MobileTransport(
    adapter,
    { DecompressionStream: globalThis.DecompressionStream as never, CompressionStream: globalThis.CompressionStream as never },
    fixedRandom
  );
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nfe-transport-"));
  adapter = new FakeAdapter();
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("tempSiblingPath", () => {
  it("is a dot-file in the same folder", () => {
    expect(tempSiblingPath("a/b/c.txt", fixedRandom)).toBe("a/b/.c.txt.nfe-tmp-abc12345");
    expect(tempSiblingPath("c.txt", fixedRandom)).toBe(".c.txt.nfe-tmp-abc12345");
  });
});

describe("chooseTransportKind", () => {
  it("uses Node only on the desktop app with a filesystem adapter", () => {
    expect(chooseTransportKind({ isDesktopApp: true, hasFileSystemAdapter: true })).toBe("desktop");
    expect(chooseTransportKind({ isDesktopApp: true, hasFileSystemAdapter: false })).toBe("mobile");
    expect(chooseTransportKind({ isDesktopApp: false, hasFileSystemAdapter: true })).toBe("mobile");
    expect(chooseTransportKind({ isDesktopApp: false, hasFileSystemAdapter: false })).toBe("mobile");
  });
});

const seedDesktop = (rel: string, data: Uint8Array) => {
  const abs = path.join(tmp, ...rel.split("/"));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, data);
};
const seedMobile = (rel: string, data: Uint8Array) => adapter.files.set(rel, data);

describe.each<[string, () => Transport, (rel: string, data: Uint8Array) => void, (rel: string) => Uint8Array | null, (rel: string) => string[]]>([
  [
    "desktop",
    makeDesktop,
    seedDesktop,
    (rel) => {
      const abs = path.join(tmp, ...rel.split("/"));
      return fs.existsSync(abs) ? new Uint8Array(fs.readFileSync(abs)) : null;
    },
    (rel) => fs.readdirSync(path.join(tmp, ...rel.split("/").filter(Boolean))),
  ],
  [
    "mobile",
    makeMobile,
    seedMobile,
    (rel) => adapter.files.get(rel) ?? null,
    (rel) => [...adapter.files.keys()].filter((k) => k.startsWith(rel === "" ? "" : `${rel}/`)).map((k) => k.slice(rel === "" ? 0 : rel.length + 1)),
  ],
])("%s transport", (_name, make, seed, readBack, entries) => {
  it("reads what is there and reports what is not", async () => {
    seed("dir/a.txt", new Uint8Array([1, 2, 3]));
    const t = make();
    expect(await t.readBinary("dir/a.txt")).toEqual(new Uint8Array([1, 2, 3]));
    await expect(t.readBinary("dir/missing.txt")).rejects.toMatchObject({ name: "TransportError", code: "not-found" });
  });

  it("writes the whole file and leaves no temp file behind", async () => {
    seed("dir/a.txt", new Uint8Array([1, 2, 3]));
    const t = make();
    await t.writeBinaryAtomic("dir/a.txt", new Uint8Array([9, 8]));
    expect(readBack("dir/a.txt")).toEqual(new Uint8Array([9, 8]));
    expect(entries("dir").filter((n) => n.includes("nfe-tmp"))).toEqual([]);
  });

  it("writes a subarray view exactly, not its whole underlying buffer", async () => {
    seed("v.bin", new Uint8Array([0]));
    const t = make();
    const big = new Uint8Array([1, 2, 3, 4, 5, 6]);
    await t.writeBinaryAtomic("v.bin", big.subarray(2, 4));
    expect(readBack("v.bin")).toEqual(new Uint8Array([3, 4]));
  });

  it("inflate and deflate round trip, and inflate refuses garbage", async () => {
    const t = make();
    const text = new TextEncoder().encode("hello hello hello hello hello");
    const packed = await t.deflateRaw(text);
    expect(packed.byteLength).toBeLessThan(text.byteLength);
    expect(await t.inflateRaw(packed)).toEqual(text);
    // Cross-check against Node's zlib so the two implementations agree on
    // the raw format (no zlib header, the method ZIP entries use).
    expect(new Uint8Array(zlib.inflateRawSync(packed))).toEqual(text);
    await expect(t.inflateRaw(new Uint8Array([0xff, 0xfe, 0x00, 0x01]))).rejects.toBeInstanceOf(TransportError);
  });

  it("lists files and folders directly inside a folder, sorted", async () => {
    seed("root/b.txt", new Uint8Array([1]));
    seed("root/a.txt", new Uint8Array([1]));
    seed("root/sub/c.txt", new Uint8Array([1]));
    const t = make();
    expect(await t.listDir("root")).toEqual({ files: ["root/a.txt", "root/b.txt"], folders: ["root/sub"] });
  });

  it("mkdir creates missing parents and accepts an existing folder; a write into it then works", async () => {
    const t = make();
    await t.mkdir("new/deep/folder");
    await t.mkdir("new/deep/folder");
    await t.writeBinaryAtomic("new/deep/folder/f.txt", new Uint8Array([7]));
    expect(readBack("new/deep/folder/f.txt")).toEqual(new Uint8Array([7]));
  });
});

describe("desktop mkdir failure", () => {
  it("is a TransportError with the mkdir-failed code", async () => {
    const failing = { fs: { promises: { ...fs.promises, mkdir: async () => Promise.reject(Object.assign(new Error("EACCES"), { code: "EACCES" })) } }, path, zlib };
    const t = new DesktopTransport(tmp, failing as never, fixedRandom);
    await expect(t.mkdir("x")).rejects.toMatchObject({ code: "mkdir-failed" });
  });
});

describe("desktop transport atomicity", () => {
  it("a failed rename leaves the original untouched and removes the temp file", async () => {
    seedDesktop("a.txt", new Uint8Array([1]));
    const failing = {
      fs: {
        promises: {
          ...fs.promises,
          rename: async () => {
            throw Object.assign(new Error("EPERM"), { code: "EPERM" });
          },
        },
      } as never,
      path,
      zlib,
    };
    const t = new DesktopTransport(tmp, failing, fixedRandom);
    await expect(t.writeBinaryAtomic("a.txt", new Uint8Array([2]))).rejects.toMatchObject({ code: "rename-failed" });
    expect(new Uint8Array(fs.readFileSync(path.join(tmp, "a.txt")))).toEqual(new Uint8Array([1]));
    expect(fs.readdirSync(tmp)).toEqual(["a.txt"]);
  });

  it("maps a directory read to not-a-file", async () => {
    fs.mkdirSync(path.join(tmp, "d"));
    await expect(makeDesktop().readBinary("d")).rejects.toMatchObject({ code: "not-a-file" });
  });
});

describe("mobile transport fallback", () => {
  it("overwrites in place when the adapter refuses the rename, then removes the temp file", async () => {
    adapter.files.set("a.txt", new Uint8Array([1]));
    adapter.renameFails = true;
    await makeMobile().writeBinaryAtomic("a.txt", new Uint8Array([2]));
    expect(adapter.files.get("a.txt")).toEqual(new Uint8Array([2]));
    expect([...adapter.files.keys()]).toEqual(["a.txt"]);
    expect(adapter.writes).toEqual([".a.txt.nfe-tmp-abc12345", "a.txt"]);
  });

  it("names the temp file when the fallback overwrite fails", async () => {
    adapter.files.set("a.txt", new Uint8Array([1]));
    adapter.renameFails = true;
    const original = adapter.writeBinary.bind(adapter);
    adapter.writeBinary = async (p, data) => {
      if (p === "a.txt") throw new Error("disk full");
      await original(p, data);
    };
    await expect(makeMobile().writeBinaryAtomic("a.txt", new Uint8Array([2]))).rejects.toMatchObject({
      code: "write-failed",
      message: expect.stringContaining(".a.txt.nfe-tmp-abc12345"),
    });
    expect(adapter.files.get("a.txt")).toEqual(new Uint8Array([1]));
    expect(adapter.files.get(".a.txt.nfe-tmp-abc12345")).toEqual(new Uint8Array([2]));
  });
});
