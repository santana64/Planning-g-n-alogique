'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TemporalCamera, type CameraState, type DetailLevel } from '@chronolignee/engine';
import { AXIS_HEIGHT, renderTimeline, type TimelineTheme } from './render-timeline';
import type { TimelineSnapshot } from '@/server/timeline';

/**
 * The genealogical Gantt.
 *
 * Canvas rather than DOM: a thousand lifespan bars with event markers is
 * thirty thousand elements, and no amount of virtualisation makes that
 * scrollable at sixty frames a second. The renderer is a pure function
 * (render-timeline.ts); this component owns only interaction and the loop.
 *
 * The canvas is `aria-hidden` and the same data is published as a real HTML
 * table beside it. A visualisation that exists only as pixels is unavailable
 * to a screen reader, and "genealogy, but only if you can see" is not a
 * product decision anyone should make by omission.
 */

const ROW_HEIGHT = 22;
const WHEEL_ZOOM_INTENSITY = 0.0016;
const KEYBOARD_PAN_PX = 80;

/** What the drawing shows at the current zoom, in the reader's words. */
const DETAIL_LABELS: Record<DetailLevel, string> = {
  CENTURY: 'vue par siècles',
  BRANCH: 'vue par branches',
  GENERATION: 'vue par générations',
  PERSON: 'une barre par vie',
  EVENT: 'noms et événements',
  DETAIL: 'tout le détail',
};

export interface TimelineCanvasProps {
  readonly snapshot: TimelineSnapshot;
  readonly selectedPersonId: string | null;
  readonly onSelect: (personId: string | null) => void;
  readonly onViewportChange?: (state: CameraState) => void;
  /** The temporal cursor, owned by the view so the counts and the drawing agree. */
  readonly cursor: { readonly jdn: number; readonly states: Uint8Array } | null;
}

function readTheme(element: HTMLElement): TimelineTheme {
  const styles = getComputedStyle(element);
  const token = (name: string, fallback: string): string =>
    styles.getPropertyValue(name).trim() || fallback;

  return {
    surface: token('--surface-sunken', '#12161f'),
    gridLine: token('--border-subtle', '#2a3040'),
    gridLineMajor: token('--border-default', '#3a4256'),
    textMuted: token('--text-muted', '#9aa0ad'),
    textPrimary: token('--text-primary', '#f2ede3'),
    accent: token('--accent-primary', '#d8a657'),
    linkColor: token('--border-strong', '#4c5468'),
    bandColor: token('--accent-history', '#6d8bd0'),
    fontSans: token('--font-sans', 'system-ui, sans-serif'),
    fontSerif: token('--font-serif', 'Georgia, serif'),
  };
}

export function TimelineCanvas({
  snapshot,
  selectedPersonId,
  onSelect,
  onViewportChange,
  cursor,
}: TimelineCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<TemporalCamera | null>(null);
  const frameRef = useRef<number>(0);
  const themeRef = useRef<TimelineTheme | null>(null);

  const [size, setSize] = useState({ width: 0, height: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const [detailLevel, setDetailLevel] = useState<DetailLevel>('PERSON');

  const contentHeight = snapshot.rows.length * ROW_HEIGHT + AXIS_HEIGHT;

  /**
   * Rows connected to the selection.
   *
   * Computed here rather than on the server because it changes on every click
   * and the answer is a set of row indices the client already has.
   */
  const relatedRows = useMemo(() => {
    const related = new Set<number>();
    if (!selectedPersonId) return related;

    const selectedRow = snapshot.rows.find((row) => row.personId === selectedPersonId);
    if (!selectedRow) return related;
    related.add(selectedRow.row);

    for (const link of snapshot.links) {
      if (link.fromRow === selectedRow.row) related.add(link.toRow);
      if (link.toRow === selectedRow.row) related.add(link.fromRow);
    }
    return related;
  }, [selectedPersonId, snapshot.rows, snapshot.links]);

  // --- Camera ---------------------------------------------------------------

  useEffect(() => {
    if (size.width === 0) return;

    if (!cameraRef.current) {
      const padding = Math.max((snapshot.latestJdn - snapshot.earliestJdn) * 0.04, 365);
      cameraRef.current = new TemporalCamera(
        {
          startJdn: snapshot.earliestJdn - padding,
          endJdn: snapshot.latestJdn + padding,
          widthPx: size.width,
        },
        {
          // The camera cannot wander outside the data by more than a
          // generation: panning into empty centuries is disorientation, not
          // freedom.
          minJdn: snapshot.earliestJdn - 36_525,
          maxJdn: snapshot.latestJdn + 36_525,
        },
      );
    } else {
      cameraRef.current.setWidth(size.width);
    }
  }, [size.width, snapshot.earliestJdn, snapshot.latestJdn]);

  // --- Render loop ----------------------------------------------------------

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const camera = cameraRef.current;
    const container = containerRef.current;
    if (!canvas || !camera || !container || size.width === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    themeRef.current ??= readTheme(container);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== size.width * dpr || canvas.height !== size.height * dpr) {
      canvas.width = size.width * dpr;
      canvas.height = size.height * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const result = renderTimeline(ctx, {
      snapshot,
      viewport: camera.viewport(),
      heightPx: size.height,
      scrollTopPx: scrollTop,
      rowHeightPx: ROW_HEIGHT,
      theme: themeRef.current,
      interaction: { hoveredRow, selectedPersonId, relatedRows, cursor },
    });

    setDetailLevel(result.detailLevel);
  }, [snapshot, size, scrollTop, hoveredRow, selectedPersonId, relatedRows, cursor]);

  const requestDraw = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(draw);
  }, [draw]);

  useEffect(() => {
    requestDraw();
    return () => cancelAnimationFrame(frameRef.current);
  }, [requestDraw]);

  // --- Sizing ---------------------------------------------------------------

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ width: Math.floor(width), height: Math.floor(height) });
      // The theme is re-read on resize because a container move can cross a
      // theme boundary (a dialog, a print stylesheet).
      themeRef.current = readTheme(container);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // --- Pointer --------------------------------------------------------------

  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const rowAt = useCallback(
    (clientY: number): number | null => {
      const container = containerRef.current;
      if (!container) return null;
      const bounds = container.getBoundingClientRect();
      const y = clientY - bounds.top - AXIS_HEIGHT + scrollTop;
      if (y < 0) return null;
      const row = Math.floor(y / ROW_HEIGHT);
      return row >= 0 && row < snapshot.rows.length ? row : null;
    },
    [scrollTop, snapshot.rows.length],
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, moved: false };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const camera = cameraRef.current;
    const drag = dragRef.current;

    if (drag && camera) {
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      // A few pixels of slop, so a click with a shaky hand is still a click
      // and not a one-pixel pan that swallows the selection.
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;

      camera.panByPixels(dx);
      setScrollTop((current) =>
        Math.min(Math.max(current - dy, 0), Math.max(contentHeight - size.height, 0)),
      );
      drag.x = event.clientX;
      drag.y = event.clientY;
      onViewportChange?.(camera.snapshot());
      requestDraw();
      return;
    }

    const row = rowAt(event.clientY);
    if (row !== hoveredRow) setHoveredRow(row);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);

    if (drag && !drag.moved) {
      const row = rowAt(event.clientY);
      const person = row !== null ? snapshot.rows[row] : undefined;
      onSelect(person && person.personId !== selectedPersonId ? person.personId : null);
    }
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Registered natively rather than through React so it can be non-passive:
    // a passive listener cannot preventDefault, and the page would scroll
    // underneath the zoom.
    const onWheel = (event: WheelEvent) => {
      const camera = cameraRef.current;
      if (!camera) return;

      if (event.ctrlKey || event.metaKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        event.preventDefault();
        camera.panByPixels(-event.deltaX);
      } else if (event.shiftKey) {
        event.preventDefault();
        const bounds = container.getBoundingClientRect();
        camera.zoomAt(event.clientX - bounds.left, Math.exp(event.deltaY * WHEEL_ZOOM_INTENSITY));
      } else {
        // Plain wheel scrolls the rows, which is what the gesture means
        // everywhere else. Zoom is shift-wheel, and the legend says so.
        event.preventDefault();
        setScrollTop((current) =>
          Math.min(Math.max(current + event.deltaY, 0), Math.max(contentHeight - size.height, 0)),
        );
      }
      onViewportChange?.(camera.snapshot());
      requestDraw();
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [contentHeight, size.height, requestDraw, onViewportChange]);

  // --- Keyboard -------------------------------------------------------------

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const camera = cameraRef.current;
    if (!camera) return;

    const step = event.shiftKey ? KEYBOARD_PAN_PX * 4 : KEYBOARD_PAN_PX;
    let handled = true;

    switch (event.key) {
      case 'ArrowLeft':
        camera.panByPixels(step);
        break;
      case 'ArrowRight':
        camera.panByPixels(-step);
        break;
      case 'ArrowUp':
        setScrollTop((c) => Math.max(c - ROW_HEIGHT * 3, 0));
        break;
      case 'ArrowDown':
        setScrollTop((c) => Math.min(c + ROW_HEIGHT * 3, Math.max(contentHeight - size.height, 0)));
        break;
      case '+':
      case '=':
        camera.zoomBy(0.7);
        break;
      case '-':
      case '_':
        camera.zoomBy(1 / 0.7);
        break;
      case 'Home':
        camera.fitRange(snapshot.earliestJdn, snapshot.latestJdn);
        setScrollTop(0);
        break;
      default:
        handled = false;
    }

    if (handled) {
      event.preventDefault();
      onViewportChange?.(camera.snapshot());
      requestDraw();
    }
  };

  const hovered = hoveredRow !== null ? snapshot.rows[hoveredRow] : undefined;

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        role="application"
        aria-label={`Chronologie de ${snapshot.treeName}. Flèches pour se déplacer, plus et moins pour zoomer, Origine pour tout afficher.`}
        tabIndex={0}
        className="bg-surface-sunken h-full w-full cursor-grab touch-none overflow-hidden focus-visible:-outline-offset-2 active:cursor-grabbing"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => setHoveredRow(null)}
        onKeyDown={handleKeyDown}
      >
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          style={{ width: size.width, height: size.height, display: 'block' }}
        />
      </div>

      {hovered && (
        <div
          className="border-border-default bg-surface-floating pointer-events-none absolute top-2 left-2 rounded-[var(--radius-md)] border px-3 py-2 shadow-[var(--shadow-mid)]"
          role="status"
        >
          <p className="font-editorial text-text-primary text-sm">{hovered.displayName}</p>
          <p className="text-text-muted mt-0.5 text-xs">
            {hovered.redacted
              ? 'Rien n’est publié à son sujet.'
              : `${hovered.birthLabel} — ${hovered.isLiving ? 'vivant' : hovered.deathLabel}`}
          </p>
          {!hovered.redacted && hovered.endCertainty === 'INFERRED' && (
            <p className="text-text-faint mt-1 max-w-56 text-xs">
              Aucun décès enregistré : cette limite vient de la durée de vie maximale, pas
              d&apos;une source.
            </p>
          )}
        </div>
      )}

      <p className="text-text-faint pointer-events-none absolute right-2 bottom-2 text-xs">
        {snapshot.rows.length} personnes · molette : défiler · maj+molette : zoomer ·{' '}
        {DETAIL_LABELS[detailLevel]}
      </p>
    </div>
  );
}

export { ROW_HEIGHT };
