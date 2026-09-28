import type { SyntaxNode, Tree } from "@lezer/common";

/**
 * The plugin's own XML and HTML formatter and compressor, over the lezer
 * tree the editor already holds (`@codemirror/lang-xml`, `@codemirror/lang-html`).
 *
 * Format puts one element per line and indents the nesting; Compress puts
 * everything on one line and drops the comments. Both leave the data alone:
 *
 * - An element with text among its children (`<p>Hi <b>x</b></p>`, mixed
 *   content) is copied as it stands, from its opening tag to its closing one.
 *   Breaking it into lines would put whitespace into the text, which HTML
 *   renders and XML stores.
 * - An element that holds text alone (`<title> T </title>`) is one line with
 *   its text untouched: the spaces around the text are data in XML.
 * - `pre`, `textarea`, `listing`, `plaintext`, `script` and `style` in HTML,
 *   and any element carrying `xml:space="preserve"`, are copied whole.
 * - Whitespace between elements goes: it is the previous formatting, not
 *   content, in every document a pretty-printer is asked to touch.
 * - Inside a tag, the runs between attributes become one space; the values
 *   and their quotes stay as written.
 * - A comment, a processing instruction, a doctype and a CDATA section each
 *   take a line of their own, verbatim; Compress drops the comments.
 *
 * An XML document that is not well-formed (a mismatched or missing close
 * tag, anything the grammar could not read) is refused with the line of the
 * first fault: a formatter that guesses at structure writes the guess into
 * the file. HTML is forgiving by design — an unclosed `<li>` is closed by the
 * parser as the browser would — and is formatted as parsed.
 */

export type MarkupKind = "xml" | "html";

export interface MarkupStyle {
  readonly indent: string;
  readonly eol: string;
}

export interface MarkupResult {
  readonly text: string;
  readonly problem: string | null;
  /** Comments dropped (Compress only; 0 for Format). */
  readonly comments: number;
}

const HTML_PRESERVED = new Set(["pre", "textarea", "listing", "plaintext", "script", "style"]);

export function formatMarkup(text: string, tree: Tree, kind: MarkupKind, style: MarkupStyle): MarkupResult {
  return render(text, tree, kind, style, false);
}

export function compressMarkup(text: string, tree: Tree, kind: MarkupKind): MarkupResult {
  return render(text, tree, kind, { indent: "", eol: "" }, true);
}

function render(text: string, tree: Tree, kind: MarkupKind, style: MarkupStyle, compress: boolean): MarkupResult {
  if (kind === "xml") {
    const fault = firstFault(text, tree);
    if (fault !== null) return { text, problem: fault, comments: 0 };
  }
  const lines: string[] = [];
  let comments = 0;
  const emit = (depth: number, s: string) => lines.push(style.indent.repeat(depth) + s);
  const walk = (node: SyntaxNode, depth: number) => {
    switch (node.name) {
      case "Text":
      case "EntityReference":
        // Only reached between elements: text that is whitespace is dropped,
        // anything else is a document with content at the top level, kept.
        if (text.slice(node.from, node.to).trim().length > 0) emit(depth, text.slice(node.from, node.to));
        return;
      case "Comment":
        if (compress) comments++;
        else emit(depth, text.slice(node.from, node.to));
        return;
      case "Element":
        element(node, depth);
        return;
      default:
        // ProcessingInst, DoctypeDecl, Cdata, and anything a grammar adds.
        emit(depth, text.slice(node.from, node.to));
    }
  };
  const element = (el: SyntaxNode, depth: number) => {
    const open = el.firstChild;
    if (!open) return;
    if (open.name === "SelfClosingTag") {
      emit(depth, tag(text, open));
      return;
    }
    if (open.name !== "OpenTag" || preserved(text, open, kind)) {
      emit(depth, text.slice(el.from, el.to));
      return;
    }
    const close = el.lastChild && el.lastChild.name === "CloseTag" ? el.lastChild : null;
    const inner: SyntaxNode[] = [];
    // Nodes are compared by position: `nextSibling` hands out fresh objects.
    for (let c = open.nextSibling; c && (close === null || c.from < close.from); c = c.nextSibling) inner.push(c);
    const mixed = inner.some((c) => (c.name === "Text" && text.slice(c.from, c.to).trim().length > 0) || c.name === "EntityReference");
    const structural = inner.every((c) => c.name === "Element" || c.name === "Text" || c.name === "Comment" || c.name === "ProcessingInst" || c.name === "Cdata" || c.name === "EntityReference");
    const closeText = close ? text.slice(close.from, close.to).replace(/\s+/g, "") : "";
    if (mixed || !structural) {
      // Text among the children, or a nested language (a script body):
      // the content as it stands, between the normalised tags.
      const from = inner[0]!.from;
      const to = inner[inner.length - 1]!.to;
      emit(depth, tag(text, open) + text.slice(from, to) + closeText);
      return;
    }
    const children = inner.filter((c) => !(c.name === "Text" && text.slice(c.from, c.to).trim().length === 0) && !(compress && c.name === "Comment"));
    if (compress) comments += inner.filter((c) => c.name === "Comment").length;
    if (children.length === 0) {
      emit(depth, tag(text, open) + closeText);
      return;
    }
    emit(depth, tag(text, open));
    for (const c of children) walk(c, depth + 1);
    if (close) emit(depth, closeText);
  };
  for (let c = tree.topNode.firstChild; c; c = c.nextSibling) walk(c, 0);
  const body = lines.join(style.eol);
  const trailing = /\r?\n$/.test(text) && style.eol.length > 0 ? style.eol : "";
  return { text: body + trailing, problem: null, comments };
}

/** An opening or self-closing tag with one space between its attributes and nothing else changed. */
function tag(text: string, open: SyntaxNode): string {
  const parts: string[] = [];
  for (let c = open.firstChild; c; c = c.nextSibling) {
    const slice = text.slice(c.from, c.to);
    if (c.name === "Attribute") parts.push(" " + slice);
    else parts.push(slice);
  }
  return parts.join("");
}

function preserved(text: string, open: SyntaxNode, kind: MarkupKind): boolean {
  const name = open.getChild("TagName");
  const tagName = name ? text.slice(name.from, name.to) : "";
  if (kind === "html" && HTML_PRESERVED.has(tagName.toLowerCase())) return true;
  for (const attr of open.getChildren("Attribute")) {
    const attrName = attr.getChild("AttributeName");
    const value = attr.getChild("AttributeValue");
    if (attrName && value && text.slice(attrName.from, attrName.to) === "xml:space" && /^["']preserve["']$/.test(text.slice(value.from, value.to))) return true;
  }
  return false;
}

/** The first thing the XML grammar could not read, as a line number for the notice; null when the document is well-formed. */
function firstFault(text: string, tree: Tree): string | null {
  let at = -1;
  let what = "";
  tree.iterate({
    enter(n) {
      if (at >= 0) return false;
      if (n.type.isError || n.name === "MismatchedCloseTag" || n.name === "MissingCloseTag") {
        at = n.from;
        what = n.name === "MismatchedCloseTag" ? "a closing tag that matches no open element" : n.name === "MissingCloseTag" ? "an element that is never closed" : "unexpected content";
        return false;
      }
      return true;
    },
  });
  if (at < 0) return null;
  const line = text.slice(0, at).split("\n").length;
  return `not well-formed: ${what} at line ${line}`;
}
