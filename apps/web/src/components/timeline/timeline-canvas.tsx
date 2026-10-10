'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { ofNameIn } from '@/lib/french';
import { TemporalCamera, type CameraState, type DetailLevel } from '@chronolignee/engine';
import {
  AXIS_HEIGHT,
  HEADER_HEIGHT,
  renderTimeline,
  type TimelineColorMode,
  type TimelineTheme,
} from './render-timeline';
import { familyOf } from './family';
import { laneMarks, laneTracks, markAt } from './history-lane';
import { periodLabel } from './period';
import { swatchFor, usePrefersReducedMotion } from './preferences';
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

export interface TimelineCanvasProps {
  readonly snapshot: TimelineSnapshot;
  readonly selectedPersonId: string | null;
  readonly onSelect: (personId: string | null) => void;
  readonly onViewportChange?: (state: CameraState) => void;
  /** The temporal cursor, owned by the view so the counts and the drawing agree. */
  readonly cursor: { readonly jdn: number; readonly states: Uint8Array } | null;
  readonly colorMode: TimelineColorMode;
  /** The historical event chosen in the lane, owned by the view for its panel. */
  readonly selectedBandId: string | null;
  readonly onSelectBand: (bandId: string | null) => void;
}

/** Durations, in milliseconds. Short enough never to make anyone wait. */
const ENTRANCE_MS = 1100;
const FOCUS_MS = 650;
const PULSE_MS = 1600;
/** The birth ring pulses twice and stops: a pointer, not a screensaver. */
const PULSE_CYCLES = 2;

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
    sexFemale: token('--sex-female', 'oklch(0.665 0.14 350)'),
    sexMale: token('--sex-male', 'oklch(0.65 0.13 240)'),
    sexOther: token('--sex-other', 'oklch(0.72 0.11 300)'),
    sexUnknown: token('--sex-unknown', 'oklch(0.62 0.015 258)'),
    history: Object.fromEntries(
      [
        'WAR',
        'POLITICAL',
        'EPIDEMIC',
        'DISASTER',
        'MIGRATION',
        'ECONOMIC',
        'CULTURAL',
        'RELIGIOUS',
        'LEGAL',
        'OTHER',
      ].map((category) => [
        category,
        token(`--hist-${category.toLowerCase()}`, token('--accent-history', '#6d8bd0')),
      ]),
    ),
  };
}

export function TimelineCanvas({
  snapshot,
  selectedPersonId,
  onSelect,
  onViewportChange,
  cursor,
  colorMode,
  selectedBandId,
  onSelectBand,
}: TimelineCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<TemporalCamera | null>(null);
  const frameRef = useRef<number>(0);
  const themeRef = useRef<TimelineTheme | null>(null);

  const [size, setSize] = useState({ width: 0, height: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [hoveredBandId, setHoveredBandId] = useState<string | null>(null);
  const tracks = useMemo(() => laneTracks(snapshot.bands), [snapshot.bands]);
  const animationRef = useRef({ entrance: 0, focus: 1, pulse: 0, pulseElapsed: 0 });
  const reducedMotion = usePrefersReducedMotion();
  const format = useFormatter();
  const locale = useLocale();
  const t = useTranslations('timeline');
  const certainty = useTranslations('certainty');
  const [detailLevel, setDetailLevel] = useState<DetailLevel>('PERSON');

  const contentHeight = snapshot.rows.length * ROW_HEIGHT + HEADER_HEIGHT;

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
      interaction: {
        hoveredRow,
        selectedPersonId,
        relatedRows,
        cursor,
        hoveredBandId,
        selectedBandId,
      },
      colorMode,
      animation: animationRef.current,
    });

    setDetailLevel(result.detailLevel);
  }, [
    snapshot,
    size,
    scrollTop,
    hoveredRow,
    selectedPersonId,
    relatedRows,
    cursor,
    colorMode,
    hoveredBandId,
    selectedBandId,
  ]);

  /** The historical event under a point, when the point is in the lane. */
  const bandAtPoint = useCallback(
    (clientX: number, clientY: number): string | null => {
      const container = containerRef.current;
      const camera = cameraRef.current;
      if (!container || !camera) return null;
      const bounds = container.getBoundingClientRect();
      const y = clientY - bounds.top;
      if (y < AXIS_HEIGHT || y > HEADER_HEIGHT) return null;
      const marks = laneMarks(snapshot.bands, tracks, camera.viewport(), AXIS_HEIGHT);
      return markAt(marks, clientX - bounds.left, y)?.band.id ?? null;
    },
    [snapshot.bands, tracks],
  );

  const requestDraw = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(draw);
  }, [draw]);

  useEffect(() => {
    requestDraw();
    return () => cancelAnimationFrame(frameRef.current);
  }, [requestDraw]);

  // --- Animation ------------------------------------------------------------
  //
  // One loop, alive only while something moves. It advances the numbers the
  // renderer reads and stops itself: an idle timeline costs no frames.

  useEffect(() => {
    // A new selection draws its links again, from the parent down.
    animationRef.current.focus = selectedPersonId ? 0 : 1;
    animationRef.current.pulse = 0;
    animationRef.current.pulseElapsed = 0;
  }, [selectedPersonId]);

  useEffect(() => {
    if (size.width === 0) return;
    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const state = animationRef.current;
      const dt = Math.min(now - last, 64);
      last = now;

      if (reducedMotion) {
        state.entrance = 1;
        state.focus = 1;
        state.pulse = 0;
      } else {
        state.entrance = Math.min(state.entrance + dt / ENTRANCE_MS, 1);
        state.focus = Math.min(state.focus + dt / FOCUS_MS, 1);
        if (selectedPersonId && state.focus >= 1 && state.pulseElapsed < PULSE_MS * PULSE_CYCLES) {
          state.pulseElapsed += dt;
          state.pulse =
            state.pulseElapsed >= PULSE_MS * PULSE_CYCLES
              ? 0
              : (state.pulseElapsed % PULSE_MS) / PULSE_MS;
        }
      }
      draw();

      const moving =
        !reducedMotion &&
        (state.entrance < 1 ||
          state.focus < 1 ||
          (selectedPersonId !== null && state.pulseElapsed < PULSE_MS * PULSE_CYCLES));
      if (moving) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [draw, reducedMotion, selectedPersonId, size.width]);

  /** Parents and children by row, for the tooltip. */
  const family = useMemo(() => familyOf(snapshot), [snapshot]);

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
      const y = clientY - bounds.top - HEADER_HEIGHT + scrollTop;
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

    const band = bandAtPoint(event.clientX, event.clientY);
    if (band !== hoveredBandId) setHoveredBandId(band);
    const row = band ? null : rowAt(event.clientY);
    if (row !== hoveredRow) setHoveredRow(row);
    const bounds = containerRef.current?.getBoundingClientRect();
    if (bounds) setPointer({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);

    if (drag && !drag.moved) {
      // A click in the history lane chooses an event, never a person.
      const band = bandAtPoint(event.clientX, event.clientY);
      if (band) {
        onSelectBand(band === selectedBandId ? null : band);
        return;
      }
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
  const hoveredBand = hoveredBandId
    ? snapshot.bands.find((band) => band.id === hoveredBandId)
    : undefined;
  const history = useTranslations('timeline.history');

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        role="application"
        aria-label={t('canvasLabel', { tree: snapshot.treeName })}
        tabIndex={0}
        className="bg-surface-sunken h-full w-full cursor-grab touch-none overflow-hidden focus-visible:-outline-offset-2 active:cursor-grabbing"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => {
          setHoveredRow(null);
          setHoveredBandId(null);
          setPointer(null);
        }}
        onKeyDown={handleKeyDown}
      >
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          style={{ width: size.width, height: size.height, display: 'block' }}
        />
      </div>

      {hoveredBand ? (
        <div
          key={hoveredBand.id}
          className="timeline-tooltip border-border-default bg-surface-floating pointer-events-none absolute z-10 max-w-80 rounded-[var(--radius-md)] border px-3 py-2 shadow-[var(--shadow-mid)]"
          style={tooltipPosition(pointer, size)}
          role="status"
        >
          <p className="text-text-faint flex items-center gap-2 text-[11px] tracking-wide uppercase">
            <span
              aria-hidden="true"
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: `var(--hist-${hoveredBand.category.toLowerCase()})` }}
            />
            {history(`categories.${hoveredBand.category}`)}
          </p>
          <p className="font-editorial text-text-primary mt-0.5 text-sm">{hoveredBand.title}</p>
          <p className="text-text-muted text-xs tabular-nums">
            {periodLabel(hoveredBand.startJdn, hoveredBand.endJdn, format)}
          </p>
          {hoveredBand.summary ? (
            <p className="text-text-secondary mt-1 text-xs">{hoveredBand.summary}</p>
          ) : null}
          <p className="text-text-faint mt-1 text-[11px]">{history('clickHint')}</p>
        </div>
      ) : null}

      {hovered && (
        <div
          key={hovered.personId}
          className="timeline-tooltip border-border-default bg-surface-floating pointer-events-none absolute z-10 max-w-72 rounded-[var(--radius-md)] border px-3 py-2 shadow-[var(--shadow-mid)]"
          style={tooltipPosition(pointer, size)}
          role="status"
        >
          <p className="font-editorial text-text-primary flex items-center gap-2 text-sm">
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: swatchFor(hovered, colorMode) }}
            />
            {hovered.displayName}
          </p>
          <p className="text-text-muted mt-0.5 text-xs">
            {hovered.redacted
              ? t('nothingPublished')
              : t('lifespan', {
                  birth: hovered.birthLabel,
                  death: hovered.isLiving ? t('livingShort') : hovered.deathLabel,
                })}
          </p>
          {!hovered.redacted && hovered.endCertainty === 'INFERRED' && (
            <p className="text-text-faint mt-1 max-w-56 text-xs">
              {certainty('inferredExplanation')}
            </p>
          )}
          {!hovered.redacted && (family.parents.get(hovered.row)?.length ?? 0) > 0 && (
            <p className="text-text-secondary mt-1.5 text-xs">
              {t('childOf', {
                sex: hovered.sex,
                parents: format.list(
                  (family.parents.get(hovered.row) ?? []).map((row) =>
                    ofNameIn(locale, snapshot.rows[row]?.displayName ?? ''),
                  ),
                  { type: 'conjunction' },
                ),
              })}
            </p>
          )}
          {!hovered.redacted && (family.children.get(hovered.row)?.length ?? 0) > 0 && (
            <p className="text-text-faint mt-0.5 text-xs">
              {t('childrenCount', { count: family.children.get(hovered.row)?.length ?? 0 })}
            </p>
          )}
        </div>
      )}

      <p className="text-text-faint pointer-events-none absolute right-2 bottom-2 text-xs">
        {t('hint', {
          people: snapshot.rows.length,
          detail: t(`detail.${detailLevel}`),
        })}
      </p>
    </div>
  );
}

/**
 * The tooltip follows the pointer, offset so it never sits under it, and
 * flips to the other side near an edge instead of running off the canvas.
 */
function tooltipPosition(
  pointer: { x: number; y: number } | null,
  size: { width: number; height: number },
): React.CSSProperties {
  if (!pointer) return { top: 8, left: 8 };
  const offset = 16;
  const flipX = pointer.x > size.width - 300;
  const flipY = pointer.y > size.height - 140;
  return {
    left: flipX ? undefined : pointer.x + offset,
    right: flipX ? size.width - pointer.x + offset : undefined,
    top: flipY ? undefined : pointer.y + offset,
    bottom: flipY ? size.height - pointer.y + offset : undefined,
  };
}

export { ROW_HEIGHT };
