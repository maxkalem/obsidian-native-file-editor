import type { StreamParser } from "@codemirror/language";

/**
 * A stream mode for Makefiles, this plugin's own. Notepad++'s table for
 * `makefile` carries no keywords (its lexer is hand-written), so the keyword
 * mode showed comments only. What a Makefile has: comments, targets (a line
 * that starts in column one and ends in `:`), variable assignments
 * (`NAME =`, `:=`, `?=`, `+=`, `!=`), recipe lines (a tab first), `$(…)` and
 * `${…}` references with the built-in functions inside them, the special
 * targets (`.PHONY`) and the directives (`ifeq`, `include`, `define`, ...).
 * Token names are lezer tag names for the highlighter.
 */

const DIRECTIVES = /^(?:-?include|sinclude|ifeq|ifneq|ifdef|ifndef|else|endif|define|endef|export|unexport|override|undefine|vpath|private)\b/;
const FUNCTIONS = /^(?:subst|patsubst|strip|findstring|filter|filter-out|sort|word|wordlist|words|firstword|lastword|dir|notdir|suffix|basename|addsuffix|addprefix|join|wildcard|realpath|abspath|if|or|and|foreach|file|call|value|eval|origin|flavor|shell|error|warning|info|guile)\b/;
const SPECIAL_TARGET = /^\.(?:PHONY|SUFFIXES|DEFAULT|PRECIOUS|INTERMEDIATE|NOTINTERMEDIATE|SECONDARY|SECONDEXPANSION|DELETE_ON_ERROR|IGNORE|LOW_RESOLUTION_TIME|SILENT|EXPORT_ALL_VARIABLES|NOTPARALLEL|ONESHELL|POSIX)\b/;

interface MakefileState {
  /** Inside a `define … endef` body: text, references only. */
  inDefine: boolean;
  /** Depth of `$(` / `${` references open on this line. */
  refDepth: number;
  /** Just opened a reference: the next word may be a function name. */
  refStart: boolean;
}

export const makefileMode: StreamParser<MakefileState> = {
  name: "makefile",
  startState: () => ({ inDefine: false, refDepth: 0, refStart: false }),
  copyState: (s) => ({ ...s }),
  token(stream, state) {
    if (stream.sol()) state.refDepth = 0;
    // A reference, anywhere: `$(name …)`, `${name}`, `$@`, `$<`, `$^`, `$$`.
    if (state.refDepth > 0) {
      if (state.refStart) {
        state.refStart = false;
        if (stream.match(FUNCTIONS)) return "variableName.standard";
        if (stream.match(/^[\w.%\-]+/)) return "variableName.special";
      }
      if (stream.match(/^[)}]/)) {
        state.refDepth--;
        return "variableName.special";
      }
      if (stream.match(/^\$[({]/)) {
        state.refDepth++;
        state.refStart = true;
        return "variableName.special";
      }
      if (stream.match(/^\$[@<^+?*%|]/)) return "variableName.special";
      stream.match(/^[^$)}]+/) || stream.next();
      return null;
    }
    if (stream.match(/^\$[({]/)) {
      state.refDepth = 1;
      state.refStart = true;
      return "variableName.special";
    }
    if (stream.match(/^\$(?:[@<^+?*%|]|\$)/)) return "variableName.special";

    if (stream.sol()) {
      if (stream.match(/^\s*#.*/)) return "comment";
      if (stream.match(/^\t/)) return null; // a recipe line: shell text, references coloured above
      if (state.inDefine) {
        if (stream.match(/^endef\b/)) {
          state.inDefine = false;
          return "keyword";
        }
      } else {
        if (stream.match(/^define\b/)) {
          state.inDefine = true;
          return "keyword";
        }
        if (stream.match(DIRECTIVES)) return "keyword";
        if (stream.match(SPECIAL_TARGET)) return "keyword";
        // `NAME =`, `NAME :=`, `NAME ?=`, `NAME +=`, `NAME !=`: the name.
        if (stream.match(/^[A-Za-z_][\w.\-]*(?=\s*[:?+!]?=)/)) return "variableName.definition";
        // `target other-target: prerequisites` up to the colon: the targets.
        if (stream.match(/^[^\s:=#\t][^:=#]*?(?=::?(?!=))/)) return "typeName";
      }
    }
    if (stream.match(/^#.*/)) return "comment";
    if (stream.match(/^(?:::?=|[?+!]=|=|::|:|\|)/)) return "operator";
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/) || stream.match(/^'(?:[^'\\]|\\.)*'?/)) return "string";
    if (stream.match(/^\\$/)) return "operator";
    if (stream.eatSpace()) return null;
    stream.match(/^[^\s$#:=?+!"'\\]+/) || stream.next();
    return null;
  },
  languageData: { commentTokens: { line: "#" } },
};
