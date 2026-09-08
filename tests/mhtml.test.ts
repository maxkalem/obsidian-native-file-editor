import { describe, expect, it } from "vitest";
import { PAGE_CSP, extractHtmlFromMhtml, looksLikeMhtml, pageDocument, renderMhtml } from "../src/run/mhtml";

/** The MHTML unwrapper and the page wrapper behind the in-pane page view. */

const qp = 'From: <Saved by Blink>\r\nSubject: Notes\r\nMIME-Version: 1.0\r\nContent-Type: multipart/related;\r\n\ttype="text/html";\r\n\tboundary="----MultipartBoundary--abc"\r\n\r\n------MultipartBoundary--abc\r\nContent-Type: text/html\r\nContent-ID: <frame-1@mhtml.blink>\r\nContent-Transfer-Encoding: quoted-printable\r\nContent-Location: https://example.com/\r\n\r\n<html><body><p>caf=C3=A9 =3D 3 line=\r\n break</p></body></html>\r\n------MultipartBoundary--abc\r\nContent-Type: image/png\r\nContent-Transfer-Encoding: base64\r\n\r\niVBORw0KGgo=\r\n------MultipartBoundary--abc--\r\n';

describe("mhtml", () => {
  it("recognises an archive by its MIME headers and boundary", () => {
    expect(looksLikeMhtml(qp)).toBe(true);
    expect(looksLikeMhtml("<html><body>x</body></html>")).toBe(false);
    expect(looksLikeMhtml("Subject: hi\nno boundary here")).toBe(false);
  });

  it("returns the first text/html part decoded from quoted-printable, with soft line breaks joined", () => {
    expect(extractHtmlFromMhtml(qp)).toBe("<html><body><p>café = 3 line break</p></body></html>");
  });

  it("decodes base64 and passes 8bit through; a missing html part or boundary is null", () => {
    const b64 = 'Content-Type: multipart/related; boundary=b\n\n--b\nContent-Type: text/html\nContent-Transfer-Encoding: base64\n\n' + Buffer.from("<b>ok</b>", "utf8").toString("base64") + "\n--b--";
    expect(extractHtmlFromMhtml(b64)).toBe("<b>ok</b>");
    const plain = "Content-Type: multipart/related; boundary=b\n\n--b\nContent-Type: text/html; charset=utf-8\n\n<i>raw</i>\n--b--";
    expect(extractHtmlFromMhtml(plain)).toBe("<i>raw</i>");
    expect(extractHtmlFromMhtml("Content-Type: multipart/related; boundary=b\n\n--b\nContent-Type: text/plain\n\nx\n--b--")).toBeNull();
    expect(extractHtmlFromMhtml("no boundary")).toBeNull();
  });

  it("injects the no-network policy into the head, or wraps a fragment", () => {
    expect(pageDocument("<html><head><title>t</title></head><body/></html>")).toBe(`<html><head><meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}"><title>t</title></head><body/></html>`);
    // Scripts run (inline, and eval inside them), nothing is fetched: no host, no scheme but data:/blob: for bytes the page already holds.
    expect(PAGE_CSP).toBe("default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' data:; style-src 'unsafe-inline' data:; img-src data: blob:; media-src data: blob:; font-src data:;");
    expect(PAGE_CSP).not.toMatch(/https?:|connect-src|\*/);
    expect(pageDocument("<html lang='en'><body>x</body></html>")).toMatch(/^<html lang='en'><head><meta http-equiv/);
    expect(pageDocument("<p>x</p>")).toMatch(/^<!doctype html><html><head><meta http-equiv=.*<\/head><body><p>x<\/p><\/body><\/html>$/);
  });

  it("renderMhtml inlines the archive's stylesheets and images as data: URIs, resolving relative references against each part's location", () => {
    const b64 = (t: string) => Buffer.from(t, "utf8").toString("base64");
    const png = "iVBORw0KGgo=";
    const mht = [
      "From: <Saved by Blink>",
      "Snapshot-Content-Location: https://site.example/page/",
      "MIME-Version: 1.0",
      "Content-Type: multipart/related;",
      '\ttype="text/html";',
      '\tboundary="----B"',
      "",
      "------B",
      "Content-Type: text/html",
      "Content-ID: <frame-1@mhtml.blink>",
      "Content-Transfer-Encoding: quoted-printable",
      "Content-Location: https://site.example/page/",
      "",
      '<html><head><link rel=3D"stylesheet" href=3D"cid:css-1@mhtml.blink"><link rel=3D"stylesheet" href=3D"assets/main.css"><style>body { background: url(=',
      'img/bg.png) }</style></head><body style=3D"background-image: url(\'img/bg.png\')">',
      '<img src=3D"img/bg.png" srcset=3D"img/bg.png 1x, https://site.example/page/img/bg.png 2x"><img src=3D"https://elsewhere.example/x.png"><a href=3D"https://site.example/page/">home</a></body></html>',
      "------B",
      "Content-Type: text/css",
      "Content-ID: <css-1@mhtml.blink>",
      "Content-Transfer-Encoding: quoted-printable",
      "Content-Location: https://site.example/page/assets/theme.css",
      "",
      "h1 { background: url(../img/bg.png); color: red }",
      "------B",
      "Content-Type: text/css",
      "Content-Transfer-Encoding: quoted-printable",
      "Content-Location: https://site.example/page/assets/main.css",
      "",
      '@import "theme.css"; p { margin: 0 }',
      "------B",
      "Content-Type: image/png",
      "Content-Transfer-Encoding: base64",
      "Content-Location: https://site.example/page/img/bg.png",
      "",
      png,
      "------B--",
      "",
    ].join("\r\n");
    const out = renderMhtml(mht);
    expect(out).not.toBeNull();
    const html = out ?? "";
    const pngUri = `data:image/png;base64,${png}`;
    // Every reference to the image, in every place it can stand, is the same data: URI.
    expect(html).toContain(`<img src="${pngUri}" srcset="${pngUri} 1x, ${pngUri} 2x">`);
    expect(html).toContain(`style="background-image: url('${pngUri}')"`);
    expect(html).toContain(`<style>body { background: url(${pngUri}) }</style>`);
    // The stylesheets are inlined with their own references resolved first (theme.css's ../img/bg.png against its own location).
    const theme = `data:text/css;base64,${b64(`h1 { background: url(${pngUri}); color: red }`)}`;
    expect(html).toContain(`href="${theme}"`);
    const main = `data:text/css;base64,${b64(`@import url("${theme}"); p { margin: 0 }`)}`;
    expect(html).toContain(`href="${main}"`);
    // What the archive does not hold stays as it was; the page's own URL is not a resource.
    expect(html).toContain('<img src="https://elsewhere.example/x.png">');
    expect(html).toContain('<a href="https://site.example/page/">home</a>');
    expect(html).not.toContain("cid:");
    // An archive with the page alone comes back untouched; no HTML part, null.
    expect(renderMhtml("Content-Type: multipart/related; boundary=b\n\n--b\nContent-Type: text/html\n\n<i>x</i>\n--b--")).toBe("<i>x</i>");
    expect(renderMhtml("Content-Type: multipart/related; boundary=b\n\n--b\nContent-Type: text/plain\n\nx\n--b--")).toBeNull();
  });
});
