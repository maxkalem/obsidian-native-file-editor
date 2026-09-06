import type { StreamParser } from "@codemirror/language";

/**
 * A stream mode for GraphQL, this plugin's own. The community package
 * (`cm6-graphql`) brings the `graphql` reference implementation and its
 * language service, close to a megabyte, for a schema-aware editor this
 * plugin does not need; a keyword mode covers `.graphql` files the way
 * Notepad++ would. Token names are lezer tag names for the highlighter.
 */

const KEYWORDS = new Set([
  "query",
  "mutation",
  "subscription",
  "fragment",
  "on",
  "schema",
  "type",
  "interface",
  "union",
  "enum",
  "input",
  "scalar",
  "extend",
  "directive",
  "implements",
  "repeatable",
  "extends",
]);
const CONSTANTS = new Set(["true", "false", "null"]);
const SCALARS = new Set(["Int", "Float", "String", "Boolean", "ID"]);

interface GraphqlState {
  /** Inside a `"""` block string. */
  inBlockString: boolean;
}

export const graphqlMode: StreamParser<GraphqlState> = {
  name: "graphql",
  startState: () => ({ inBlockString: false }),
  copyState: (s) => ({ inBlockString: s.inBlockString }),
  token(stream, state) {
    if (state.inBlockString) {
      if (stream.match(/^[\s\S]*?"""/)) state.inBlockString = false;
      else stream.skipToEnd();
      return "string";
    }
    if (stream.eatSpace()) return null;
    if (stream.match(/^#.*/)) return "comment";
    if (stream.match(/^"""/)) {
      state.inBlockString = true;
      if (stream.match(/^[\s\S]*?"""/)) state.inBlockString = false;
      else stream.skipToEnd();
      return "string";
    }
    if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return "string";
    if (stream.match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/)) return "number";
    if (stream.match(/^\$[A-Za-z_]\w*/)) return "variableName";
    if (stream.match(/^@[A-Za-z_]\w*/)) return "meta";
    if (stream.match(/^[A-Za-z_]\w*/)) {
      const word = stream.current();
      if (KEYWORDS.has(word)) return "keyword";
      if (CONSTANTS.has(word)) return "atom";
      if (SCALARS.has(word)) return "typeName";
      // `Name(` is a field with arguments, `Name:` an argument or alias, a
      // capitalised bare name is a type.
      if (stream.match(/^\s*\(/, false)) return "propertyName";
      if (stream.match(/^\s*:/, false)) return "attributeName";
      if (/^[A-Z]/.test(word)) return "typeName";
      return "propertyName";
    }
    if (stream.match(/^\.\.\./)) return "operator";
    if (stream.match(/^[!=|&:]/)) return "operator";
    if (stream.match(/^[{}()\[\]]/)) return "bracket";
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: "#" } },
};
