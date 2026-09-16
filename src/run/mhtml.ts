/**
 * MHTML (`.mht`, `.mhtml`, a web archive): a MIME multipart whose first
 * `text/html` part is the page and whose other parts are its stylesheets,
 * images and fonts, each with a `Content-Location` (the URL it was fetched
 * from) and often a `Content-ID` (`cid:…`). `renderMhtml` decodes every part,
 * turns each resource into a `data:` URI and rewrites the references in the
 * HTML and inside the stylesheets to them, so the page renders inside the
 * sandboxed frame with its styles and images and without touching the
 * network (2026-09-08: a Chrome-saved page came out blank because every
 * stylesheet was `cid:`). Pure, this plugin's own code: no library parses it.
 */

export function looksLikeMhtml(text: string): boolean {
  const head = text.slice(0, 4096);
  return /^(From|MIME-Version|Subject|Snapshot-Content-Location|Content-Type):/im.test(head) && /boundary=/i.test(head);
}

function quotedPrintableBytes(s: string): Uint8Array {
  const bytes: number[] = [];
  const joined = s.replace(/=\r?\n/g, "");
  for (let i = 0; i < joined.length; i++) {
    const c = joined.charCodeAt(i);
    if (c === 0x3d && i + 2 < joined.length && /^[0-9A-Fa-f]{2}$/.test(joined.slice(i + 1, i + 3))) {
      bytes.push(parseInt(joined.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(c & 0xff);
  }
  return new Uint8Array(bytes);
}

function base64Bytes(s: string): Uint8Array {
  const bin = atob(s.replace(/[^A-Za-z0-9+/=]/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** The text the archive was written in: the bytes of a part decoded as the file text (UTF-8 for anything Blink saves). */
function utf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

interface MhtmlPart {
  readonly type: string;
  readonly location: string | null;
  readonly id: string | null;
  readonly bytes: Uint8Array;
}

/** Every part of the archive with its decoded bytes; empty when the text is not a multipart. */
function parseMhtml(text: string): MhtmlPart[] {
  const boundaryMatch = text.match(/boundary="?([^"\r\n;]+)"?/i);
  if (!boundaryMatch) return [];
  const boundary = boundaryMatch[1] ?? "";
  const out: MhtmlPart[] = [];
  for (const part of text.split(`--${boundary}`).slice(1)) {
    const sep = part.search(/\r?\n\r?\n/);
    if (sep === -1) continue;
    // Folded headers (a continuation line starts with whitespace) are one header.
    const headers = part.slice(0, sep).replace(/\r?\n[ \t]+/g, " ");
    // The line break before the next boundary belongs to the boundary (RFC 2046), not to the body.
    const body = part.slice(sep).replace(/^\r?\n\r?\n/, "").replace(/\r?\n$/, "");
    const type = (headers.match(/content-type:\s*([^;\r\n]+)/i)?.[1] ?? "application/octet-stream").trim().toLowerCase();
    const location = headers.match(/content-location:\s*(\S+)/i)?.[1] ?? null;
    const id = headers.match(/content-id:\s*<([^>]+)>/i)?.[1] ?? null;
    const encoding = (headers.match(/content-transfer-encoding:\s*([\w-]+)/i)?.[1] ?? "").toLowerCase();
    let bytes: Uint8Array;
    try {
      bytes = encoding === "quoted-printable" ? quotedPrintableBytes(body) : encoding === "base64" ? base64Bytes(body) : utf8Bytes(body);
    } catch {
      continue;
    }
    out.push({ type, location, id, bytes });
  }
  return out;
}

/** The first text/html part, decoded, or null when the text is not a multipart with one. Kept for the tests and as the fallback when resolving fails. */
export function extractHtmlFromMhtml(text: string): string | null {
  const html = parseMhtml(text).find((p) => p.type === "text/html");
  return html ? new TextDecoder("utf-8").decode(html.bytes) : null;
}

/** A URL as it appears in the archive, resolved against the part it appears in; the reference itself when that fails. */
function absolute(ref: string, base: string | null): string {
  if (/^(?:cid|data|blob|about|javascript):/i.test(ref)) return ref;
  if (!base) return ref;
  try {
    return new URL(ref, base).href;
  } catch {
    return ref;
  }
}

/** A document as the value of a double-quoted attribute (`srcdoc`): the two characters that would end it. */
function escapeAttribute(html: string): string {
  return html.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/** `url(...)` references inside a stylesheet or a style attribute, rewritten through `lookup`. */
function rewriteCssUrls(css: string, base: string | null, lookup: (url: string) => string | null): string {
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (whole, quote: string, ref: string) => {
    const data = lookup(absolute(ref.trim(), base));
    return data ? `url(${quote}${data}${quote})` : whole;
  });
}

/**
 * `@import "x.css"` and `@import url(x.css)` of a stylesheet the archive
 * holds become that stylesheet's text in place (its own references resolved
 * first); an import the archive lacks stays as it is and is refused by the
 * policy. Text, not a `data:` URI, because a stylesheet LOAD of any kind is
 * refused inside Obsidian (see `pageDocument`).
 */
function rewriteCssImports(css: string, base: string | null, lookup: (url: string) => string | null, cssText: (url: string) => string | null): string {
  const inlined = css.replace(/@import\s+(?:url\(\s*(["']?)([^"')]+)\1\s*\)|(["'])([^"']+)\3)\s*([^;]*);/gi, (whole, _q1: string, u1: string | undefined, _q2: string, u2: string | undefined, media: string) => {
    const ref = (u1 ?? u2 ?? "").trim();
    const text = cssText(absolute(ref, base));
    if (text === null) return whole;
    const m = media.trim();
    return m.length > 0 ? `@media ${m} {\n${text}\n}` : text;
  });
  return rewriteCssUrls(inlined, base, lookup);
}

/**
 * The page with every archived resource inlined so that the frame needs
 * nothing from anywhere: images, fonts and media as `data:` URIs in `src`,
 * `href`, `poster`, `data`, `srcset`, `style` attributes and `url()` inside
 * styles; stylesheets as `<style>` blocks (a `<link rel=stylesheet>` to a
 * part becomes one, an `@import` of a part becomes its text); a frame whose
 * source is an archived `text/html` part gets that part as its `srcdoc`, a
 * document of its own under the same policy (inherited: a srcdoc frame
 * takes its parent's), so nothing nested reaches the network either
 * (`srcdoc` rather than a `data:` URL because Chromium drops a navigation
 * to a URL over 2 MB). A reference the archive does not hold is left as it
 * is and stays blank in the frame. Null when there is no HTML part.
 */
export function renderMhtml(text: string, token?: string): string | null {
  const parts = parseMhtml(text);
  const htmlPart = parts.find((p) => p.type === "text/html");
  if (!htmlPart) return null;
  return renderPart(htmlPart, parts.filter((p) => p !== htmlPart), new Set(), token);
}

function renderPart(htmlPart: MhtmlPart, resources: readonly MhtmlPart[], framing: Set<MhtmlPart>, token?: string): string {
  const html = new TextDecoder("utf-8").decode(htmlPart.bytes);
  if (resources.length === 0) return html;

  const byKey = new Map<string, MhtmlPart>();
  for (const p of resources) {
    if (p.location) byKey.set(p.location, p);
    if (p.id) byKey.set(`cid:${p.id}`, p);
  }
  const partFor = (url: string): MhtmlPart | null => byKey.get(url) ?? byKey.get(url.replace(/#.*$/, "")) ?? null;

  // A stylesheet's text with its own imports and url() resolved; memoised, cycles cut.
  const cssCache = new Map<MhtmlPart, string>();
  const cssInProgress = new Set<MhtmlPart>();
  const cssOf = (p: MhtmlPart): string => {
    const done = cssCache.get(p);
    if (done !== undefined) return done;
    if (cssInProgress.has(p)) return "";
    cssInProgress.add(p);
    const out = rewriteCssImports(new TextDecoder("utf-8").decode(p.bytes), p.location, lookup, cssText);
    cssInProgress.delete(p);
    cssCache.set(p, out);
    return out;
  };
  const cssText = (url: string): string | null => {
    const p = partFor(url);
    return p && p.type === "text/css" ? cssOf(p) : null;
  };
  // A nested page (a frame Chrome saved as its own part) rendered as a document
  // of its own; null for a part that frames its own ancestor. As a frame's
  // `srcdoc` it inherits this page's policy and gets no meta of its own: a
  // second, identical policy made every refusal fire twice (the user's Log,
  // 2026-09-16, each font twice). As a `data:` document it carries the meta.
  const pages = new Map<string, string | null>();
  const pageOf = (p: MhtmlPart, as: "srcdoc" | "data"): string | null => {
    const key = `${as}:${resources.indexOf(p)}`;
    const done = pages.get(key);
    if (done !== undefined) return done;
    let doc: string | null = null;
    if (!framing.has(p)) {
      const nested = new Set(framing);
      nested.add(htmlPart);
      doc = pageDocument(renderPart(p, resources.filter((r) => r !== p), nested, token), token, as === "data");
    }
    pages.set(key, doc);
    return doc;
  };
  // Anything else as a data: URI; a nested page as a data: document where only a URL will do.
  const encoded = new Map<MhtmlPart, string>();
  const lookup = (url: string): string | null => {
    const p = partFor(url);
    if (!p) return null;
    const done = encoded.get(p);
    if (done) return done;
    let uri: string;
    if (p.type === "text/html") {
      const doc = pageOf(p, "data");
      if (doc === null) return null;
      uri = `data:text/html;base64,${toBase64(utf8Bytes(doc))}`;
    } else if (p.type === "text/css") {
      uri = `data:text/css;base64,${toBase64(utf8Bytes(cssOf(p)))}`;
    } else {
      uri = `data:${p.type};base64,${toBase64(p.bytes)}`;
    }
    encoded.set(p, uri);
    return uri;
  };
  const base = htmlPart.location;

  // An attribute value is everything up to its own closing quote; the other quote may appear inside (url('…') in a style).
  const attr = (name: string) => new RegExp(`(\\s(?:${name})\\s*=\\s*)(?:"([^"]*)"|'([^']*)')`, "gi");
  const quoted = (dq: string | undefined, value: string) => (dq !== undefined ? `"${value}"` : `'${value}'`);
  // Stylesheet links first: a <link rel=stylesheet> to an archived stylesheet becomes a <style> block.
  let out = html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/\brel\s*=\s*["']?[^"'>]*stylesheet/i.test(tag)) return tag;
    const href = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    const ref = (href?.[1] ?? href?.[2] ?? "").trim();
    if (!ref) return tag;
    const css = cssText(absolute(ref, base));
    if (css === null) return tag;
    const media = /\smedia\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    const m = (media?.[1] ?? media?.[2] ?? "").trim();
    return m.length > 0 ? `<style media="${m}">${css}</style>` : `<style>${css}</style>`;
  });
  out = out.replace(attr("src|href|poster|data"), (whole, lead: string, dq: string | undefined, sq: string | undefined) => {
    const ref = dq ?? sq ?? "";
    const url = absolute(ref.trim(), base);
    // A frame's archived page goes in as `srcdoc`, not a `data:` URL: Chromium
    // drops a navigation to a URL over 2 MB, and a saved page with its images
    // inlined passes that easily (an html5up demo frame: 2.6 MB, blank on the
    // device, 2026-09-15). An attribute has no such limit, and a srcdoc frame
    // renders under the same policy (a check in Chromium, 2026-09-16).
    const part = partFor(url);
    if (part?.type === "text/html" && /^\ssrc\s*=/i.test(lead)) {
      const doc = pageOf(part, "srcdoc");
      return doc === null ? whole : `${lead.replace(/src/i, "srcdoc")}"${escapeAttribute(doc)}"`;
    }
    const data = lookup(url);
    return data ? `${lead}${quoted(dq, data)}` : whole;
  });
  out = out.replace(attr("srcset"), (whole, lead: string, dq: string | undefined, sq: string | undefined) => {
    const list = dq ?? sq ?? "";
    let changed = false;
    const rewritten = list
      .split(",")
      .map((entry) => {
        const m = entry.trim().match(/^(\S+)(\s+\S+)?$/);
        if (!m) return entry;
        const data = lookup(absolute(m[1] ?? "", base));
        if (!data) return entry;
        changed = true;
        return `${data}${m[2] ?? ""}`;
      })
      .join(", ");
    return changed ? `${lead}${quoted(dq, rewritten)}` : whole;
  });
  out = out.replace(attr("style"), (_whole, lead: string, dq: string | undefined, sq: string | undefined) => `${lead}${quoted(dq, rewriteCssUrls(dq ?? sq ?? "", base, lookup))}`);
  out = out.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_whole, open: string, css: string, close: string) => `${open}${rewriteCssImports(css, base, lookup, cssText)}${close}`);
  return out;
}

/**
 * What the page reports back to the panel's Log, so that a page that shows
 * something unexpected can say why: its console, uncaught
 * errors, unhandled rejections, every Content-Security-Policy refusal and
 * one line at load. A sandboxed frame in an opaque origin can still
 * `postMessage` to `window.top`, and the panel accepts only messages
 * carrying the token of the run it started (nested frames of an archive
 * post to `top` too, with the same token). One line on purpose, so a page's
 * own line numbers in error messages stay right. Inline, which the policy
 * allows; nothing else could carry it into an opaque origin.
 */
export function pageReporter(token: string): string {
  const js = [
    "(function(){",
    `var T=${JSON.stringify(token)};var top=window.top;`,
    "function post(level,text){try{top.postMessage({nfe:T,level:level,text:String(text).slice(0,2000)},'*')}catch(e){}}",
    "['log','info','warn','error','debug'].forEach(function(l){var o=console[l];console[l]=function(){post(l,Array.prototype.map.call(arguments,function(a){if(typeof a==='string')return a;if(a instanceof Error)return String(a.stack||a);try{return JSON.stringify(a)}catch(e){return String(a)}}).join(' '));if(o)o.apply(console,arguments)}});",
    "window.addEventListener('error',function(e){post('error',(e.message||'error')+(e.lineno?' (line '+e.lineno+')':''))});",
    "window.addEventListener('unhandledrejection',function(e){post('error','Unhandled rejection: '+(e.reason&&e.reason.message||e.reason))});",
    "document.addEventListener('securitypolicyviolation',function(e){post('csp',e.violatedDirective+' refused '+(e.blockedURI||'inline').slice(0,120)+(e.sourceFile?' from '+e.sourceFile.slice(0,80):''))});",
    "window.addEventListener('load',function(){post('load','loaded: '+(document.title||'(no title)')+', '+document.querySelectorAll('iframe').length+' frame(s), '+document.scripts.length+' script(s), '+document.styleSheets.length+' stylesheet(s)')});",
    "})();",
  ].join("");
  return `<script>${js}</script>`;
}

/**
 * The document handed to the sandboxed iframe: the page with a policy that
 * lets nothing load from anywhere (ADR-001: no network, ever): inline
 * scripts and styles, `data:` scripts, `data:`/`blob:` images and media,
 * `data:` fonts, `data:` frames (an archive's nested pages go in as
 * `srcdoc`, which no frame-src source has to name and which inherits this
 * policy, so they carry no meta of their own; `data:` stays for a link to
 * one, with the meta inside, since a `data:` document may not inherit). A `<script src>` or `fetch` to any URL is refused by
 * the browser; `eval` is allowed because the frame's origin is opaque and
 * there is nothing to reach. The frame itself (RunPanel.showPage) grants
 * scripts and nothing else.
 *
 * Stylesheets are never loaded, only inlined: an `about:srcdoc` document
 * inherits its parent's policy, and Obsidian's own `index.html` carries
 * `style-src 'unsafe-inline' 'self' https://fonts.googleapis.com`, which
 * refuses a `data:` stylesheet whatever this meta says (two policies
 * intersect). Found 2026-09-09 in `obsidian.asar`; until then the blank
 * html5up archive was blamed on the page's own meta, which it never had.
 */
export const PAGE_CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' data:; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; frame-src data:;";

export function pageDocument(html: string, token?: string, policy = true): string {
  const csp = `${policy ? `<meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}">` : ""}${token ? pageReporter(token) : ""}`;
  // The page's own policy would ALSO apply (two meta policies intersect);
  // offline in a sandbox, the plugin's policy is the one that matters, so
  // the page's is dropped.
  html = html.replace(/<meta\s+[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi, "");
  if (/<head[\s>]/i.test(html)) return html.replace(/<head([^>]*)>/i, (m) => `${m}${csp}`);
  if (/<html[\s>]/i.test(html)) return html.replace(/<html([^>]*)>/i, (m) => `${m}<head>${csp}</head>`);
  return `<!doctype html><html><head>${csp}</head><body>${html}</body></html>`;
}
