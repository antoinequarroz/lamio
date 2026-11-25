import { describe, expect, it } from "vitest";
import { frameDocument } from "./mail-frame";

describe("frameDocument", () => {
  const html = `<p>Salut</p><img data-lamio-src="https://pixel.example/a.gif"><td data-lamio-background="https://img.example/b.jpg"></td>`;

  it("loads nothing from the internet by default", () => {
    const doc = frameDocument(html, false);
    expect(doc).toContain("img-src data: 'self';");
    expect(doc).toContain("script-src 'none'");
    expect(doc).not.toMatch(/ src="https| background="https/);
  });

  it("puts the images back when asked", () => {
    const doc = frameDocument(html, true);
    expect(doc).toContain("img-src data: 'self' https: http:");
    expect(doc).toContain(`<img src="https://pixel.example/a.gif">`);
    expect(doc).toContain(`<td background="https://img.example/b.jpg">`);
  });

  it("does not touch text that only looks like the attribute", () => {
    const doc = frameDocument(`<p>data-lamio-src=&quot;https://x&quot;</p>`, true);
    expect(doc).toContain(`<p>data-lamio-src=&quot;https://x&quot;</p>`);
  });
});
