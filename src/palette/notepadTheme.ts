import { type ChromeSettings, type Palette, type PaletteRule, ROLE_SELECTORS, type TokenRole, chromeRules } from "./model";

/**
 * A Notepad++ theme (`Notepad++\themes\*.xml`, or `stylers.model.xml`) as a
 * palette. The format is one `LexerType` per language with a `WordsStyle` per
 * token kind, plus `GlobalStyles` for the editor itself. Colours are `RRGGBB`
 * without `#`; `fontStyle` is a bit set (1 bold, 2 italic, 4 underline).
 *
 * The plugin takes the theme as ONE palette, not one per lexer: the style
 * names differ per lexer (`INSTRUCTION WORD`, `KEYWORD`, `KEYWORDS`, `WORD`
 * all mean keyword) but Notepad++ themes use the same colours for the same
 * role across lexers, so the first colour found for a role, reading the
 * richest lexers first, is the theme's colour for it. Per-lexer fidelity is an
 * open item; a per-language palette is one folder away in the meantime.
 *
 * Parsed with regular expressions, not a DOM: the file is attribute-only XML
 * of one shape, and the parser has to run in the unit-test sandbox too.
 */

interface Attrs {
  readonly [k: string]: string | undefined;
}

function attrs(tag: string): Attrs {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g)) out[m[1] ?? ""] = m[2] ?? "";
  return out;
}

/** `RRGGBB` to `#rrggbb`; anything else is not a colour. */
export function notepadColour(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  const hex = v.trim();
  return /^[0-9A-Fa-f]{6}$/.test(hex) ? `#${hex.toLowerCase()}` : undefined;
}

/** Lexers in the order their styles are consulted; anything else follows in file order. */
const LEXER_PRIORITY = ["cpp", "javascript", "python", "html", "xml", "json", "css", "bash", "sql", "java", "cs", "c", "php", "ruby", "perl", "yaml", "diff", "ini", "props"];

/**
 * Style name (upper-cased, letters and digits only) to role. Order matters:
 * the first predicate that matches wins, so `COMMENTDOC` is a doc comment
 * before it is a comment, and `USERKEYWORDS1` is nothing at all.
 */
const NAME_RULES: ReadonlyArray<readonly [test: (n: string) => boolean, role: TokenRole | null]> = [
  [(n) => n.startsWith("USER"), null],
  [(n) => n === "DEFAULT" || n === "SGMLDEFAULT" || n === "TEXT" || n === "STRINGEOL", null],
  [(n) => n.includes("COMMENTDOC") || n.includes("DOCCOMMENT") || n.includes("COMMENTLINEDOC"), "docComment"],
  [(n) => n.includes("COMMENT") || n === "POD" || n === "PODVERBATIM", "comment"],
  [(n) => n.includes("REGEX"), "regexp"],
  [(n) => n.includes("ESCAPE"), "escape"],
  [(n) => n.includes("STRING") || n.includes("CHARACTER") || n.includes("TRIPLE") || n.includes("HEREDOC") || n.includes("BACKTICKS") || n === "VERBATIM" || n === "CDATA" || n === "HEREQ" || n === "HEREDELIM", "string"],
  [(n) => n.includes("NUMBER") || n === "BINARY" || n === "HEXSTRING", "number"],
  [(n) => n === "INSTRUCTIONWORD" || n === "KEYWORD" || n === "KEYWORDS" || n === "WORD" || n === "INSTRUCTION" || n === "COMMAND" || n === "RETURN" || n === "EXTINSTRUCTION", "keyword"],
  [(n) => n === "TYPEWORD" || n === "TYPE" || n === "TYPEDEF" || n === "STDTYPE" || n === "CLASS" || n === "CLASSNAME" || n === "KEYWORD2", "type"],
  [(n) => n === "DEFNAME" || n.startsWith("FUNC") || n === "CALLABLE" || n === "STDFUNCTION", "function"],
  [(n) => n === "BUILTINS" || n === "PREDEFINED" || n === "PREDECLAREDIDENTIFIERS" || n === "STDPACKAGE", "builtin"],
  [(n) => n === "IDENTIFIER" || n === "VARIABLE" || n === "VAR" || n === "SCALAR" || n === "PARAMETER" || n === "PARAM" || n === "INSTANCEVAR" || n === "CLASSVAR" || n === "GLOBAL" || n === "ARRAY" || n === "HASH", "variable"],
  [(n) => n === "PROPERTYNAME" || n === "KEY" || n === "ID", "property"],
  [(n) => n.startsWith("OPERATOR") || n === "SYMBOLS" || n === "SYMBOL" || n === "QOPERATOR" || n === "ASSIGNMENT" || n === "ASSIGN", "operator"],
  [(n) => n.startsWith("PREPROCESSOR") || n === "DIRECTIVE" || n === "MACRO" || n === "MACRODEF" || n === "DECORATOR" || n === "ANNOTATION", "meta"],
  [(n) => n.startsWith("TAG"), "tag"],
  [(n) => n.startsWith("ATTRIBUTE"), "attribute"],
  [(n) => n === "VALUE" || n === "BOOL" || n === "NIL" || n === "LITERAL" || n === "DEFVAL", "atom"],
  [(n) => n === "LABEL" || n === "SECTION" || n === "AFTERLABEL", "label"],
  [(n) => n === "ERROR" || n === "BADSTRINGCHAR" || n === "BADBRACE", "invalid"],
  [(n) => n === "URI" || n === "URL" || n === "COMPACTIRI", "link"],
  [(n) => n === "HEADER" || n === "HEADING", "heading"],
  [(n) => n === "ADDED", "inserted"],
  [(n) => n === "DELETED", "deleted"],
  [(n) => n === "CHANGED", "changed"],
];

export function roleForStyleName(name: string): TokenRole | null {
  const n = name.toUpperCase().replace(/[^A-Z0-9]/g, "");
  for (const [test, role] of NAME_RULES) if (test(n)) return role;
  return null;
}

/** Declarations for one WordsStyle: colour, weight, style, decoration; background only when it differs from the lexer's own. */
function styleDeclarations(a: Attrs, lexerBackground: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const fg = notepadColour(a.fgColor);
  const bg = notepadColour(a.bgColor);
  if (fg) out.color = fg;
  if (bg && bg !== lexerBackground) out["background-color"] = bg;
  const flags = Number.parseInt(a.fontStyle ?? "0", 10) || 0;
  if (flags & 1) out["font-weight"] = "bold";
  if (flags & 2) out["font-style"] = "italic";
  if (flags & 4) out["text-decoration"] = "underline";
  return out;
}

export function isNotepadTheme(xml: string): boolean {
  return /<NotepadPlus\b/.test(xml) && /<LexerStyles\b|<GlobalStyles\b/.test(xml);
}

export function parseNotepadTheme(xml: string): Palette {
  const notes: string[] = [];
  if (!isNotepadTheme(xml)) return { rules: [], notes: ["not a Notepad++ theme: no <NotepadPlus> with <LexerStyles> or <GlobalStyles>"] };

  // Lexers, in priority order then file order.
  const lexers: Array<{ name: string; body: string }> = [];
  for (const m of xml.matchAll(/<LexerType\b([^>]*)>([\s\S]*?)<\/LexerType>/g)) {
    lexers.push({ name: attrs(m[1] ?? "").name ?? "", body: m[2] ?? "" });
  }
  const rank = (n: string) => {
    const i = LEXER_PRIORITY.indexOf(n);
    return i === -1 ? LEXER_PRIORITY.length : i;
  };
  lexers.sort((a, b) => rank(a.name) - rank(b.name));

  const byRole = new Map<TokenRole, Record<string, string>>();
  const sourceOf = new Map<TokenRole, string>();
  for (const lexer of lexers) {
    const styles = [...lexer.body.matchAll(/<WordsStyle\b([^>]*)\/?>/g)].map((m) => attrs(m[1] ?? ""));
    const lexerBackground = notepadColour(styles.find((s) => (s.name ?? "").toUpperCase() === "DEFAULT")?.bgColor);
    for (const s of styles) {
      const role = roleForStyleName(s.name ?? "");
      if (role === null || byRole.has(role)) continue;
      const decl = styleDeclarations(s, lexerBackground);
      if (Object.keys(decl).length === 0) continue;
      byRole.set(role, decl);
      sourceOf.set(role, `${lexer.name}/${s.name ?? "?"}`);
    }
  }

  // The editor itself, from GlobalStyles.
  const chrome: ChromeSettings = {};
  const globals = xml.match(/<GlobalStyles\b[^>]*>([\s\S]*?)<\/GlobalStyles>/)?.[1] ?? "";
  const widget = (name: string): Attrs | null => {
    for (const m of globals.matchAll(/<WidgetStyle\b([^>]*)\/?>/g)) {
      const a = attrs(m[1] ?? "");
      if ((a.name ?? "").toLowerCase() === name.toLowerCase()) return a;
    }
    return null;
  };
  const def = widget("Default Style") ?? widget("Global override");
  chrome.background = notepadColour(def?.bgColor);
  chrome.foreground = notepadColour(def?.fgColor);
  chrome.caret = notepadColour(widget("Caret colour")?.fgColor);
  chrome.selection = notepadColour(widget("Selected text colour")?.bgColor);
  chrome.selectionMatch = notepadColour(widget("Smart Highlighting")?.bgColor);
  chrome.lineHighlight = notepadColour(widget("Current line background colour")?.bgColor);
  const margin = widget("Line number margin");
  chrome.gutterBackground = notepadColour(margin?.bgColor);
  chrome.gutterForeground = notepadColour(margin?.fgColor);
  chrome.matchingBracket = notepadColour(widget("Brace highlight style")?.bgColor);
  const bracketFg = notepadColour(widget("Brace highlight style")?.fgColor);
  if (chrome.matchingBracket === chrome.background) chrome.matchingBracket = undefined;

  const rules: PaletteRule[] = chromeRules(chrome);
  if (bracketFg) rules.push({ selectors: [".cm-matchingBracket"], declarations: { color: bracketFg } });
  for (const [role, declarations] of byRole) rules.push({ selectors: ROLE_SELECTORS[role], declarations });

  if (lexers.length === 0) notes.push("no LexerType elements");
  if (byRole.size === 0) notes.push("no WordsStyle names matched a token role");
  notes.push(`${byRole.size} token roles from ${new Set([...sourceOf.values()].map((s) => s.split("/")[0])).size} lexers`);
  return { rules, notes };
}
