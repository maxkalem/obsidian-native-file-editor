import { describe, expect, it } from "vitest";
import {
  UnencodableError,
  confirmEncoding,
  decodeText,
  describeEncoding,
  describeLineEnding,
  detectBom,
  detectLineEnding,
  encodeText,
  guessSingleByteEncoding,
  normalizeLineEndings,
  utf8CopyInfo,
} from "../src/model/text/encoding";

const utf8 = (s: string) => new TextEncoder().encode(s);

function utf16(s: string, le: boolean, bom: boolean): Uint8Array {
  const out = new Uint8Array((s.length + (bom ? 1 : 0)) * 2);
  const v = new DataView(out.buffer);
  let o = 0;
  if (bom) {
    v.setUint16(0, 0xfeff, le);
    o = 2;
  }
  for (let i = 0; i < s.length; i++) v.setUint16(o + i * 2, s.charCodeAt(i), le);
  return out;
}

describe("BOM detection", () => {
  it("recognises the three BOMs and nothing else", () => {
    expect(detectBom(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toEqual({ encoding: "utf-8", bomLength: 3 });
    expect(detectBom(new Uint8Array([0xff, 0xfe, 0x41, 0x00]))).toEqual({ encoding: "utf-16le", bomLength: 2 });
    expect(detectBom(new Uint8Array([0xfe, 0xff, 0x00, 0x41]))).toEqual({ encoding: "utf-16be", bomLength: 2 });
    expect(detectBom(utf8("plain"))).toBeNull();
    expect(detectBom(new Uint8Array([]))).toBeNull();
  });
});

describe("line endings", () => {
  it("picks the dominant form, counting CRLF once", () => {
    expect(detectLineEnding("a\r\nb\r\nc\nd")).toBe("\r\n");
    expect(detectLineEnding("a\nb\nc\r\nd")).toBe("\n");
    expect(detectLineEnding("a\rb\rc")).toBe("\r");
    expect(detectLineEnding("no breaks")).toBe("\n");
    // A tie goes to LF.
    expect(detectLineEnding("a\r\nb\nc")).toBe("\n");
  });

  it("normalises every form to LF", () => {
    expect(normalizeLineEndings("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
  });

  it("describes them", () => {
    expect(describeLineEnding("\n")).toBe("LF");
    expect(describeLineEnding("\r\n")).toBe("CRLF");
    expect(describeLineEnding("\r")).toBe("CR");
  });
});

describe("decodeText", () => {
  it("decodes plain UTF-8 without a BOM", () => {
    const d = decodeText(utf8("Привіт\nсвіт"));
    expect(d.text).toBe("Привіт\nсвіт");
    expect(d.info).toEqual({ encoding: "utf-8", bom: false, eol: "\n", lossy: false });
  });

  it("strips a UTF-8 BOM and remembers it", () => {
    const d = decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("x\r\ny")]));
    expect(d.text).toBe("x\ny");
    expect(d.info).toEqual({ encoding: "utf-8", bom: true, eol: "\r\n", lossy: false });
  });

  it("decodes UTF-16 LE and BE by BOM", () => {
    expect(decodeText(utf16("héllo", true, true))).toEqual({
      text: "héllo",
      info: { encoding: "utf-16le", bom: true, eol: "\n", lossy: false },
    });
    expect(decodeText(utf16("héllo", false, true))).toEqual({
      text: "héllo",
      info: { encoding: "utf-16be", bom: true, eol: "\n", lossy: false },
    });
  });

  it("falls back to windows-1251 for Cyrillic single-byte text and marks it lossy", () => {
    // "Привіт" in windows-1251.
    const bytes = new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xb3, 0xf2]);
    const d = decodeText(bytes);
    expect(d.info.lossy).toBe(true);
    expect(d.info.encoding).toBe("windows-1251");
    expect(d.text).toBe("Привіт");
  });

  it("falls back to windows-1252 for Latin single-byte text", () => {
    // A lone accented letter (0xc0-0xff) is ambiguous between the two code
    // pages by construction; typographic quotes and the euro sign live in
    // 0x80-0x9f, which only 1252 uses for letters and symbols.
    const bytes = new Uint8Array([0x93, 0x63, 0x61, 0x66, 0x65, 0x94, 0x20, 0x80]);
    const d = decodeText(bytes);
    expect(d.info.lossy).toBe(true);
    expect(d.info.encoding).toBe("windows-1252");
    expect(d.text).toBe("“cafe” €");
  });

  it("empty input is empty UTF-8", () => {
    expect(decodeText(new Uint8Array([]))).toEqual({
      text: "",
      info: { encoding: "utf-8", bom: false, eol: "\n", lossy: false },
    });
  });
});

describe("guessSingleByteEncoding", () => {
  it("is 1252 when there are no high bytes", () => {
    expect(guessSingleByteEncoding(utf8("abc"))).toBe("windows-1252");
  });
});

describe("encodeText round trips", () => {
  it.each([
    ["utf-8 no bom", utf8("a\nb")],
    ["utf-8 bom crlf", new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("a\r\nb\r\n")])],
    ["utf-16le bom", utf16("a\r\nb", true, true)],
    ["utf-16be bom", utf16("a\nb", false, true)],
    ["cr only", utf8("a\rb\rc")],
  ])("%s: decode then encode gives the original bytes", (_name, bytes) => {
    const d = decodeText(bytes);
    expect(encodeText(d.text, d.info)).toEqual(bytes);
  });

  it("writes edited text in the file's own line ending", () => {
    const d = decodeText(utf8("a\r\nb"));
    expect(new TextDecoder().decode(encodeText("a\nb\nc", d.info))).toBe("a\r\nb\r\nc");
  });

  it("refuses to encode a guessed decode", () => {
    const d = decodeText(new Uint8Array([0xcf, 0xf0, 0xe8]));
    expect(() => encodeText(d.text, d.info)).toThrow(/guess/);
  });

  it("once the guess is confirmed, windows-1251 round-trips byte for byte, every defined byte included", () => {
    // Every byte but 0x98 (undefined in windows-1251) in one file, plus CRLF.
    const all: number[] = [];
    for (let b = 1; b < 256; b++) if (b !== 0x98 && b !== 0x0a && b !== 0x0d) all.push(b);
    // Enough Cyrillic letters after them for the guess to land on 1251 (the 0xC0-0xFF share must reach 60 %).
    const bytes = new Uint8Array([...all, 0x0d, 0x0a, 0xcf, 0xf0, 0xe8, 0xe2, 0xb3, 0xf2, ...new Array<number>(40).fill(0xe0)]);
    const d = decodeText(bytes);
    expect(d.info).toMatchObject({ encoding: "windows-1251", lossy: true, eol: "\r\n" });
    const confirmed = confirmEncoding(d.info);
    expect(confirmed).toEqual({ encoding: "windows-1251", bom: false, eol: "\r\n", lossy: false });
    expect(encodeText(d.text, confirmed)).toEqual(bytes);
    // Edited text goes out in the same code page and line ending.
    expect(encodeText("Привіт\nсвіт", confirmed)).toEqual(new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xb3, 0xf2, 0x0d, 0x0a, 0xf1, 0xe2, 0xb3, 0xf2]));
  });

  it("windows-1252 round-trips too", () => {
    const bytes = new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x20, 0x80, 0x0a, 0x93, 0x71, 0x94]);
    const d = decodeText(bytes);
    expect(d.info.encoding).toBe("windows-1252");
    expect(d.text).toBe("café €\n“q”");
    expect(encodeText(d.text, confirmEncoding(d.info))).toEqual(bytes);
  });

  it("a character the code page lacks stops the write and names the line, never becomes a question mark", () => {
    const info = confirmEncoding(decodeText(new Uint8Array([0xcf])).info);
    let caught: unknown;
    try {
      encodeText("ok\nстоп 😀 тут\nend", info);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UnencodableError);
    const err = caught as UnencodableError;
    expect(err.char).toBe("😀");
    expect(err.line).toBe(2);
    expect(err.column).toBe(6);
    expect(err.encoding).toBe("windows-1251");
    expect(err.message).toBe('"😀" on line 2 has no byte in windows-1251; remove it or save a UTF-8 copy.');
    // Lines are counted once per ending whatever its form.
    expect(() => encodeText("a\nb\nā", { ...info, eol: "\r\n" })).toThrow(/line 3/);
    expect(() => encodeText("a\nb\nā", { ...info, eol: "\r" })).toThrow(/line 3/);
    let col: unknown;
    try {
      encodeText("ab\ncdē", { ...info, eol: "\r\n" });
    } catch (e) {
      col = e;
    }
    expect(col).toMatchObject({ line: 2, column: 3 });
    // é is in 1252 and not in 1251; the Cyrillic letter the other way round; the euro sign is in both (0x80 and 0x88).
    expect(() => encodeText("é", { ...info, encoding: "windows-1252" })).not.toThrow();
    expect(() => encodeText("é", info)).toThrow(UnencodableError);
    expect(() => encodeText("ї", { ...info, encoding: "windows-1252" })).toThrow(UnencodableError);
    expect(encodeText("€", info)).toEqual(new Uint8Array([0x88]));
    expect(encodeText("€", { ...info, encoding: "windows-1252" })).toEqual(new Uint8Array([0x80]));
  });

  it("the UTF-8 copy keeps the line ending and drops BOM and guess", () => {
    const d = decodeText(new Uint8Array([0xcf, 0xf0, 0x0d, 0x0a, 0xe8]));
    expect(utf8CopyInfo(d.info)).toEqual({ encoding: "utf-8", bom: false, eol: "\r\n", lossy: false });
    expect(new TextDecoder().decode(encodeText(d.text, utf8CopyInfo(d.info)))).toBe("Пр\r\nи");
  });
});

describe("describeEncoding", () => {
  it("names encoding, BOM and guess", () => {
    expect(describeEncoding({ encoding: "utf-8", bom: false, eol: "\n", lossy: false })).toBe("UTF-8");
    expect(describeEncoding({ encoding: "utf-8", bom: true, eol: "\n", lossy: false })).toBe("UTF-8 with BOM");
    expect(describeEncoding({ encoding: "utf-16le", bom: true, eol: "\n", lossy: false })).toBe("UTF-16 LE with BOM");
    expect(describeEncoding({ encoding: "windows-1251", bom: false, eol: "\n", lossy: true })).toBe("windows-1251 (guess)");
    expect(describeEncoding({ encoding: "windows-1251", bom: false, eol: "\n", lossy: false })).toBe("windows-1251");
  });
});
