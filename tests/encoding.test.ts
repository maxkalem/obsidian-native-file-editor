import { describe, expect, it } from "vitest";
import {
  decodeText,
  describeEncoding,
  describeLineEnding,
  detectBom,
  detectLineEnding,
  encodeText,
  guessSingleByteEncoding,
  normalizeLineEndings,
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
});

describe("describeEncoding", () => {
  it("names encoding, BOM and guess", () => {
    expect(describeEncoding({ encoding: "utf-8", bom: false, eol: "\n", lossy: false })).toBe("UTF-8");
    expect(describeEncoding({ encoding: "utf-8", bom: true, eol: "\n", lossy: false })).toBe("UTF-8 with BOM");
    expect(describeEncoding({ encoding: "utf-16le", bom: true, eol: "\n", lossy: false })).toBe("UTF-16 LE with BOM");
    expect(describeEncoding({ encoding: "windows-1251", bom: false, eol: "\n", lossy: true })).toBe("windows-1251 (guess)");
  });
});
