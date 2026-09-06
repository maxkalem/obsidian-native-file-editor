/**
 * The transport is the only code that knows which platform it runs on.
 * Everything above it takes and returns Uint8Array and vault-relative paths
 * with forward slashes.
 */

export interface DirectoryListing {
  /** Vault-relative paths of the files directly inside the folder. */
  readonly files: string[];
  /** Vault-relative paths of the folders directly inside the folder. */
  readonly folders: string[];
}

export interface Transport {
  readonly kind: "desktop" | "mobile";
  readBinary(vaultPath: string): Promise<Uint8Array>;
  /**
   * Writes the whole file or leaves the original in place. The desktop
   * implementation writes a sibling temp file and renames it over the target;
   * the mobile implementation does the same through the vault adapter, with the
   * fallback described in mobile.ts when the adapter refuses the rename.
   */
  writeBinaryAtomic(vaultPath: string, data: Uint8Array): Promise<void>;
  /** Raw deflate (no zlib header), the method inside ZIP archives. */
  inflateRaw(data: Uint8Array): Promise<Uint8Array>;
  deflateRaw(data: Uint8Array): Promise<Uint8Array>;
  listDir(vaultPath: string): Promise<DirectoryListing>;
  /** Creates the folder and every missing parent; an existing folder is not an error. */
  mkdir(vaultPath: string): Promise<void>;
}

export type TransportErrorCode =
  | "not-found"
  | "not-a-file"
  | "read-failed"
  | "write-failed"
  | "rename-failed"
  | "inflate-failed"
  | "deflate-failed"
  | "list-failed"
  | "mkdir-failed"
  | "unsupported";

/**
 * One error type for both implementations, so callers branch on a code rather
 * than on the wording of a Node or Capacitor message. `code` is a union that
 * still accepts unknown values on purpose: a newer transport must not crash an
 * older caller.
 */
export class TransportError extends Error {
  readonly code: TransportErrorCode | (string & Record<never, never>);
  readonly path: string | null;
  readonly cause: unknown;
  constructor(code: TransportErrorCode, message: string, path: string | null, cause?: unknown) {
    super(message);
    this.name = "TransportError";
    this.code = code;
    this.path = path;
    this.cause = cause;
  }
}

/**
 * A sibling name in the same folder, so the final rename never crosses a
 * volume, with a leading dot so Obsidian's file index ignores it for the
 * instant it exists: a visible temp file would flash in the explorer and fire
 * create and delete events on every autosave.
 */
export function tempSiblingPath(vaultPath: string, random: () => string): string {
  const slash = vaultPath.lastIndexOf("/");
  const folder = slash >= 0 ? vaultPath.slice(0, slash + 1) : "";
  const name = slash >= 0 ? vaultPath.slice(slash + 1) : vaultPath;
  return `${folder}.${name}.nfe-tmp-${random()}`;
}

export function defaultRandomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Copies a possibly-shared ArrayBuffer view into a standalone Uint8Array. */
export function toUint8Array(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/**
 * A copy whose buffer holds exactly these bytes. Adapter APIs take an
 * ArrayBuffer and would otherwise receive the whole underlying buffer of a
 * subarray view.
 */
export function toExactArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}
