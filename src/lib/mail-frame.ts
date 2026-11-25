/*
 * The page an HTML mail is shown in: an isolated iframe document (srcdoc). The HTML was cleaned on
 * the server (server/mail/html.ts); this adds the second wall, a CSP that lets nothing run and
 * nothing load from the internet unless the person asked for the images.
 */

/** Where the server keeps the remote images of a mail until the person asks for them. */
export const REMOTE_SRC = "data-lamio-src";
export const REMOTE_BACKGROUND = "data-lamio-background";

const BASE_STYLE = `
html { background: #ffffff; color: #1d1d1f; color-scheme: light; }
body { margin: 0; padding: 20px; font: 14.5px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif; overflow-wrap: anywhere; }
img { max-width: 100%; }
img[${REMOTE_SRC}] { background: #f1f0f5; }
pre { white-space: pre-wrap; }
blockquote { margin-left: 0; padding-left: 12px; border-left: 3px solid #dcdae4; color: #55535f; }
a { color: #6f42e6; }
`;

export function frameDocument(html: string, showImages: boolean): string {
  const remote = showImages ? " https: http:" : "";
  const csp = `default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; font-src data:${remote}; img-src data: 'self'${remote}; form-action 'none'; base-uri 'none'`;
  // Only the server writes these attributes, and a quote inside an attribute or a text is always
  // escaped, so this can only hit the attributes it wrote.
  const body = showImages ? html.replaceAll(` ${REMOTE_SRC}="`, ` src="`).replaceAll(` ${REMOTE_BACKGROUND}="`, ` background="`) : html;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><base target="_blank"><style>${BASE_STYLE}</style></head><body>${body}</body></html>`;
}
