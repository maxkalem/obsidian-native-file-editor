import { LanguageSupport } from "@codemirror/language";
import { prismaLanguage } from "@fazelstudio/codemirror-lang-prisma";
import { Decoration, type DecorationSet, EditorView, MatchDecorator, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { styleTags, tags as t } from "@lezer/highlight";

/**
 * The Prisma grammar as shipped colours almost nothing (checked in Obsidian,
 * 2026-09-09): names of blocks, strings and comments, and that is all. Two
 * reasons, read from the package and its parse tree:
 *
 * 1. Its `styleTags` name nodes whose text is entirely covered by an
 *    `Identifier` child (`Attribute/AttributeName`, `FieldName`, …); a tag on
 *    such a node applies to nothing, because lezer's highlighter gives a
 *    node's class to the text between its children only, unless the rule is
 *    written `Node/...`. The tags here target the leaves.
 * 2. The keywords (`generator`, `datasource`, `model`, `enum`, `type`) are
 *    anonymous literals in the grammar, not nodes, so no tag can reach them.
 *    A `MatchDecorator` marks them at the start of a line instead, with the
 *    same classes the highlighter would have emitted.
 */
const PRISMA_TAGS = styleTags({
  "FieldName/Identifier": t.propertyName,
  "TypeName/Identifier": t.typeName,
  TypeModifier: t.modifier,
  "AttributeName/Identifier": t.attributeName,
  "FunctionCall/Identifier": t.function(t.variableName),
  "ConfigAssignment/Identifier": t.propertyName,
  "EnumValue/Identifier": t.constant(t.variableName),
  EnumValue: t.constant(t.variableName),
  Number: t.number,
  Boolean: t.bool,
});

export const PRISMA_KEYWORD = /^(?:generator|datasource|model|enum|type)(?=\s)/g;

const keywordMark = Decoration.mark({ class: "cm-keyword nfe-tok-keyword" });
const keywordDecorator = new MatchDecorator({ regexp: PRISMA_KEYWORD, decoration: keywordMark });
const prismaKeywords = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = keywordDecorator.createDeco(view);
    }
    update(update: ViewUpdate): void {
      this.decorations = keywordDecorator.updateDeco(update, this.decorations);
    }
  },
  { decorations: (v) => v.decorations }
);

/** The language with the tags above; `parser.configure` adds props without replacing the package's own. */
export const prismaFixedLanguage = prismaLanguage.configure({ props: [PRISMA_TAGS] });

export function prismaFixed(): LanguageSupport {
  return new LanguageSupport(prismaFixedLanguage, [prismaKeywords]);
}
