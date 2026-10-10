'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ToolButton, ZoomViewer, useViewer } from './zoom-viewer';

/**
 * A document on the reading stage: an image as it is, a PDF page by page.
 *
 * PDF pages are drawn in the browser by pdf.js rather than rasterised on the
 * server: nothing about a private act is processed anywhere it does not have
 * to be, and a page is redrawn sharper when the reader zooms in instead of
 * being a fixed bitmap. The worker that parses the PDF is pdf.js's own,
 * loaded from the application's origin.
 */

type PdfDocument = {
  numPages: number;
  getPage: (n: number) => Promise<{
    getViewport: (o: { scale: number }) => { width: number; height: number };
    render: (o: {
      canvas: HTMLCanvasElement;
      canvasContext: CanvasRenderingContext2D;
      viewport: { width: number; height: number };
    }) => { promise: Promise<void>; cancel: () => void };
  }>;
  destroy: () => Promise<void>;
};

export function DocumentStage({
  src,
  mimeType,
  title,
}: {
  src: string;
  mimeType: string;
  title: string;
}) {
  return mimeType === 'application/pdf' ? (
    <PdfStage src={src} title={title} />
  ) : (
    <ImageStage src={src} title={title} />
  );
}

function ImageStage({ src, title }: { src: string; title: string }) {
  const t = useTranslations('viewer');
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);

  if (failed) return <p className="text-text-muted p-6 text-sm">{t('failed')}</p>;

  return size ? (
    <ZoomViewer width={size.w} height={size.h} label={title}>
      <img
        src={src}
        alt={title}
        width={size.w}
        height={size.h}
        draggable={false}
        className="block max-w-none"
      />
    </ZoomViewer>
  ) : (
    <div className="bg-surface-sunken flex h-full min-h-[24rem] items-center justify-center rounded-[var(--radius-lg)]">
      <span className="viewer-loading text-text-faint text-sm">{t('loading')}</span>
      <img
        src={src}
        alt=""
        className="hidden"
        onLoad={(event) =>
          setSize({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })
        }
        onError={() => setFailed(true)}
      />
    </div>
  );
}

const BASE_SCALE = 1.5;

function PdfStage({ src, title }: { src: string; title: string }) {
  const t = useTranslations('viewer');
  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let loaded: PdfDocument | null = null;
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url,
        ).toString();
        // pdf.js runs no script embedded in a PDF unless a viewer enables
        // scripting, and this one never does.
        const task = pdfjs.getDocument({ url: src });
        loaded = (await task.promise) as unknown as PdfDocument;
        if (cancelled) return void loaded.destroy();
        setPdf(loaded);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      void loaded?.destroy();
    };
  }, [src]);

  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    void pdf.getPage(page).then((p) => {
      if (cancelled) return;
      const viewport = p.getViewport({ scale: BASE_SCALE });
      setSize({ w: Math.round(viewport.width), h: Math.round(viewport.height) });
    });
    return () => {
      cancelled = true;
    };
  }, [pdf, page]);

  if (failed) return <p className="text-text-muted p-6 text-sm">{t('failed')}</p>;
  if (!pdf || !size) {
    return (
      <div className="bg-surface-sunken flex h-full min-h-[24rem] items-center justify-center rounded-[var(--radius-lg)]">
        <span className="viewer-loading text-text-faint text-sm">{t('loading')}</span>
      </div>
    );
  }

  return (
    <ZoomViewer
      key={page}
      width={size.w}
      height={size.h}
      label={t('pageOf', { title, page, pages: pdf.numPages })}
      toolbar={
        pdf.numPages > 1 ? (
          <>
            <ToolButton
              label={t('previousPage')}
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              ‹
            </ToolButton>
            <span className="text-text-muted text-xs tabular-nums">
              {t('page', { page, pages: pdf.numPages })}
            </span>
            <ToolButton
              label={t('nextPage')}
              disabled={page >= pdf.numPages}
              onClick={() => setPage((p) => p + 1)}
            >
              ›
            </ToolButton>
          </>
        ) : null
      }
    >
      <PdfCanvas pdf={pdf} page={page} width={size.w} height={size.h} />
    </ZoomViewer>
  );
}

/** One page, redrawn at the resolution the current zoom needs. */
function PdfCanvas({
  pdf,
  page,
  width,
  height,
}: {
  pdf: PdfDocument;
  page: number;
  width: number;
  height: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewer = useViewer();
  // Quantised so a pinch does not redraw on every frame: 1, 2, 3 or 4 times.
  const density = Math.min(
    Math.max(Math.ceil((viewer?.scale ?? 1) * (globalThis.devicePixelRatio || 1)), 1),
    4,
  );

  useEffect(() => {
    let task: { promise: Promise<void>; cancel: () => void } | null = null;
    let cancelled = false;
    void pdf.getPage(page).then((p) => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d');
      if (cancelled || !canvas || !context) return;
      const viewport = p.getViewport({ scale: BASE_SCALE * density });
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      task = p.render({ canvas, canvasContext: context, viewport });
      task.promise.catch(() => undefined);
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, page, density]);

  return <canvas ref={canvasRef} style={{ width, height }} className="block bg-white" />;
}
