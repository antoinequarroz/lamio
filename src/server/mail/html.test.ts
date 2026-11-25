import { describe, expect, it } from "vitest";
import { cleanMailHtml, REMOTE_BACKGROUND, REMOTE_SRC } from "./html";

describe("cleanMailHtml", () => {
  it("removes everything that could run code or send data", () => {
    const { html } = cleanMailHtml(`
      <html><head><title>Titre</title><meta http-equiv="refresh" content="0;url=https://evil.example"><base href="https://evil.example/">
      <link rel="stylesheet" href="https://evil.example/a.css"><script>alert(1)</script></head>
      <body onload="alert(2)"><p onclick="alert(3)">Bonjour</p>
      <a href="javascript:alert(4)">piège</a><a href="JaVaScRiPt:alert(5)">piège 2</a>
      <img src="x" onerror="alert(6)"><svg><script>alert(7)</script></svg>
      <iframe src="https://evil.example"></iframe><object data="x"></object><embed src="x">
      <form action="https://evil.example"><input name="password"><button>OK</button></form>
      <style>p{color:red}</style><noscript>non</noscript></body></html>`);
    expect(html).not.toMatch(/script|alert|onload|onclick|onerror|javascript|iframe|object|embed|form|input|<meta|<base|<link|evil\.example|Titre/i);
    expect(html).toContain("<p>Bonjour</p>");
    expect(html).toContain("<style>p{color:red}</style>");
  });

  it("keeps the layout of a newsletter", () => {
    const { html } = cleanMailHtml(`<table width="600" cellpadding="0" bgcolor="#ffffff" style="margin:0 auto"><tr><td colspan="2" align="center"><font face="Arial" color="#333">Texte</font><h1 class="t">Titre</h1></td></tr></table>`);
    expect(html).toBe(`<table width="600" cellpadding="0" bgcolor="#ffffff" style="margin:0 auto"><tr><td colspan="2" align="center"><font face="Arial" color="#333">Texte</font><h1 class="t">Titre</h1></td></tr></table>`);
  });

  it("opens links outside, with the real address on hover", () => {
    const { html } = cleanMailHtml(`<a href="https://tracker.example/r?u=1" target="_self">Votre banque</a><a href="mailto:a@b.ch">écrire</a>`);
    expect(html).toBe(`<a href="https://tracker.example/r?u=1" target="_blank" rel="noopener noreferrer" title="https://tracker.example/r?u=1">Votre banque</a><a href="mailto:a@b.ch" target="_blank" rel="noopener noreferrer" title="mailto:a@b.ch">écrire</a>`);
  });

  it("keeps remote images aside and says so", () => {
    const r = cleanMailHtml(`<img src="https://pixel.example/open.gif" width="1"><td background="http://img.example/bg.jpg">x</td>`);
    expect(r.remote).toBe(true);
    expect(r.html).not.toMatch(/ src=| background=/);
    expect(r.html).toContain(`${REMOTE_SRC}="https://pixel.example/open.gif"`);
    expect(r.html).toContain(`${REMOTE_BACKGROUND}="http://img.example/bg.jpg"`);
    expect(cleanMailHtml(`<div style="background:url('https://img.example/a.png')">x</div>`).remote).toBe(true);
    expect(cleanMailHtml(`<p>Rien à charger</p>`).remote).toBe(false);
  });

  it("does not let a mail write the attributes itself", () => {
    const { html, remote } = cleanMailHtml(`<div ${REMOTE_BACKGROUND}="javascript:x"><img ${REMOTE_SRC}="https://pixel.example/a.gif" src="data:image/png;base64,AAAA"><a ${REMOTE_BACKGROUND}="x" href="https://a.ch">a</a></div>`);
    expect(remote).toBe(false);
    expect(html).not.toContain("data-lamio");
    expect(html).toContain(`src="data:image/png;base64,AAAA"`);
  });

  it("shows the images carried by the mail", () => {
    const inline = new Map([["logo@lamio", "data:image/png;base64,iVBOR"]]);
    const { html, remote } = cleanMailHtml(`<img src="cid:logo@lamio" alt="Logo"><img src="cid:absent@x">`, inline);
    expect(remote).toBe(false);
    expect(html).toBe(`<img alt="Logo" src="data:image/png;base64,iVBOR" /><img />`);
  });
});
