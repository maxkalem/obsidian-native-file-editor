/**
 * How much whitespace Compress may remove, decided once per language.
 *
 * Compress works on the syntax tree the highlighter already builds, so it
 * always knows a string and a comment from the rest. What the tree cannot say
 * is how much of the remaining whitespace the language allows to disappear,
 * and that answer is a property of the language, not of the file. This table
 * holds it, one row per language name in the registry.
 *
 * The classes:
 *
 * - `free` — whitespace outside strings and comments carries no meaning, so
 *   runs of it collapse, indentation goes, comments go, blank lines go. Two
 *   caveats sharpen it per language: `runs` says how far a run between two
 *   tokens may collapse, and `lineBreaks` says which line breaks survive.
 * - `significant` — indentation or the line structure is part of the syntax,
 *   so only trailing whitespace, blank lines beyond one, and comments go.
 * - `none` — a record or transport format where the layout is the content, or
 *   a format nothing may rewrite: Compress refuses and says why.
 *
 * The table lives here rather than as a column of the registry on purpose.
 * The registry answers what colours a file; this answers what one command may
 * do to it, which is formatting knowledge and belongs beside the formatters.
 * A language may not be added to one and forgotten in the other:
 * `tests/whitespace.test.ts` fails on a registry entry with no row and on a
 * row no registry entry uses, the same discipline the catalogue test applies
 * to the user-visible strings.
 */

export type WhitespaceClass = "free" | "significant" | "none";

/** How far a run of whitespace between two tokens may collapse, in a `free` language. */
export type RunCollapse =
  /** To nothing beside punctuation, to one space between two word characters. The usual rule. */
  | "drop"
  /** To one space, always: the language separates its tokens by whitespace, brackets included. */
  | "single";

/** Which line breaks survive, in a `free` language. */
export type LineBreakRule =
  /** None: the language terminates its statements itself. */
  | "drop"
  /**
   * One per statement: a newline can be a statement terminator where no
   * semicolon stands (automatic semicolon insertion and the languages that
   * simply have no separator). `asiLanguages()` is this list.
   */
  | "statements"
  /** One per line that holds a preprocessor directive; the directive ends at its newline. */
  | "directives"
  /** All of them: the language is free within a line and line-oriented above it. */
  | "keep";

export interface WhitespaceRule {
  readonly whitespace: WhitespaceClass;
  /** `free` only; "drop" when absent. */
  readonly runs?: RunCollapse;
  /** `free` only; "drop" when absent. */
  readonly lineBreaks?: LineBreakRule;
  /**
   * `significant` only: what the safe removals leave alone in this language.
   * Markdown ends a line with two spaces on purpose and its comments are
   * often markers; prose keeps its comments.
   */
  readonly keeps?: ReadonlyArray<"comments" | "trailing">;
  /**
   * The text between the tags is content the token stream does not mark
   * (`pre`, an inline box, output outside `<?php`), so the generic compressor
   * must not touch the file; the own tree-aware formatter of the format
   * specification's step 6 is the one that may. Until it exists, no row.
   */
  readonly markup?: true;
  /** Why the row is not the obvious one, in one line. Absent where it is. */
  readonly note?: string;
}

const free = (lineBreaks: LineBreakRule = "drop", note?: string): WhitespaceRule => ({ whitespace: "free", lineBreaks, ...(note === undefined ? {} : { note }) });

/** A `free` language that separates every token by whitespace: brackets and operators are words. */
const spaced = (lineBreaks: LineBreakRule, note: string): WhitespaceRule => ({ whitespace: "free", runs: "single", lineBreaks, note });

const significant = (note?: string, keeps?: ReadonlyArray<"comments" | "trailing">): WhitespaceRule => ({ whitespace: "significant", ...(note === undefined ? {} : { note }), ...(keeps === undefined ? {} : { keeps }) });

/** A `free` language whose text outside the tags is content: no generic compression (see `markup`). */
const markup = (note: string): WhitespaceRule => ({ whitespace: "free", markup: true, note });

const nothing = (note: string): WhitespaceRule => ({ whitespace: "none", note });

/**
 * One row per language name in the registry, bundled entries only. A
 * definition from the vault gets `UNKNOWN_RULE`, because nothing here knows
 * what it describes.
 */
const RULES: Readonly<Record<string, WhitespaceRule>> = {
  // Prose and plain files. A paragraph is the content; only the trailing
  // spaces and the runs of blank lines are noise.
  "Plain text": significant("Text has no comments to speak of; a line that looks like one is text.", ["comments"]),
  Markdown: significant("Indentation makes lists and code blocks; two spaces at a line end are a hard break; an HTML comment is often a marker.", ["comments", "trailing"]),
  Textile: significant(undefined, ["comments"]),
  txt2tags: significant("A comment line is often a marker for the converter.", ["comments"]),
  TiddlyWiki: significant(undefined, ["comments"]),
  troff: significant("A macro is a line that starts with a dot in the first column."),
  LaTeX: significant("A blank line is a paragraph; a per cent sign at the end of a line eats the newline."),
  NFO: nothing("The drawing is made of spaces."),

  // Records and transport formats: the layout is the content.
  Log: nothing("A log line is a record."),
  Diff: nothing("Every leading character is a marker and every line is part of the count."),
  mbox: nothing("A message is bytes a signature may cover."),
  MHTML: nothing("A part is bytes between boundaries, mostly encoded."),
  "ASCII armor": nothing("The block is base64 and a checksum over it."),
  HTTP: nothing("A request is head, blank line, body."),
  "Intel HEX": nothing("Every line is a record with a checksum."),
  "Motorola S-record": nothing("Every line is a record with a checksum."),
  "Tektronix hex": nothing("Every line is a record with a checksum."),

  // Whitespace-free code, the plain case.
  JSON: free(),
  XML: markup("A subtree under xml:space=\"preserve\" keeps its whitespace, and the text between tags is content."),
  DTD: free(),
  HTML: markup("The pre family (pre, textarea, listing, plaintext) and an inline box keep their whitespace."),
  CSS: free(),
  SCSS: free(),
  Less: free(),
  GSS: free(),
  SQL: free(),
  PostgreSQL: free(),
  MySQL: free(),
  SQLite: free(),
  "T-SQL": free(),
  "PL/SQL": free(),
  Rust: free(),
  Java: free(),
  PHP: markup("Text outside the tags is output; it is HTML and follows HTML's rule."),
  Nix: free(),
  Solidity: free(),
  GraphQL: free(),
  Ceylon: free(),
  Dart: free(),
  Clojure: spaced("drop", "A symbol may hold any operator character, so two tokens joined are one symbol."),
  "Common Lisp": spaced("drop", "A symbol may hold any operator character, so two tokens joined are one symbol."),
  Scheme: spaced("drop", "A symbol may hold any operator character, so two tokens joined are one symbol."),
  Cypher: free(),
  D: free(),
  ECL: free(),
  Erlang: free(),
  Modelica: free(),
  MscGen: free(),
  "Xù": free(),
  nginx: free(),
  "N-Triples": free("keep", "A triple is a line by convention, and the grammar allows no space at all between terms."),
  Turtle: free(),
  SPARQL: free(),
  Oz: free(),
  Pascal: free(),
  "PEG.js": free(),
  Pig: free(),
  "Protocol Buffers": free(),
  Puppet: free(),
  SAS: free(),
  Sieve: free(),
  Smalltalk: free(),
  "TTCN-3": free(),
  "ASN.1": free(),
  VHDL: free(),
  "WebAssembly text": free(),
  WebIDL: free(),
  XQuery: free("drop", "A direct element constructor holds literal text; the tree marks it."),
  Yacas: free(),
  Haxe: free(),
  EBNF: free("keep"),
  Dylan: free("keep"),
  Eiffel: free("keep", "A semicolon between instructions is optional."),
  FCL: free("keep"),
  Brainfuck: free("drop", "Everything that is not one of the eight characters is a comment."),

  // Whitespace-free, but a newline can terminate a statement. This is the ASI
  // caveat list of the specification, widened to every language that has no
  // separator of its own rather than only to the ECMAScript family.
  JavaScript: free("statements", "Automatic semicolon insertion."),
  TypeScript: free("statements", "Automatic semicolon insertion."),
  TSX: free("statements", "Automatic semicolon insertion."),
  Go: free("statements", "The scanner inserts the semicolons."),
  Kotlin: free("statements"),
  Swift: spaced("statements", "Whitespace on the sides of an operator decides whether it is prefix, postfix or infix."),
  Ruby: spaced("statements", "`puts -1` and `puts-1` differ: whitespace before an operator decides what it is."),
  Crystal: spaced("statements", "As Ruby: whitespace before an operator decides what it is."),
  Scala: free("statements"),
  Groovy: free("statements"),
  Elixir: spaced("statements", "`foo -1` is a call and `foo - 1` a subtraction: whitespace before an operator decides."),
  HCL: free("statements", "One attribute per line, and no separator to write instead."),
  Prisma: free("statements", "One field per line."),
  Julia: spaced("statements", "The ternary demands its spaces, and whitespace decides a call from a juxtaposition."),
  Octave: free("statements"),
  R: free("statements"),
  PowerShell: spaced("statements", "A command line is words separated by whitespace, and `-Path` after a name is a parameter only with the space."),
  Squirrel: free("statements", "A newline ends a statement where no semicolon does."),
  ActionScript: free("statements", "Automatic semicolon insertion."),
  Svelte: markup("Markup with a script block: HTML's rule for the markup, the script's for the rest."),
  Astro: markup("Markup with a script block: HTML's rule for the markup, the script's for the rest."),

  // Whitespace-free within a line, with a preprocessor that ends its
  // directives at the newline.
  "C/C++": free("directives", "A preprocessor directive ends at its newline."),
  "C#": free("directives", "A compiler directive ends at its newline."),
  "Objective-C": free("directives", "A preprocessor directive ends at its newline."),
  "Objective-C++": free("directives", "A preprocessor directive ends at its newline."),
  nesC: free("directives", "A preprocessor directive ends at its newline."),
  Shader: free("directives", "A preprocessor directive ends at its newline."),
  Verilog: free("directives", "A compiler directive ends at its newline."),
  "Resource script": free("directives", "A preprocessor directive ends at its newline."),

  // Line-oriented: free inside a line, one command or instruction per line.
  Assembly: spaced("keep", "One instruction per line, and a directive and its argument are words: `.section .text` joined is one name."),
  CMake: spaced("keep", "Arguments are words separated by whitespace; a comment runs to the newline."),
  Dockerfile: spaced("keep", "One instruction per line, continued by a backslash; the instruction is a command line of words."),
  Lua: free("keep", "Joining lines can turn a name and a bracket into a call."),
  Perl: free("keep", "Heredocs, POD and the data section end at a line."),
  Shell: spaced("keep", "A command is words separated by whitespace (`[ -z x ]` is four of them); a newline ends it, and a heredoc ends at its own line."),
  OCaml: free("keep"),
  "Standard ML": free("keep"),
  Mathematica: free("keep", "A newline can end an expression."),
  NSIS: spaced("keep", "One command per line, of words."),
  mIRC: spaced("keep", "One command per line, of words."),
  HXML: spaced("keep", "One argument per line: a flag and its value are two words."),
  MsGenny: free("keep", "One statement per line."),
  "Visual Basic": free("keep", "A newline ends a statement; an underscore continues it."),
  VBScript: free("keep", "A newline ends a statement; an underscore continues it."),
  ASP: markup("A newline ends a statement, and the markup around it is HTML."),
  "TL-Verilog": significant("Indentation is the scope."),
  AutoIt: free("keep", "One statement per line."),
  AviSynth: free("keep", "One statement per line."),
  BlitzBasic: free("keep", "One statement per line."),
  FreeBASIC: free("keep", "One statement per line."),
  PureBasic: free("keep", "One statement per line."),
  Gui4Cli: spaced("keep", "One command per line, of words."),
  KiXtart: spaced("keep", "One command per line, of words."),
  OScript: free("keep"),
  BaanC: free("keep"),
  EScript: free("keep"),
  "Visual Prolog": free("keep"),
  Ada: free("keep"),

  // Whitespace separates every token, brackets included.
  Forth: spaced("keep", "Words are separated by whitespace and nothing else."),
  Factor: spaced("keep", "Words are separated by whitespace and nothing else."),
  PostScript: spaced("keep", "Tokens are separated by whitespace; a bracket is a token."),
  REBOL: spaced("keep", "Values are separated by whitespace."),
  Tcl: spaced("keep", "A command is a list of words separated by whitespace."),
  APL: spaced("keep", "Names are separated by whitespace, and a line is an expression."),
  Raku: spaced("keep", "Whitespace before a bracket decides what the bracket is."),

  // Indentation or column position is the syntax.
  Python: significant("Indentation is the block."),
  Cython: significant("Indentation is the block."),
  YAML: significant("Indentation is the structure; a block scalar keeps its own."),
  Sass: significant("The indented syntax: indentation is the nesting."),
  Stylus: significant("Indentation is the nesting."),
  Pug: significant("Indentation is the tree."),
  Haskell: significant("The layout rule."),
  "F#": significant("The offside rule."),
  Elm: significant("The layout rule."),
  CoffeeScript: significant("Indentation is the block."),
  LiveScript: significant("Indentation is the block."),
  Nim: significant("Indentation is the block."),
  GDScript: significant("Indentation is the block."),
  Gherkin: significant("One step per line."),
  Makefile: significant("A recipe line begins with a tab, and only a tab."),
  Properties: significant("One key and value per line."),
  TOML: significant("One key and value per line."),
  "Inno Setup": significant("Sections of one directive per line."),
  "RPM spec": significant("Sections, directives and a shell script in the same file."),
  Batch: significant("A space around an equals sign becomes part of the value."),
  Fortran: significant("The fixed form gives every column a meaning."),
  COBOL: significant("The fixed form gives every column a meaning."),
  MMIXAL: significant("The first column is the label field."),
  SPICE: significant("One element per line, continued by a plus in the first column."),
  Csound: significant("A score line is a row of fields."),
  nnCron: significant("One entry per line."),
  Q: significant("A line that begins with whitespace continues the one above."),
  Jinja2: significant("The text around the tags is output."),
  Velocity: significant("The text around the directives is output."),
};

/** The row for a language with no row of its own: a definition from the vault, or a name nothing knows. */
export const UNKNOWN_RULE: WhitespaceRule = { whitespace: "significant", note: "The language is not one of the bundled set; only the safe removals apply." };

/** The row for a file with no language at all. */
export const NO_LANGUAGE_RULE: WhitespaceRule = { whitespace: "significant", note: "A file with no language is read as text." };

// A Map, not the record itself: a language named `toString` or `constructor`
// would otherwise be answered by Object.prototype.
const BY_NAME: ReadonlyMap<string, WhitespaceRule> = new Map(Object.entries(RULES));

export function whitespaceRuleFor(language: string | null): WhitespaceRule {
  if (language === null) return NO_LANGUAGE_RULE;
  return BY_NAME.get(language) ?? UNKNOWN_RULE;
}

/** Every language name this table decides, for the coverage test. */
export function ruledLanguages(): string[] {
  return [...BY_NAME.keys()];
}

/**
 * The languages where a newline can stand for a statement separator, so
 * Compress keeps one line break per statement: the caveat list of the
 * specification, read out of the table rather than written twice.
 */
/** The languages whose row waits for the tree-aware formatter: no generic compression. */
export function markupLanguages(): string[] {
  return [...BY_NAME].filter(([, rule]) => rule.markup === true).map(([name]) => name);
}

export function asiLanguages(): string[] {
  return [...BY_NAME].filter(([, rule]) => rule.lineBreaks === "statements").map(([name]) => name);
}
