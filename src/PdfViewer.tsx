import { PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.2;

const clampZoom = (value: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));

interface PageDimensions {
  width: number;
  height: number;
}

interface PdfViewerProps {
  src: string;
  title: string;
}

interface LoadedPdf {
  doc: PDFDocumentProxy;
  dimensions: PageDimensions[];
}

// Parsed documents outlive the component: remounting the planner view reuses
// the same PDFDocumentProxy instead of re-downloading and re-parsing the file.
const loadedPdfCache = new Map<string, Promise<LoadedPdf>>();

const loadPdf = (src: string): Promise<LoadedPdf> => {
  const cached = loadedPdfCache.get(src);

  if (cached) {
    return cached;
  }

  const promise = pdfjs.getDocument({ url: src }).promise.then(async (doc) => {
    const dimensions: PageDimensions[] = [];

    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      dimensions.push({ width: viewport.width, height: viewport.height });
    }

    return { doc, dimensions };
  });

  loadedPdfCache.set(src, promise);
  // Drop failed loads so the next mount retries instead of replaying the error.
  promise.catch(() => loadedPdfCache.delete(src));

  return promise;
};

// Renders the PDF with pdf.js so zoom works the same in every browser.
// Zoom 1 means "fit the panel width"; page boxes get their size synchronously
// from CSS while canvases re-render asynchronously at the new resolution.
export const PdfViewer = ({ src, title }: PdfViewerProps) => {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageDimensions, setPageDimensions] = useState<PageDimensions[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [fitWidth, setFitWidth] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  // The move handler checks this ref, not the state: a pointermove can arrive
  // before the pointerdown's re-render delivers the updated closure.
  const isPanningRef = useRef(false);
  const panLastPointRef = useRef({ x: 0, y: 0 });
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const renderGenerationRef = useRef(0);
  const previousZoomRef = useRef(1);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;

  useEffect(() => {
    let cancelled = false;

    loadPdf(src)
      .then(({ doc: loadedDoc, dimensions }) => {
        if (cancelled) {
          return;
        }

        setDoc(loadedDoc);
        setPageDimensions(dimensions);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadFailed(true);
        }
      });

    // No destroy on unmount: the cached document is shared with future mounts.
    return () => {
      cancelled = true;
    };
  }, [src]);

  // Fit-width baseline tracks the panel width, so resizing the split pane
  // (or the window) reflows the document instead of clipping it.
  useEffect(() => {
    const scroller = scrollRef.current;

    if (!scroller) {
      return;
    }

    const updateFitWidth = () => {
      // Padding on both sides of the page stack.
      setFitWidth(Math.max(0, scroller.clientWidth - 24));
    };

    updateFitWidth();

    const observer = new ResizeObserver(updateFitWidth);
    observer.observe(scroller);

    return () => observer.disconnect();
  }, [doc]);

  const firstPageWidth = pageDimensions[0]?.width ?? 0;
  const baseScale = firstPageWidth > 0 && fitWidth > 0 ? fitWidth / firstPageWidth : 1;
  const scale = baseScale * zoom;

  useEffect(() => {
    if (!doc || fitWidth === 0) {
      return;
    }

    renderGenerationRef.current += 1;
    const generation = renderGenerationRef.current;
    const outputScale = window.devicePixelRatio || 1;

    const renderPages = async () => {
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
        if (generation !== renderGenerationRef.current) {
          return;
        }

        const canvas = canvasRefs.current[pageNumber - 1];

        if (!canvas) {
          continue;
        }

        try {
          const page = await doc.getPage(pageNumber);
          const viewport = page.getViewport({ scale });
          const context = canvas.getContext('2d');

          if (!context || generation !== renderGenerationRef.current) {
            return;
          }

          canvas.width = Math.floor(viewport.width * outputScale);
          canvas.height = Math.floor(viewport.height * outputScale);
          await page.render({
            canvas,
            canvasContext: context,
            viewport,
            transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
          }).promise;
        } catch {
          // A newer render pass cancelled this one; the newer pass owns the canvas.
          return;
        }
      }
    };

    void renderPages();
  }, [doc, scale, fitWidth]);

  // Page boxes resize in the same commit as the zoom change, so scaling the
  // scroll offsets by the zoom ratio keeps the visible spot in place.
  useEffect(() => {
    const scroller = scrollRef.current;
    const ratio = zoom / previousZoomRef.current;
    previousZoomRef.current = zoom;

    if (scroller && ratio !== 1) {
      scroller.scrollTop *= ratio;
      scroller.scrollLeft = Math.max(0, (scroller.scrollLeft + scroller.clientWidth / 2) * ratio - scroller.clientWidth / 2);
    }
  }, [zoom]);

  // Ctrl/Cmd + wheel (and trackpad pinch, which browsers report as ctrl+wheel)
  // must be a non-passive native listener to preventDefault the page zoom.
  useEffect(() => {
    const scroller = scrollRef.current;

    if (!scroller) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0022);
      setZoom(clampZoom(zoomRef.current * factor));
    };

    scroller.addEventListener('wheel', handleWheel, { passive: false });

    return () => scroller.removeEventListener('wheel', handleWheel);
  }, [doc]);

  // Mouse drag pans the document; touch keeps native scrolling (touch-action),
  // which already pans and rubber-bands the way people expect on phones.
  const handlePanPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) {
      return;
    }

    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is an optimization (keeps the pan alive outside the panel);
      // panning still works without it.
    }
    panLastPointRef.current = { x: event.clientX, y: event.clientY };
    isPanningRef.current = true;
    setIsPanning(true);
  };

  const handlePanPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isPanningRef.current) {
      return;
    }

    const scroller = scrollRef.current;

    if (!scroller) {
      return;
    }

    scroller.scrollLeft -= event.clientX - panLastPointRef.current.x;
    scroller.scrollTop -= event.clientY - panLastPointRef.current.y;
    panLastPointRef.current = { x: event.clientX, y: event.clientY };
  };

  const handlePanPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Nothing to release when capture never took hold.
      }
      setIsPanning(false);
    }
  };

  if (loadFailed) {
    return (
      <div className="pdf-viewer pdf-viewer-message" role="status">
        <p>Could not load the PDF.</p>
        <a href={src} target="_blank" rel="noreferrer">
          Open it in a new tab instead
        </a>
      </div>
    );
  }

  return (
    <div className="pdf-viewer">
      <div className="pdf-toolbar">
        <span className="pdf-toolbar-title" title={title}>
          {title}
        </span>
        <div className="pdf-zoom-controls">
          <button
            type="button"
            className="pdf-zoom-button"
            onClick={() => setZoom((current) => clampZoom(current / ZOOM_STEP))}
            disabled={!doc || zoom <= ZOOM_MIN}
            aria-label="Zoom out"
            title="Zoom out"
          >
            <Minus size={16} strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="pdf-zoom-level"
            onClick={() => setZoom(1)}
            disabled={!doc}
            aria-label="Reset zoom to fit width"
            title="Fit width"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            className="pdf-zoom-button"
            onClick={() => setZoom((current) => clampZoom(current * ZOOM_STEP))}
            disabled={!doc || zoom >= ZOOM_MAX}
            aria-label="Zoom in"
            title="Zoom in"
          >
            <Plus size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div
        className={`pdf-scroll${isPanning ? ' is-panning' : ''}`}
        ref={scrollRef}
        onPointerDown={handlePanPointerDown}
        onPointerMove={handlePanPointerMove}
        onPointerUp={handlePanPointerEnd}
        onPointerCancel={handlePanPointerEnd}
      >
        {doc ? (
          <div className="pdf-pages">
            {pageDimensions.map((dimensions, index) => (
              <div
                key={index}
                className="pdf-page"
                style={{
                  width: `${dimensions.width * scale}px`,
                  height: `${dimensions.height * scale}px`,
                }}
              >
                <canvas
                  ref={(element) => {
                    canvasRefs.current[index] = element;
                  }}
                  aria-label={`Page ${index + 1} of ${pageDimensions.length}`}
                />
              </div>
            ))}
          </div>
        ) : (
          <p className="pdf-loading" role="status">
            Loading PDF…
          </p>
        )}
      </div>
    </div>
  );
};
