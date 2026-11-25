import sanitizeHtml from "sanitize-html";

/*
 * The HTML of a mail, made safe to show. Mails come from anyone, so the HTML is cleaned here,
 * on the server, before it is stored or sent to the browser:
 * - no scripts, forms, frames, event handlers (onclick…), javascript: links, <base>, <meta>, <link>;
 * - links open outside Lamio (target _blank, rel noopener noreferrer), with their real address as
 *   title, so it shows on hover even when the text says something else;
 * - remote images (used to know when and where a mail was opened) are kept aside in
 *   data-lamio-src: the browser loads nothing until the person asks for them;
 * - the images carried by the mail itself (cid:) are swapped for their data.
 * The page then shows it in an isolated iframe (no scripts, strict CSP): see lib/mail-frame.ts.
 */

import { REMOTE_BACKGROUND, REMOTE_SRC } from "@/lib/mail-frame";

export { REMOTE_BACKGROUND, REMOTE_SRC };

const REMOTE = /^https?:\/\//i;

const TAGS = [
  ...sanitizeHtml.defaults.allowedTags,
  "img",
  "style",
  "font",
  "center",
  "big",
  "small",
  "strike",
  "s",
  "u",
  "col",
  "colgroup",
];

const COMMON = ["style", "class", "id", "align", "valign", "width", "height", "bgcolor", "color", "border", "cellpadding", "cellspacing", "dir", "lang", "title", "role", REMOTE_BACKGROUND];

export type CleanMail = { html: string; remote: boolean };

/**
 * @param inline the images carried by the mail, by Content-ID (without the < >): a data: or
 *   same-origin URL. A cid: image missing from it is dropped.
 */
export function cleanMailHtml(html: string, inline: Map<string, string> = new Map()): CleanMail {
  let remote = false;
  const out = sanitizeHtml(html, {
    allowedTags: TAGS,
    // <style> is needed by most newsletters (layout, mobile rules). CSS cannot run code, and what
    // it could load from the network is blocked by the iframe's CSP.
    allowVulnerableTags: true,
    nonTextTags: ["script", "textarea", "option", "noscript", "title"],
    allowedAttributes: {
      "*": COMMON,
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "width", "height", REMOTE_SRC],
      td: ["colspan", "rowspan", "nowrap"],
      th: ["colspan", "rowspan", "nowrap", "scope"],
      font: ["face", "size", "color"],
      ol: ["start", "type"],
      col: ["span"],
      colgroup: ["span"],
      table: ["summary"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["data"] },
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => {
        const href = (attribs.href ?? "").trim();
        const external = REMOTE.test(href) || /^(mailto|tel):/i.test(href);
        const next: Record<string, string> = { ...attribs, target: "_blank", rel: "noopener noreferrer" };
        delete next[REMOTE_BACKGROUND];
        if (external) next.title = href;
        return { tagName, attribs: next };
      },
      img: (tagName, attribs) => {
        const { src = "", ...rest } = attribs;
        const value = src.trim();
        delete rest[REMOTE_SRC];
        delete rest[REMOTE_BACKGROUND];
        if (/^cid:/i.test(value)) {
          const found = inline.get(decodeURIComponent(value.slice(4)).replace(/^<|>$/g, ""));
          return { tagName, attribs: found ? { ...rest, src: found } : rest };
        }
        if (REMOTE.test(value)) {
          remote = true;
          return { tagName, attribs: { ...rest, [REMOTE_SRC]: value } };
        }
        // data: images stay (checked by allowedSchemesByTag), anything else goes.
        return { tagName, attribs: /^data:image\//i.test(value) ? { ...rest, src: value } : rest };
      },
      // The old background="…" attribute of tables and cells: a remote image too.
      "*": (tagName, attribs) => {
        // Runs after the transforms above, on every tag. Only this code writes these two
        // attributes: one coming with the mail is dropped (img's was already checked above).
        const { background, ...rest } = attribs;
        delete rest[REMOTE_BACKGROUND];
        if (tagName !== "img") delete rest[REMOTE_SRC];
        if (background === undefined) return { tagName, attribs: rest };
        if (REMOTE.test(background.trim())) {
          remote = true;
          return { tagName, attribs: { ...rest, [REMOTE_BACKGROUND]: background.trim() } };
        }
        return { tagName, attribs: rest };
      },
    },
  });
  // Remote images in CSS (background: url(https://…)): the CSP blocks them, but the button is offered.
  if (!remote && /url\(\s*['"]?\s*https?:/i.test(out)) remote = true;
  return { html: out, remote };
}

/**
 * The HTML of a mail being sent, written in Lamio's editor (or pasted into it): simple
 * formatting only, images kept as they are (they are the person's own choice).
 */
export function cleanOutgoingHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ["p", "div", "br", "span", "b", "strong", "i", "em", "u", "s", "strike", "a", "ul", "ol", "li", "blockquote", "h1", "h2", "h3", "pre", "code", "hr", "img", "table", "thead", "tbody", "tr", "td", "th", "font", "sub", "sup"],
    allowedAttributes: { "*": ["style", "dir"], a: ["href"], img: ["src", "alt", "width", "height"], td: ["colspan", "rowspan"], th: ["colspan", "rowspan"], font: ["color", "face", "size"] },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https", "data", "cid"] },
    allowProtocolRelative: false,
  });
}
