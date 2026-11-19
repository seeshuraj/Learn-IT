import React, { useEffect, useRef, useState } from "react";

/**
 * In-app PDF viewer (pdf.js), so notes open inside LearnIT on every device.
 *
 * Phone browsers don't render PDFs inside an <iframe>: Android Chrome shows a
 * blank box or a download prompt, iOS Safari shows only the first page. Users
 * then had to open the file in a new tab and lost the AI tutor. Pages here are
 * drawn to canvases at the container's width, rendered lazily as they scroll
 * into view, and re-rendered when the width changes (rotation, split view).
 *
 * pdf.js (pdfjs-dist, pinned) is bundled and served from our own origin, but
 * loaded only when a PDF is opened, so it costs nothing on other pages and
 * doesn't depend on a third-party CDN that a college network may block. If it
 * can't load, `onUnavailable` lets the caller fall back to the browser's own
 * viewer.
 */

type PdfJs = {
  getDocument: (src: { data: ArrayBuffer }) => { promise: Promise<PdfDoc>; destroy: () => Promise<void> };
  GlobalWorkerOptions: { workerSrc: string };
};
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage>; destroy: () => Promise<void> };
type PdfPage = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void>; cancel: () => void };
};

let pdfjsPromise: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import("pdfjs-dist/build/pdf.min.mjs"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ]).then(([m, worker]) => {
      const lib = ((m as any)?.getDocument ? m : (m as any).default) as unknown as PdfJs;
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    });
    pdfjsPromise.catch(() => { pdfjsPromise = null; });   // allow a retry later
  }
  return pdfjsPromise;
}

interface Props {
  /** Signed or blob URL of the PDF. */
  url: string;
  title: string;
  /** Called when pdf.js can't load or parse the file; the caller shows a fallback. */
  onUnavailable?: () => void;
  className?: string;
}

export const PdfViewer: React.FC<Props> = ({ url, title, onUnavailable, className = "" }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [pageSizes, setPageSizes] = useState<{ w: number; h: number }[]>([]);
  const [width, setWidth] = useState(0);
  const [current, setCurrent] = useState(1);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  // Load the document.
  useEffect(() => {
    let cancelled = false;
    let loaded: PdfDoc | null = null;
    setStatus("loading");
    setDoc(null);
    setPageSizes([]);
    (async () => {
      try {
        const [lib, data] = await Promise.all([
          loadPdfJs(),
          fetch(url).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); }),
        ]);
        loaded = await lib.getDocument({ data }).promise;
        if (cancelled) { void loaded.destroy(); return; }
        // Page sizes up front so the scroll height is right before pages render.
        const sizes: { w: number; h: number }[] = [];
        for (let i = 1; i <= loaded.numPages; i++) {
          const vp = (await loaded.getPage(i)).getViewport({ scale: 1 });
          sizes.push({ w: vp.width, h: vp.height });
        }
        if (cancelled) { void loaded.destroy(); return; }
        setPageSizes(sizes);
        setDoc(loaded);
        setStatus("ready");
      } catch {
        if (!cancelled) { setStatus("error"); onUnavailable?.(); }
      }
    })();
    return () => { cancelled = true; if (loaded) void loaded.destroy(); };
  }, [url]);

  // Track the available width (rotation, chat panel opening, window resize).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const w = Math.floor(entries[0].contentRect.width);
      setWidth(prev => (Math.abs(prev - w) > 8 ? w : prev));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pageWidth = Math.max(0, width - 16);

  return (
    <div className={`relative bg-slate-100 ${className}`}>
      <div ref={scrollRef} className="h-full overflow-y-auto overscroll-contain px-2 py-2" aria-label={`${title}, PDF`}>
        {status === "loading" && (
          <div className="flex h-full min-h-[200px] items-center justify-center" role="status">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" />
            <span className="sr-only">Loading PDF…</span>
          </div>
        )}
        {status === "error" && (
          <p className="p-6 text-center text-sm text-slate-500">This PDF can't be shown here. Use Open or Download.</p>
        )}
        {doc && pageWidth > 0 && pageSizes.map((size, i) => (
          <PdfPageCanvas
            key={i}
            doc={doc}
            pageNumber={i + 1}
            width={pageWidth}
            aspect={size.h / size.w}
            root={scrollRef}
            onVisible={setCurrent}
          />
        ))}
      </div>
      {status === "ready" && pageSizes.length > 1 && (
        <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-slate-900/70 px-2.5 py-1 text-xs font-medium text-white">
          {current} / {pageSizes.length}
        </div>
      )}
    </div>
  );
};

const PdfPageCanvas: React.FC<{
  doc: PdfDoc;
  pageNumber: number;
  width: number;
  aspect: number;
  root: React.RefObject<HTMLDivElement | null>;
  onVisible: (n: number) => void;
}> = ({ doc, pageNumber, width, aspect, root, onVisible }) => {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(pageNumber <= 2);
  const height = Math.round(width * aspect);

  // Render only pages near the viewport; report the page in view.
  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.isIntersecting) setNear(true);
        if (e.intersectionRatio > 0.5) onVisible(pageNumber);
      }
    }, { root: root.current, rootMargin: "600px 0px", threshold: [0, 0.5] });
    io.observe(el);
    return () => io.disconnect();
  }, [pageNumber]);

  useEffect(() => {
    if (!near || !canvas.current) return;
    let task: { cancel: () => void } | null = null;
    let cancelled = false;
    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled || !canvas.current) return;
      const base = page.getViewport({ scale: 1 });
      // Sharp on high-density screens, capped so large pages don't exhaust phone memory.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: (width / base.width) * dpr });
      const c = canvas.current;
      c.width = Math.floor(viewport.width);
      c.height = Math.floor(viewport.height);
      const ctx = c.getContext("2d");
      if (!ctx) return;
      const t = page.render({ canvasContext: ctx, viewport });
      task = t;
      await t.promise.catch(() => {});
    })();
    return () => { cancelled = true; task?.cancel(); };
  }, [near, width, doc, pageNumber]);

  return (
    <div ref={holder} className="mx-auto mb-2 bg-white shadow-sm" style={{ width, height }}>
      <canvas ref={canvas} style={{ width, height }} aria-label={`Page ${pageNumber}`} />
    </div>
  );
};

export default PdfViewer;
