import {
  type DirectoryListing,
  type Transport,
  TransportError,
  defaultRandomSuffix,
  tempSiblingPath,
  toUint8Array,
} from "./transport";

/**
 * The slice of Node the desktop transport uses, named so a test can hand in the
 * real modules against a temp directory and the plugin can hand in what
 * Electron's `require` returns. Nothing here is imported at module level: this
 * file is part of the one main.js that also runs on a phone, where `require`
 * does not exist.
 */
export interface NodeModules {
  fs: {
    promises: {
      readFile(path: string): Promise<Uint8Array>;
      writeFile(path: string, data: Uint8Array): Promise<void>;
      rename(from: string, to: string): Promise<void>;
      unlink(path: string): Promise<void>;
      readdir(path: string, options: { withFileTypes: true }): Promise<Array<{ name: string; isFile(): boolean; isDirectory(): boolean }>>;
    };
  };
  path: {
    join(...parts: string[]): string;
    sep: string;
  };
  zlib: {
    inflateRawSync(data: Uint8Array): Uint8Array;
    deflateRawSync(data: Uint8Array): Uint8Array;
  };
}

/** Electron's renderer exposes CommonJS `require`; guarded by the caller. */
export function loadNodeModules(): NodeModules {
  const req = (globalThis as unknown as { require?: (id: string) => unknown }).require;
  if (typeof req !== "function") {
    throw new TransportError("unsupported", "Node require is not available in this environment.", null);
  }
  return {
    fs: req("fs") as NodeModules["fs"],
    path: req("path") as NodeModules["path"],
    zlib: req("zlib") as NodeModules["zlib"],
  };
}

function errnoCode(e: unknown): string | undefined {
  return typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : undefined;
}

export class DesktopTransport implements Transport {
  readonly kind = "desktop" as const;
  private readonly basePath: string;
  private readonly node: NodeModules;
  private readonly random: () => string;

  constructor(basePath: string, node: NodeModules, random: () => string = defaultRandomSuffix) {
    this.basePath = basePath;
    this.node = node;
    this.random = random;
  }

  /** Vault-relative, forward-slash path to an absolute OS path. */
  absolute(vaultPath: string): string {
    return this.node.path.join(this.basePath, ...vaultPath.split("/").filter((s) => s.length > 0));
  }

  async readBinary(vaultPath: string): Promise<Uint8Array> {
    try {
      return toUint8Array(await this.node.fs.promises.readFile(this.absolute(vaultPath)));
    } catch (e) {
      const code = errnoCode(e);
      if (code === "ENOENT") throw new TransportError("not-found", `File not found: ${vaultPath}`, vaultPath, e);
      if (code === "EISDIR") throw new TransportError("not-a-file", `Not a file: ${vaultPath}`, vaultPath, e);
      throw new TransportError("read-failed", `Cannot read ${vaultPath}`, vaultPath, e);
    }
  }

  /**
   * Write to a sibling temp name, then rename over the target. Node's rename
   * replaces an existing destination on Windows as well as on POSIX, and a
   * rename inside one folder is atomic on every filesystem Obsidian runs on.
   * On any failure the temp file is removed and the original is untouched.
   */
  async writeBinaryAtomic(vaultPath: string, data: Uint8Array): Promise<void> {
    const target = this.absolute(vaultPath);
    const temp = this.absolute(tempSiblingPath(vaultPath, this.random));
    try {
      await this.node.fs.promises.writeFile(temp, data);
    } catch (e) {
      await this.node.fs.promises.unlink(temp).catch(() => undefined);
      throw new TransportError("write-failed", `Cannot write ${vaultPath}`, vaultPath, e);
    }
    try {
      await this.node.fs.promises.rename(temp, target);
    } catch (e) {
      await this.node.fs.promises.unlink(temp).catch(() => undefined);
      throw new TransportError("rename-failed", `Cannot replace ${vaultPath}`, vaultPath, e);
    }
  }

  inflateRaw(data: Uint8Array): Promise<Uint8Array> {
    try {
      return Promise.resolve(toUint8Array(this.node.zlib.inflateRawSync(data)));
    } catch (e) {
      return Promise.reject(new TransportError("inflate-failed", "Corrupt deflate stream", null, e));
    }
  }

  deflateRaw(data: Uint8Array): Promise<Uint8Array> {
    try {
      return Promise.resolve(toUint8Array(this.node.zlib.deflateRawSync(data)));
    } catch (e) {
      return Promise.reject(new TransportError("deflate-failed", "Cannot compress", null, e));
    }
  }

  async listDir(vaultPath: string): Promise<DirectoryListing> {
    let entries;
    try {
      entries = await this.node.fs.promises.readdir(this.absolute(vaultPath), { withFileTypes: true });
    } catch (e) {
      throw new TransportError("list-failed", `Cannot list ${vaultPath}`, vaultPath, e);
    }
    const prefix = vaultPath === "" || vaultPath === "/" ? "" : `${vaultPath.replace(/\/+$/, "")}/`;
    const files: string[] = [];
    const folders: string[] = [];
    for (const d of entries) {
      if (d.isFile()) files.push(prefix + d.name);
      else if (d.isDirectory()) folders.push(prefix + d.name);
    }
    files.sort();
    folders.sort();
    return { files, folders };
  }
}
