import type { StreamParser } from "@codemirror/language";

/**
 * A stream mode for MHTML (`.mht`, `.mhtml`), this plugin's own: a MIME
 * multipart archive whose first part is the page. Colours the MIME headers
 * (name, value), the part boundaries, quoted-printable escapes (`=3D`, a
 * trailing `=` soft break) and, inside a `text/html` part, the tags,
 * attributes, attribute values, entities and comments of the HTML. Other
 * parts (base64 images, stylesheets) stay plain. Token names are lezer tag
 * names for the highlighter.
 */

interface MhtmlState {
  /** Reading a header block (the archive's, or a part's after a boundary). */
  inHeaders: boolean;
  /** The current part is HTML: its body is tokenised as markup. */
  htmlPart: boolean;
  /** Inside a `<!-- … -->` comment spanning lines. */
  inComment: boolean;
  /** Inside a tag, after the name: attributes until `>`. */
  inTag: boolean;
}

export const mhtmlMode: StreamParser<MhtmlState> = {
  name: "mhtml",
  startState: () => ({ inHeaders: true, htmlPart: false, inComment: false, inTag: false }),
  copyState: (s) => ({ ...s }),
  // The empty line that ends a header block never reaches `token`.
  blankLine(state) {
    state.inHeaders = false;
  },
  token(stream, state) {
    if (stream.sol()) {
      if (stream.match(/^--[^\s]+/)) {
        // A boundary line opens the next part's headers; a closing boundary ends the archive.
        state.inHeaders = !stream.string.endsWith("--");
        state.htmlPart = false;
        state.inComment = false;
        state.inTag = false;
        return "meta";
      }
      if (state.inHeaders) {
        if (stream.string.trim() === "") {
          state.inHeaders = false;
          stream.skipToEnd();
          return null;
        }
        if (stream.match(/^[A-Za-z][\w-]*(?=:)/)) {
          if (/^content-type$/i.test(stream.current()) && /text\/html/i.test(stream.string)) state.htmlPart = true;
          return "propertyName";
        }
        if (stream.match(/^\s+\S/)) {
          // A folded header continuation.
          stream.skipToEnd();
          return "string";
        }
      }
    }
    if (state.inHeaders) {
      if (stream.match(/^:/)) return "punctuation";
      stream.skipToEnd();
      return "string";
    }
    // Quoted-printable escapes appear in any text part.
    if (stream.match(/^=[0-9A-Fa-f]{2}/)) return "escape";
    if (stream.match(/^=$/)) return "escape";
    if (!state.htmlPart) {
      stream.skipToEnd();
      return null;
    }
    if (state.inComment) {
      if (stream.match(/^[\s\S]*?-->/)) state.inComment = false;
      else stream.skipToEnd();
      return "comment";
    }
    if (state.inTag) {
      if (stream.match(/^\/?>/)) {
        state.inTag = false;
        return "angleBracket";
      }
      if (stream.match(/^[^\s=>/"']+/)) return "attributeName";
      if (stream.match(/^=/)) return "operator";
      if (stream.match(/^"[^"]*"?/) || stream.match(/^'[^']*'?/)) return "attributeValue";
      if (stream.eatSpace()) return null;
      stream.next();
      return null;
    }
    if (stream.match(/^<!--[\s\S]*?-->/)) return "comment";
    if (stream.match(/^<!--/)) {
      state.inComment = true;
      return "comment";
    }
    if (stream.match(/^<!\w[^>]*>?/)) return "meta";
    if (stream.match(/^<\/?[A-Za-z][\w:-]*/)) {
      state.inTag = true;
      return "tagName";
    }
    if (stream.match(/^&#?\w+;/)) return "atom";
    stream.match(/^[^<&=]+/) || stream.next();
    return null;
  },
};
