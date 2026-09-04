import type { StreamParser } from "@codemirror/language";

/**
 * A stream mode for log files, this plugin's own. Nothing in CodeMirror covers
 * them, and a log is the one file type where the reader scans for colour
 * before reading a word: levels, timestamps, and the message.
 *
 * Token names are lezer tag names, so the ordinary highlighter maps them:
 * error levels -> invalid, warnings -> changed, info -> atom, debug/trace ->
 * comment, timestamps and numbers -> number, quoted text -> string, `key=`
 * -> propertyName, `[thread]` -> namespace, stack frames -> comment.
 */

interface LogState {
  /** Inside a stack trace: lines starting with whitespace and `at ` are frames. */
  inTrace: boolean;
}

const ERROR = /^(?:ERROR|ERR|FATAL|SEVERE|CRITICAL|CRIT|PANIC|E)\b/;
const WARN = /^(?:WARN(?:ING)?|W)\b/;
const INFO = /^(?:INFO|NOTICE|I)\b/;
const DEBUG = /^(?:DEBUG|TRACE|VERBOSE|FINE|D|T|V)\b/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/;
const CLOCK = /^\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?/;
const NUMBER = /^-?\d+(?:\.\d+)?(?:\s?(?:ms|s|MB|KB|GB|B|%))?\b/;
const KEY = /^[A-Za-z_][\w.-]*(?==)/;
const WORD = /^[^\s"'\[\]=:]+/;

export const logMode: StreamParser<LogState> = {
  name: "log",
  startState: () => ({ inTrace: false }),
  copyState: (s) => ({ inTrace: s.inTrace }),
  token(stream, state) {
    if (stream.sol()) {
      if (stream.match(/^\s+at\s/, false) || stream.match(/^\s*(?:Caused by|Traceback|File ")/, false)) {
        state.inTrace = true;
        stream.skipToEnd();
        return "comment";
      }
      state.inTrace = false;
    }
    if (stream.eatSpace()) return null;
    if (stream.match(TIMESTAMP) || stream.match(CLOCK)) return "number";
    if (stream.match(ERROR)) return "invalid";
    if (stream.match(WARN)) return "changed";
    if (stream.match(INFO)) return "atom";
    if (stream.match(DEBUG)) return "comment";
    if (stream.match(/^\[[^\]]*\]/)) return "namespace";
    if (stream.match(/^"(?:[^"\\]|\\.)*"/) || stream.match(/^'(?:[^'\\]|\\.)*'/)) return "string";
    if (stream.match(KEY)) return "propertyName";
    if (stream.match(NUMBER)) return "number";
    if (stream.match(/^[=:]/)) return "punctuation";
    if (stream.match(WORD)) return null;
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: "#" } },
};
