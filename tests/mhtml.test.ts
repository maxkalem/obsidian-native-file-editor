import { describe, expect, it } from "vitest";
import { extractHtmlFromMhtml, looksLikeMhtml, pageDocument } from "../src/run/mhtml";

/** The MHTML unwrapper and the page wrapper behind the in-pane page view. */

const qp = 'From: <Saved by Blink>\r\nSubject: Notes\r\nMIME-Version: 1.0\r\nContent-Type: multipart/related;\r\n\ttype="text/html";\r\n\tboundary="----MultipartBoundary--abc"\r\n\r\n------MultipartBoundary--abc\r\nContent-Type: text/html\r\nContent-ID: <frame-1@mhtml.blink>\r\nContent-Transfer-Encoding: quoted-printable\r\nContent-Location: https://example.com/\r\n\r\n<html><body><p>caf=C3=A9 =3D 3 line=\r\n break</p></body></html>\r\n------MultipartBoundary--abc\r\nContent-Type: image/png\r\nContent-Transfer-Encoding: base64\r\n\r\niVBORw0KGgo=\r\n------MultipartBoundary--abc--\r\n';

describe("mhtml", () => {
  it("recognises an archive by its MIME headers and boundary", () => {
    expect(looksLikeMhtml(qp)).toBe(true);
    expect(looksLikeMhtml("<html><body>x</body></html>")).toBe(false);
    expect(looksLikeMhtml("Subject: hi\nno boundary here")).toBe(false);
  });

  it("returns the first text/html part decoded from quoted-printable, with soft line breaks joined", () => {
    expect(extractHtmlFromMhtml(qp)).toBe("<html><body><p>café = 3 line break</p></body></html>\r\n");
  });

  it("decodes base64 and passes 8bit through; a missing html part or boundary is null", () => {
    const b64 = 'Content-Type: multipart/related; boundary=b\n\n--b\nContent-Type: text/html\nContent-Transfer-Encoding: base64\n\n' + Buffer.from("<b>ok</b>", "utf8").toString("base64") + "\n--b--";
    expect(extractHtmlFromMhtml(b64)).toBe("<b>ok</b>");
    const plain = "Content-Type: multipart/related; boundary=b\n\n--b\nContent-Type: text/html; charset=utf-8\n\n<i>raw</i>\n--b--";
    expect(extractHtmlFromMhtml(plain)).toBe("<i>raw</i>\n");
    expect(extractHtmlFromMhtml("Content-Type: multipart/related; boundary=b\n\n--b\nContent-Type: text/plain\n\nx\n--b--")).toBeNull();
    expect(extractHtmlFromMhtml("no boundary")).toBeNull();
  });

  it("injects the no-network policy into the head, or wraps a fragment", () => {
    expect(pageDocument("<html><head><title>t</title></head><body/></html>")).toMatch(/^<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:;"><title>t<\/title>/);
    expect(pageDocument("<html lang='en'><body>x</body></html>")).toMatch(/^<html lang='en'><head><meta http-equiv/);
    expect(pageDocument("<p>x</p>")).toMatch(/^<!doctype html><html><head><meta http-equiv=.*<\/head><body><p>x<\/p><\/body><\/html>$/);
  });
});
