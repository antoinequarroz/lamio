"use client";

import { Download, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { frameDocument } from "@/lib/mail-frame";

/**
 * An HTML mail, in an iframe that cannot run anything: sandbox without allow-scripts, and a CSP
 * that blocks scripts and every load from the internet (unless showImages). allow-same-origin
 * only lets this page measure the mail's height; with scripts off, the mail itself cannot use it.
 * Links open in a new window, outside the sandbox.
 */
export function MailFrame({ html, showImages, title }: { html: string; showImages: boolean; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(240);
  const doc = useMemo(() => frameDocument(html, showImages), [html, showImages]);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let content: ResizeObserver | null = null;
    let lastWidth = 0;
    const measure = () => {
      const root = frame.contentDocument?.documentElement;
      // The height of the content (scrollHeight would never go below the frame's own height).
      if (root) setHeight(Math.max(80, Math.ceil(root.getBoundingClientRect().height)));
    };
    // A newsletter made for 600 px in a narrower column: scaled down to fit, like Apple Mail,
    // rather than cut on the right.
    const fit = () => {
      const root = frame.contentDocument?.documentElement;
      if (!root || !frame.clientWidth || frame.clientWidth === lastWidth) return;
      lastWidth = frame.clientWidth;
      root.style.zoom = "1";
      const natural = root.scrollWidth;
      root.style.zoom = natural > lastWidth + 1 ? String(lastWidth / natural) : "1";
      measure();
    };
    const onLoad = () => {
      lastWidth = 0;
      fit();
      measure();
      content?.disconnect();
      const root = frame.contentDocument?.documentElement;
      if (root) {
        content = new ResizeObserver(measure);
        content.observe(root);
      }
    };
    const outer = new ResizeObserver(fit);
    outer.observe(frame);
    frame.addEventListener("load", onLoad);
    if (frame.contentDocument?.readyState === "complete") onLoad();
    return () => {
      frame.removeEventListener("load", onLoad);
      outer.disconnect();
      content?.disconnect();
    };
  }, [doc]);

  return (
    <div className="overflow-hidden rounded-xl bg-white ring-1 ring-line">
      <iframe
        ref={ref}
        title={title}
        srcDoc={doc}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        style={{ height }}
        className="block w-full border-0"
      />
    </div>
  );
}

/** An image attachment, full screen. Escape or a click outside closes it. */
export function ImagePreview({ src, name, download, onClose }: { src: string; name: string; download: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div role="dialog" aria-label={name} className="fixed inset-0 z-50 flex flex-col bg-black/85 backdrop-blur-sm" onClick={onClose}>
      <header className="flex h-12 shrink-0 items-center gap-3 px-4 text-[13px] text-white/90" onClick={(e) => e.stopPropagation()}>
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <a href={download} className="press flex size-8 items-center justify-center rounded-lg hover:bg-white/10" aria-label="Télécharger">
          <Download className="size-4" />
        </a>
        <button onClick={onClose} className="press flex size-8 items-center justify-center rounded-lg hover:bg-white/10" aria-label="Fermer">
          <X className="size-4" />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4 pt-0">
        {/* eslint-disable-next-line @next/next/no-img-element -- a file of the mail, served by the API */}
        <img src={src} alt={name} className="max-h-full max-w-full rounded-md object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
      </div>
    </div>
  );
}
