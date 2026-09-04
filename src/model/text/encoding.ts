/**
 * Bytes to text and back, preserving what the file had: byte order mark,
 * encoding and the dominant line ending. Pure: no DOM, no Obsidian. TextDecoder
 * and TextEncoder are platform globals on both platforms and in Node.
 */

export type Encoding = "utf-8" | "utf-16le" | "utf-16be" | "windows-1251" | "windows-1252";

export type LineEnding = "\n" | "\r\n" | "\r";

export interface TextInfo {
  readonly encoding: Encoding;
  /** True when the file started with a byte order mark for its encoding. */
  readonly bom: boolean;
  /** The line ending most lines used; `\n` for a file with no line breaks. */
  readonly eol: LineEnding;
  /**
   * True when the bytes were not valid in the detected encoding and the text
   * is a guess (windows-1251 or windows-1252). A guessed text is shown
   * read-only, because writing it back would silently change bytes.
   */
  readonly lossy: boolean;
}

export interface DecodedText {
  /** Text with every line ending normalised to `\n`, the form an editor wants. */
  readonly text: string;
  readonly info: TextInfo;
}

const UTF8_BOM = [0xef, 0xbb, 0xbf];

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (bytes[i] !== prefix[i]) return false;
  return true;
}

/** BOM detection only; the fallback heuristics live in `decodeText`. */
export function detectBom(bytes: Uint8Array): { encoding: Encoding; bomLength: number } | null {
  if (startsWith(bytes, UTF8_BOM)) return { encoding: "utf-8", bomLength: 3 };
  if (startsWith(bytes, [0xff, 0xfe])) return { encoding: "utf-16le", bomLength: 2 };
  if (startsWith(bytes, [0xfe, 0xff])) return { encoding: "utf-16be", bomLength: 2 };
  return null;
}

/**
 * Count each line-ending form once, so `\r\n` is not also counted as a bare
 * `\r` and a bare `\n`. Ties go to `\n`, then `\r\n`.
 */
export function detectLineEnding(text: string): LineEnding {
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x0d) {
      if (text.charCodeAt(i + 1) === 0x0a) {
        crlf++;
        i++;
      } else {
        cr++;
      }
    } else if (c === 0x0a) {
      lf++;
    }
  }
  if (lf >= crlf && lf >= cr) return "\n";
  if (crlf >= cr) return "\r\n";
  return "\r";
}

/** Every `\r\n` and bare `\r` becomes `\n`. */
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function decodeWith(label: string, bytes: Uint8Array, fatal: boolean): string | null {
  try {
    return new TextDecoder(label, { fatal }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Among the two single-byte fallbacks, pick the one whose decoding of the
 * high bytes looks like letters of its own script. windows-1251 maps 0xC0-0xFF
 * to Cyrillic letters; windows-1252 maps most of that range to accented Latin.
 * A file that is mostly ASCII with a few high bytes is decided by those few.
 */
export function guessSingleByteEncoding(bytes: Uint8Array): "windows-1251" | "windows-1252" {
  let cyrillicRange = 0;
  let high = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0;
    if (b >= 0x80) {
      high++;
      if (b >= 0xc0) cyrillicRange++;
    }
  }
  if (high === 0) return "windows-1252";
  return cyrillicRange / high >= 0.6 ? "windows-1251" : "windows-1252";
}

/**
 * The policy: honour a BOM; otherwise assume UTF-8; if that is not valid,
 * decode with a single-byte guess and mark the result lossy.
 */
export function decodeText(bytes: Uint8Array): DecodedText {
  const bom = detectBom(bytes);
  const body = bom ? bytes.subarray(bom.bomLength) : bytes;
  const primary: Encoding = bom ? bom.encoding : "utf-8";

  const strict = decodeWith(primary, body, true);
  if (strict !== null) {
    return {
      text: normalizeLineEndings(strict),
      info: { encoding: primary, bom: bom !== null, eol: detectLineEnding(strict), lossy: false },
    };
  }

  // UTF-16 with a BOM that does not decode is a broken file; there is no
  // better guess than a non-fatal decode of the same encoding.
  if (bom && primary !== "utf-8") {
    const loose = decodeWith(primary, body, false) ?? "";
    return {
      text: normalizeLineEndings(loose),
      info: { encoding: primary, bom: true, eol: detectLineEnding(loose), lossy: true },
    };
  }

  const guess = guessSingleByteEncoding(body);
  const loose = decodeWith(guess, body, false) ?? decodeWith("utf-8", body, false) ?? "";
  return {
    text: normalizeLineEndings(loose),
    info: { encoding: guess, bom: false, eol: detectLineEnding(loose), lossy: true },
  };
}

function encodeUtf16(text: string, littleEndian: boolean, bom: boolean): Uint8Array {
  const units = text.length;
  const out = new Uint8Array((units + (bom ? 1 : 0)) * 2);
  const view = new DataView(out.buffer);
  let offset = 0;
  if (bom) {
    view.setUint16(0, 0xfeff, littleEndian);
    offset = 2;
  }
  for (let i = 0; i < units; i++) {
    view.setUint16(offset + i * 2, text.charCodeAt(i), littleEndian);
  }
  return out;
}

/**
 * Text back to bytes in the form the file had. Refuses a lossy decode: there
 * is no encoder for the single-byte code pages, and writing the guess would
 * rewrite bytes the user never touched.
 */
export function encodeText(text: string, info: TextInfo): Uint8Array {
  if (info.lossy) {
    throw new Error(`Cannot write a file that was decoded as a guess (${info.encoding}).`);
  }
  const withEol = info.eol === "\n" ? text : text.replace(/\n/g, info.eol);
  switch (info.encoding) {
    case "utf-8": {
      const body = new TextEncoder().encode(withEol);
      if (!info.bom) return body;
      const out = new Uint8Array(body.length + 3);
      out.set(UTF8_BOM, 0);
      out.set(body, 3);
      return out;
    }
    case "utf-16le":
      return encodeUtf16(withEol, true, info.bom);
    case "utf-16be":
      return encodeUtf16(withEol, false, info.bom);
    default:
      throw new Error(`No encoder for ${info.encoding}.`);
  }
}

/** Short labels for the head bar. */
export function describeEncoding(info: TextInfo): string {
  const enc =
    info.encoding === "utf-8"
      ? "UTF-8"
      : info.encoding === "utf-16le"
        ? "UTF-16 LE"
        : info.encoding === "utf-16be"
          ? "UTF-16 BE"
          : info.encoding;
  const bom = info.bom ? " with BOM" : "";
  const guess = info.lossy ? " (guess)" : "";
  return `${enc}${bom}${guess}`;
}

export function describeLineEnding(eol: LineEnding): string {
  return eol === "\n" ? "LF" : eol === "\r\n" ? "CRLF" : "CR";
}
