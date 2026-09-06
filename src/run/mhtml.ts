/**
 * The HTML inside an MHTML (`.mht`, web archive) file: a MIME multipart whose
 * first `text/html` part is the page, encoded quoted-printable or base64.
 * Enough to render the page inside Obsidian; the archive's images and styles
 * (the other parts) are not resolved, so the page shows without them. Pure,
 * this plugin's own code (spec §2 rule 2).
 */

export function looksLikeMhtml(text: string): boolean {
  const head = text.slice(0, 4096);
  return /^(From|MIME-Version|Subject|Snapshot-Content-Location|Content-Type):/im.test(head) && /boundary=/i.test(head);
}

function decodeQuotedPrintable(s: string): string {
  const bytes: number[] = [];
  const joined = s.replace(/=\r?\n/g, "");
  for (let i = 0; i < joined.length; i++) {
    const c = joined.charCodeAt(i);
    if (c === 0x3d && i + 2 < joined.length && /^[0-9A-Fa-f]{2}$/.test(joined.slice(i + 1, i + 3))) {
      bytes.push(parseInt(joined.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(c & 0xff);
  }
  return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
}

function decodeBase64(s: string): string {
  const clean = s.replace(/[^A-Za-z0-9+/=]/g, "");
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

/** The first text/html part, decoded, or null when the text is not a multipart with one. */
export function extractHtmlFromMhtml(text: string): string | null {
  const boundaryMatch = text.match(/boundary="?([^"\r\n;]+)"?/i);
  if (!boundaryMatch) return null;
  const boundary = boundaryMatch[1] ?? "";
  const parts = text.split(`--${boundary}`);
  for (const part of parts) {
    const sep = part.search(/\r?\n\r?\n/);
    if (sep === -1) continue;
    const headers = part.slice(0, sep);
    const body = part.slice(sep).replace(/^\r?\n\r?\n/, "");
    if (!/content-type:\s*text\/html/i.test(headers)) continue;
    const encoding = (headers.match(/content-transfer-encoding:\s*([\w-]+)/i)?.[1] ?? "").toLowerCase();
    try {
      if (encoding === "quoted-printable") return decodeQuotedPrintable(body);
      if (encoding === "base64") return decodeBase64(body);
    } catch {
      return null;
    }
    return body;
  }
  return null;
}

/**
 * The document handed to the sandboxed iframe: the page with a policy that
 * lets nothing load from anywhere (spec §2 rule 1: no network, ever), only
 * inline styles and data: images. Scripts are already off through `sandbox`.
 */
export function pageDocument(html: string): string {
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:;">`;
  if (/<head[\s>]/i.test(html)) return html.replace(/<head([^>]*)>/i, (m) => `${m}${csp}`);
  if (/<html[\s>]/i.test(html)) return html.replace(/<html([^>]*)>/i, (m) => `${m}<head>${csp}</head>`);
  return `<!doctype html><html><head>${csp}</head><body>${html}</body></html>`;
}
