/**
 * MHTML (`.mht`, `.mhtml`, a web archive): a MIME multipart whose first
 * `text/html` part is the page and whose other parts are its stylesheets,
 * images and fonts, each with a `Content-Location` (the URL it was fetched
 * from) and often a `Content-ID` (`cid:…`). `renderMhtml` decodes every part,
 * turns each resource into a `data:` URI and rewrites the references in the
 * HTML and inside the stylesheets to them, so the page renders inside the
 * sandboxed frame with its styles and images and without touching the
 * network (2026-09-08: a Chrome-saved page came out blank because every
 * stylesheet was `cid:`). Pure, this plugin's own code (spec §2 rule 2).
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

/** `url(...)` references inside a stylesheet or a style attribute, rewritten through `lookup`. */
function rewriteCssUrls(css: string, base: string | null, lookup: (url: string) => string | null): string {
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (whole, quote: string, ref: string) => {
    const data = lookup(absolute(ref.trim(), base));
    return data ? `url(${quote}${data}${quote})` : whole;
  });
}

/** `@import "x.css"` and `@import url(x.css)` both go through `rewriteCssUrls`; the bare string form is turned into url() first. */
function rewriteCssImports(css: string, base: string | null, lookup: (url: string) => string | null): string {
  const withUrl = css.replace(/@import\s+(["'])([^"']+)\1/gi, (_m, q: string, ref: string) => `@import url(${q}${ref}${q})`);
  return rewriteCssUrls(withUrl, base, lookup);
}

/**
 * The page with every archived resource inlined: `src`, `href`, `poster`,
 * `data` and `srcset` attributes, `style` attributes, `<style>` blocks and
 * the stylesheets themselves (their own `url()` and `@import` references
 * resolved against their own location) all point at `data:` URIs built from
 * the parts. A reference the archive does not hold is left as it is and
 * stays blank in the frame (no network). Null when there is no HTML part.
 */
export function renderMhtml(text: string): string | null {
  const parts = parseMhtml(text);
  const htmlPart = parts.find((p) => p.type === "text/html");
  if (!htmlPart) return null;
  const html = new TextDecoder("utf-8").decode(htmlPart.bytes);
  const resources = parts.filter((p) => p !== htmlPart);
  if (resources.length === 0) return html;

  // Resolution is memoised per part: a stylesheet's data: URI depends on the
  // parts it references, so a stylesheet is rewritten before it is encoded.
  const byKey = new Map<string, MhtmlPart>();
  for (const p of resources) {
    if (p.location) byKey.set(p.location, p);
    if (p.id) byKey.set(`cid:${p.id}`, p);
  }
  const encoded = new Map<MhtmlPart, string>();
  const inProgress = new Set<MhtmlPart>();
  const dataUri = (p: MhtmlPart): string => {
    const done = encoded.get(p);
    if (done) return done;
    let bytes = p.bytes;
    if (p.type === "text/css" && !inProgress.has(p)) {
      inProgress.add(p);
      const css = new TextDecoder("utf-8").decode(p.bytes);
      bytes = utf8Bytes(rewriteCssImports(css, p.location, lookup));
      inProgress.delete(p);
    }
    const uri = `data:${p.type};base64,${toBase64(bytes)}`;
    encoded.set(p, uri);
    return uri;
  };
  const lookup = (url: string): string | null => {
    const p = byKey.get(url) ?? byKey.get(url.replace(/#.*$/, ""));
    return p ? dataUri(p) : null;
  };
  const base = htmlPart.location;

  // An attribute value is everything up to its own closing quote; the other quote may appear inside (url('…') in a style).
  const attr = (name: string) => new RegExp(`(\\s(?:${name})\\s*=\\s*)(?:"([^"]*)"|'([^']*)')`, "gi");
  const quoted = (dq: string | undefined, value: string) => (dq !== undefined ? `"${value}"` : `'${value}'`);
  let out = html.replace(attr("src|href|poster|data"), (whole, lead: string, dq: string | undefined, sq: string | undefined) => {
    const ref = dq ?? sq ?? "";
    const data = lookup(absolute(ref.trim(), base));
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
  out = out.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_whole, open: string, css: string, close: string) => `${open}${rewriteCssImports(css, base, lookup)}${close}`);
  return out;
}

/**
 * The document handed to the sandboxed iframe: the page with a policy that
 * lets nothing load from anywhere (spec §2 rule 1: no network, ever): inline
 * scripts and styles, `data:` scripts and stylesheets (what `renderMhtml`
 * makes of an archive's parts), `data:`/`blob:` images and media, `data:`
 * fonts. A `<script src>` or `fetch` to any URL is refused by the browser; `eval` is
 * allowed because the frame's origin is opaque and there is nothing to reach.
 * The frame itself (RunPanel.showPage) grants scripts and nothing else.
 */
export const PAGE_CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' data:; style-src 'unsafe-inline' data:; img-src data: blob:; media-src data: blob:; font-src data:;";

export function pageDocument(html: string): string {
  const csp = `<meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}">`;
  // The page's own policy would ALSO apply (two meta policies intersect):
  // html5up's `style-src 'self' https://fonts.googleapis.com` refused the
  // data: stylesheets the archive was rewritten to (2026-09-08). Offline in a
  // sandbox, the plugin's policy is the one that matters; the page's is dropped.
  html = html.replace(/<meta\s+[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi, "");
  if (/<head[\s>]/i.test(html)) return html.replace(/<head([^>]*)>/i, (m) => `${m}${csp}`);
  if (/<html[\s>]/i.test(html)) return html.replace(/<html([^>]*)>/i, (m) => `${m}<head>${csp}</head>`);
  return `<!doctype html><html><head>${csp}</head><body>${html}</body></html>`;
}
