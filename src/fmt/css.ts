import type { SyntaxNode, Tree } from "@lezer/common";

/**
 * The plugin's own CSS formatter and compressor, over the lezer tree the
 * editor holds (`@codemirror/lang-css`).
 *
 * Format: one rule per line, one declaration per line inside a block, the
 * block indented by the file's unit, `property: value;` with one space after
 * the colon, selectors joined by `, `, a blank line kept between two
 * top-level rules where the file had one. Compress: everything on one line,
 * comments dropped, no space after a colon or a comma, and the last `;` of
 * every block dropped. A value is printed from its tokens with one space
 * wherever the file had whitespace between them and none where it had none,
 * so `0 auto` stays two values and `rgba(0,0,0,.1)` stays as written; a
 * string, a `url(...)` and a braced value are copied as they stand.
 *
 * A sheet the grammar could not read in full (a vendor hack the parser does
 * not know, an unclosed block) is refused with the line of the first fault:
 * a guessed structure written into a stylesheet is worse than no formatting.
 */

export interface CssStyle {
  readonly indent: string;
  readonly eol: string;
}

export interface CssResult {
  readonly text: string;
  readonly problem: string | null;
  /** Comments dropped (Compress only; 0 for Format). */
  readonly comments: number;
}

export function formatCss(text: string, tree: Tree, style: CssStyle): CssResult {
  return render(text, tree, style, false);
}

export function compressCss(text: string, tree: Tree): CssResult {
  return render(text, tree, { indent: "", eol: "" }, true);
}

const CONTAINERS = new Set(["Block", "KeyframeList"]);

function render(text: string, tree: Tree, style: CssStyle, compress: boolean): CssResult {
  const fault = firstFault(text, tree);
  if (fault !== null) return { text, problem: fault, comments: 0 };
  const lines: string[] = [];
  let comments = 0;
  const emit = (depth: number, s: string) => lines.push(style.indent.repeat(depth) + s);
  const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
  const sliceOf = (n: SyntaxNode) => text.slice(n.from, n.to);

  /** The children of a node, tokens included, in order. */
  const childrenOf = (n: SyntaxNode): SyntaxNode[] => {
    const out: SyntaxNode[] = [];
    for (let c = n.firstChild; c; c = c.nextSibling) out.push(c);
    return out;
  };

  /** A value or a prelude from its tokens: a space where the file had whitespace between two tokens. */
  const joined = (nodes: readonly SyntaxNode[]): string => {
    let out = "";
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!;
      if (i > 0) {
        const gap = text.slice(nodes[i - 1]!.to, n.from);
        const comma = n.name === ",";
        if (comma) out += "";
        else if (nodes[i - 1]!.name === ",") out += compress ? "" : " ";
        else if (/\s/.test(gap)) out += " ";
      }
      out += n.name === "Comment" ? "" : sliceOf(n);
    }
    return out.trim();
  };

  const declaration = (d: SyntaxNode, last: boolean): string => {
    const kids = childrenOf(d);
    const colon = kids.findIndex((k) => k.name === ":");
    const name = colon >= 0 ? collapse(text.slice(d.from, kids[colon]!.from)) : collapse(sliceOf(d));
    const value = colon >= 0 ? joined(kids.slice(colon + 1)) : "";
    const semicolon = compress && last ? "" : ";";
    if (colon < 0) return name + semicolon;
    return `${name}:${compress ? "" : " "}${value}${semicolon}`;
  };

  /** The prelude of a rule: everything before its block, from the tokens. */
  const prelude = (n: SyntaxNode, block: SyntaxNode): string => {
    const before = childrenOf(n).filter((c) => c.from < block.from);
    return joined(before);
  };

  const container = (block: SyntaxNode, depth: number) => {
    const kids = childrenOf(block).filter((c) => c.name !== "{" && c.name !== "}" && c.name !== ";");
    const decls = kids.filter((k) => k.name === "Declaration");
    const lastDecl = decls[decls.length - 1] ?? null;
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i]!;
      if (k.name === "Declaration") {
        emit(depth, declaration(k, lastDecl !== null && k.from === lastDecl.from));
        continue;
      }
      if (k.name === "Comment") {
        if (compress) comments++;
        else emit(depth, sliceOf(k));
        continue;
      }
      const next = kids[i + 1];
      if (k.name === "KeyframeSelector" && next && CONTAINERS.has(next.name)) {
        rule(collapse(sliceOf(k)), next, depth);
        i++;
        continue;
      }
      statement(k, depth);
    }
  };

  const rule = (head: string, block: SyntaxNode, depth: number) => {
    const inner = childrenOf(block).filter((c) => c.name !== "{" && c.name !== "}" && c.name !== ";" && !(compress && c.name === "Comment"));
    if (inner.length === 0) {
      if (compress) comments += childrenOf(block).filter((c) => c.name === "Comment").length;
      emit(depth, compress ? `${head}{}` : `${head} {}`);
      return;
    }
    if (compress) {
      const start = lines.length;
      container(block, depth + 1);
      const body = lines.splice(start).join("");
      emit(depth, `${head}{${body}}`);
      return;
    }
    emit(depth, `${head} {`);
    container(block, depth + 1);
    emit(depth, "}");
  };

  /** A top-level or nested statement: a rule with a block, or a one-line at-rule. */
  const statement = (n: SyntaxNode, depth: number) => {
    if (n.name === "Comment") {
      if (compress) comments++;
      else emit(depth, sliceOf(n));
      return;
    }
    const block = childrenOf(n).find((c) => CONTAINERS.has(c.name));
    if (block) {
      rule(prelude(n, block), block, depth);
      return;
    }
    const kids = childrenOf(n).filter((c) => c.name !== ";");
    emit(depth, joined(kids) + ";");
  };

  const top = childrenOf(tree.topNode).filter((c) => c.name !== ";");
  let prevEnd = -1;
  for (const n of top) {
    // A blank line between two top-level statements is kept, once: it is how a sheet is grouped.
    if (!compress && prevEnd >= 0 && /\n[ \t]*\r?\n/.test(text.slice(prevEnd, n.from))) lines.push("");
    statement(n, 0);
    prevEnd = n.to;
  }
  const body = lines.join(style.eol);
  const trailing = /\r?\n$/.test(text) && style.eol.length > 0 ? style.eol : "";
  return { text: body + trailing, problem: null, comments };
}

function firstFault(text: string, tree: Tree): string | null {
  let at = -1;
  tree.iterate({
    enter(n) {
      if (at >= 0) return false;
      if (n.type.isError) {
        at = n.from;
        return false;
      }
      return true;
    },
  });
  if (at < 0) return null;
  return `could not read the stylesheet at line ${text.slice(0, at).split("\n").length}`;
}
