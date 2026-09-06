import {
  type DirectoryListing,
  type Transport,
  TransportError,
  defaultRandomSuffix,
  tempSiblingPath,
  toExactArrayBuffer,
  toUint8Array,
} from "./transport";

/**
 * The slice of Obsidian's DataAdapter the mobile transport uses. Named as an
 * interface so a test can drive it with an in-memory fake; the plugin hands in
 * `app.vault.adapter`.
 */
export interface AdapterLike {
  exists(normalizedPath: string): Promise<boolean>;
  readBinary(normalizedPath: string): Promise<ArrayBuffer>;
  writeBinary(normalizedPath: string, data: ArrayBuffer): Promise<void>;
  rename(normalizedPath: string, normalizedNewPath: string): Promise<void>;
  remove(normalizedPath: string): Promise<void>;
  list(normalizedPath: string): Promise<{ files: string[]; folders: string[] }>;
  mkdir(normalizedPath: string): Promise<void>;
}

/** The Web Streams compression API, present in Android WebView and iOS 16.4+. */
export interface StreamCodecs {
  DecompressionStream: new (format: "deflate-raw") => { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> };
  CompressionStream: new (format: "deflate-raw") => { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> };
}

export function loadStreamCodecs(): StreamCodecs {
  const g = globalThis as unknown as Partial<StreamCodecs>;
  if (typeof g.DecompressionStream !== "function" || typeof g.CompressionStream !== "function") {
    throw new TransportError("unsupported", "This WebView has no CompressionStream API.", null);
  }
  return { DecompressionStream: g.DecompressionStream, CompressionStream: g.CompressionStream };
}

async function pipe(
  data: Uint8Array,
  stream: { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> }
): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  // The write side and the read side fail together on a corrupt stream; the
  // write's rejection is caught here so it cannot surface as an unhandled
  // rejection while the read side is the one reporting the error.
  let writeError: unknown = null;
  const writing = writer
    .write(data)
    .then(() => writer.close())
    .catch((e: unknown) => {
      writeError = e;
    });
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await writing;
  if (writeError !== null) throw writeError;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export class MobileTransport implements Transport {
  readonly kind = "mobile" as const;
  private readonly adapter: AdapterLike;
  private readonly codecs: StreamCodecs;
  private readonly random: () => string;

  constructor(adapter: AdapterLike, codecs: StreamCodecs, random: () => string = defaultRandomSuffix) {
    this.adapter = adapter;
    this.codecs = codecs;
    this.random = random;
  }

  async readBinary(vaultPath: string): Promise<Uint8Array> {
    if (!(await this.adapter.exists(vaultPath))) {
      throw new TransportError("not-found", `File not found: ${vaultPath}`, vaultPath);
    }
    try {
      return toUint8Array(await this.adapter.readBinary(vaultPath));
    } catch (e) {
      throw new TransportError("read-failed", `Cannot read ${vaultPath}`, vaultPath, e);
    }
  }

  /**
   * Write a sibling temp file, then rename it over the target. Whether the
   * adapter's rename replaces an existing file on Android is not documented, so
   * when it refuses, the fallback overwrites the target directly and only then
   * removes the temp file: a failure in the overwrite leaves the complete new
   * bytes beside the original under the temp name, and the error names it.
   */
  async writeBinaryAtomic(vaultPath: string, data: Uint8Array): Promise<void> {
    const temp = tempSiblingPath(vaultPath, this.random);
    const buffer = toExactArrayBuffer(data);
    try {
      await this.adapter.writeBinary(temp, buffer);
    } catch (e) {
      await this.adapter.remove(temp).catch(() => undefined);
      throw new TransportError("write-failed", `Cannot write ${vaultPath}`, vaultPath, e);
    }
    try {
      await this.adapter.rename(temp, vaultPath);
      return;
    } catch {
      // Fall through to the overwrite path below.
    }
    try {
      await this.adapter.writeBinary(vaultPath, buffer);
    } catch (e) {
      throw new TransportError(
        "write-failed",
        `Cannot replace ${vaultPath}; the new content is in ${temp}`,
        vaultPath,
        e
      );
    }
    await this.adapter.remove(temp).catch(() => undefined);
  }

  async inflateRaw(data: Uint8Array): Promise<Uint8Array> {
    try {
      return await pipe(data, new this.codecs.DecompressionStream("deflate-raw"));
    } catch (e) {
      throw new TransportError("inflate-failed", "Corrupt deflate stream", null, e);
    }
  }

  async deflateRaw(data: Uint8Array): Promise<Uint8Array> {
    try {
      return await pipe(data, new this.codecs.CompressionStream("deflate-raw"));
    } catch (e) {
      throw new TransportError("deflate-failed", "Cannot compress", null, e);
    }
  }

  async listDir(vaultPath: string): Promise<DirectoryListing> {
    try {
      const l = await this.adapter.list(vaultPath);
      return { files: [...l.files].sort(), folders: [...l.folders].sort() };
    } catch (e) {
      throw new TransportError("list-failed", `Cannot list ${vaultPath}`, vaultPath, e);
    }
  }

  /** The adapter's mkdir creates missing parents and accepts an existing folder. */
  async mkdir(vaultPath: string): Promise<void> {
    try {
      await this.adapter.mkdir(vaultPath);
    } catch (e) {
      throw new TransportError("mkdir-failed", `Cannot create ${vaultPath}`, vaultPath, e);
    }
  }
}
