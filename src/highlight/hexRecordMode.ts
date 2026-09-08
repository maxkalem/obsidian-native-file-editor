import type { StreamParser } from "@codemirror/language";

/**
 * One stream mode for the three hex-record formats Notepad++ colours with its
 * `LexHex` lexer: Intel HEX (`:` records), Motorola S-record (`S1`, `S9`, ...)
 * and Tektronix extended hex (`%` records). Every line is one record whose
 * fields are fixed by position: mark, byte count, address, record type, data,
 * checksum. The fields get distinct colours (count as a number, address as a
 * variable, type as a keyword, checksum as a constant, data plain) and a line
 * that does not parse is marked invalid. Token names are lezer tag names.
 */

export type HexRecordKind = "ihex" | "srec" | "tek";

interface Field {
  readonly len: number;
  readonly token: string | null;
}

interface HexState {
  /** The fields of the current line still to emit, filled at the start of the line. */
  fields: Field[];
}

const HEX = /^[0-9A-Fa-f]*$/;

function intelHex(line: string): Field[] | null {
  // :LLAAAATT[DD…]CC
  const m = /^:([0-9A-Fa-f]{2})([0-9A-Fa-f]{4})([0-9A-Fa-f]{2})([0-9A-Fa-f]*)([0-9A-Fa-f]{2})$/.exec(line);
  if (!m) return null;
  const count = parseInt(m[1] ?? "0", 16);
  if ((m[4] ?? "").length !== count * 2) return null;
  return [
    { len: 1, token: "punctuation" },
    { len: 2, token: "number" },
    { len: 4, token: "variableName" },
    { len: 2, token: "keyword" },
    { len: count * 2, token: null },
    { len: 2, token: "atom" },
  ];
}

/** Address length in hex digits by S-record type. */
const SREC_ADDRESS: Readonly<Record<string, number>> = { "0": 4, "1": 4, "2": 6, "3": 8, "4": 0, "5": 4, "6": 6, "7": 8, "8": 6, "9": 4 };

function sRecord(line: string): Field[] | null {
  // StLL[AAAA…][DD…]CC, where LL counts address + data + checksum bytes.
  const m = /^S([0-9])([0-9A-Fa-f]{2})([0-9A-Fa-f]*)$/.exec(line);
  if (!m) return null;
  const addressLen = SREC_ADDRESS[m[1] ?? ""];
  if (addressLen === undefined || addressLen === 0) return null;
  const count = parseInt(m[2] ?? "0", 16);
  const rest = m[3] ?? "";
  if (rest.length !== count * 2 || rest.length < addressLen + 2) return null;
  return [
    { len: 2, token: "keyword" },
    { len: 2, token: "number" },
    { len: addressLen, token: "variableName" },
    { len: rest.length - addressLen - 2, token: null },
    { len: 2, token: "atom" },
  ];
}

function tekHex(line: string): Field[] | null {
  // %LLTCC + address (one hex digit of length, then that many digits) + data.
  // The length field is not checked: files in the wild disagree on what it counts.
  const m = /^%([0-9A-Fa-f]{2})([68])([0-9A-Fa-f]{2})([0-9A-Fa-f])([0-9A-Fa-f]*)$/.exec(line);
  if (!m) return null;
  const addressLen = parseInt(m[4] ?? "0", 16);
  const rest = m[5] ?? "";
  if (rest.length < addressLen || !HEX.test(rest)) return null;
  return [
    { len: 1, token: "punctuation" },
    { len: 2, token: "number" },
    { len: 1, token: "keyword" },
    { len: 2, token: "atom" },
    { len: 1 + addressLen, token: "variableName" },
    { len: rest.length - addressLen, token: null },
  ];
}

const PARSERS: Readonly<Record<HexRecordKind, (line: string) => Field[] | null>> = { ihex: intelHex, srec: sRecord, tek: tekHex };

export function hexRecordMode(kind: HexRecordKind): StreamParser<HexState> {
  const parse = PARSERS[kind];
  return {
    name: kind,
    startState: () => ({ fields: [] }),
    copyState: (s) => ({ fields: [...s.fields] }),
    token(stream, state) {
      if (stream.sol()) {
        const line = stream.string.trimEnd();
        if (line.length === 0) {
          stream.skipToEnd();
          return null;
        }
        const fields = parse(line);
        if (!fields) {
          state.fields = [];
          stream.skipToEnd();
          return "invalid";
        }
        state.fields = fields.filter((f) => f.len > 0);
      }
      const field = state.fields.shift();
      if (!field) {
        stream.skipToEnd();
        return null;
      }
      for (let i = 0; i < field.len; i++) stream.next();
      return field.token;
    },
  };
}
