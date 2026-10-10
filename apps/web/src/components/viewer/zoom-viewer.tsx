'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';

/**
 * A stage for reading a scan.
 *
 * Parish registers are read at 300 % with the eyes ten centimetres from the
 * screen, so the gestures are the ones a reader expects: the wheel zooms
 * where the pointer is, a drag moves the page, two fingers pinch, the
 * keyboard does all of it (+ − 0 1 R F and the arrows). Zooming by button
 * glides; zooming by gesture follows the hand.
 *
 * The content is laid out at its natural size and transformed as a whole, so
 * whatever is drawn over it — the regions of a photograph's tags — scales
 * with it for free. `useViewer()` gives an overlay the mapping from screen to
 * content coordinates.
 */

interface Transform {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
  readonly rotation: 0 | 90 | 180 | 270;
}

interface ViewerApi {
  readonly scale: number;
  readonly rotation: Transform['rotation'];
  /** Screen point → content point, or null when rotated (tagging needs upright). */
  toContent: (clientX: number, clientY: number) => { x: number; y: number } | null;
}

const ViewerContext = createContext<ViewerApi | null>(null);

export function useViewer(): ViewerApi | null {
  return useContext(ViewerContext);
}

const MIN_SCALE = 0.05;
const MAX_SCALE = 12;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function ZoomViewer({
  width,
  height,
  label,
  children,
  overlay,
  panEnabled = true,
  toolbar,
}: {
  /** Natural size of the content, in CSS pixels at scale 1. */
  width: number;
  height: number;
  label: string;
  children: ReactNode;
  /** Drawn in content coordinates, above the content. */
  overlay?: ReactNode;
  /** Off while something else owns the pointer (drawing a tag). */
  panEnabled?: boolean;
  /** Extra controls, placed with the zoom buttons. */
  toolbar?: ReactNode;
}) {
  const t = useTranslations('viewer');
  const stageRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<Transform>({ scale: 1, x: 0, y: 0, rotation: 0 });
  const [gliding, setGliding] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; scale: number } | null>(null);

  const stageSize = () => {
    const rect = stageRef.current?.getBoundingClientRect();
    return {
      w: rect?.width ?? 1,
      h: rect?.height ?? 1,
      left: rect?.left ?? 0,
      top: rect?.top ?? 0,
    };
  };

  /** Fit the whole content in the stage, centred, with a margin. */
  const fit = useCallback(
    (rotation: Transform['rotation'] = 0, glide = false) => {
      const { w, h } = stageSize();
      const sideways = rotation === 90 || rotation === 270;
      const cw = sideways ? height : width;
      const ch = sideways ? width : height;
      const scale = clamp(Math.min(w / cw, h / ch) * 0.94, MIN_SCALE, MAX_SCALE);
      setGliding(glide);
      setView({ scale, x: (w - width * scale) / 2, y: (h - height * scale) / 2, rotation });
    },
    [width, height],
  );

  // Fitted from the observer, which reports the stage's size once on
  // observing it (before the first paint) and again on every resize — so
  // the content is never shown at a size nobody chose.
  const [ready, setReady] = useState(false);
  const rotationRef = useRef<Transform['rotation']>(0);
  useEffect(() => {
    rotationRef.current = view.rotation;
  }, [view.rotation]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(() => {
      fit(rotationRef.current);
      setReady(true);
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [fit]);

  /** Zoom by a factor around a stage point (the pointer, or the centre). */
  const zoomAt = useCallback((factor: number, px?: number, py?: number, glide = false) => {
    const { w, h } = stageSize();
    const cx = px ?? w / 2;
    const cy = py ?? h / 2;
    setGliding(glide);
    setView((current) => {
      const scale = clamp(current.scale * factor, MIN_SCALE, MAX_SCALE);
      const ratio = scale / current.scale;
      return {
        ...current,
        scale,
        x: cx - (cx - current.x) * ratio,
        y: cy - (cy - current.y) * ratio,
      };
    });
  }, []);

  const actualSize = () => {
    const { w, h } = stageSize();
    setGliding(true);
    setView((current) => ({ ...current, scale: 1, x: (w - width) / 2, y: (h - height) / 2 }));
  };

  const rotate = () => fit(((view.rotation + 90) % 360) as Transform['rotation'], true);

  // --- Wheel: zoom where the pointer is ------------------------------------
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX - rect.left, event.clientY - rect.top);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // --- Pointer: drag to pan, two fingers to pinch -------------------------
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!panEnabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const [a, b] = [...pointers.current.values()];
    if (a && b) pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous || !panEnabled) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    setGliding(false);

    const [a, b] = [...pointers.current.values()];
    if (a && b && pinch.current) {
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const { left, top } = stageSize();
      const target = clamp(
        (pinch.current.scale * distance) / pinch.current.distance,
        MIN_SCALE,
        MAX_SCALE,
      );
      zoomAt(target / view.scale, (a.x + b.x) / 2 - left, (a.y + b.y) / 2 - top);
      return;
    }
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  // --- Keyboard -------------------------------------------------------------
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 160 : 60;
    const keys: Record<string, () => void> = {
      '+': () => zoomAt(1.25, undefined, undefined, true),
      '=': () => zoomAt(1.25, undefined, undefined, true),
      '-': () => zoomAt(0.8, undefined, undefined, true),
      '0': () => fit(view.rotation, true),
      '1': actualSize,
      r: rotate,
      R: rotate,
      f: () => void toggleFullscreen(),
      F: () => void toggleFullscreen(),
      ArrowLeft: () => setView((v) => ({ ...v, x: v.x + step })),
      ArrowRight: () => setView((v) => ({ ...v, x: v.x - step })),
      ArrowUp: () => setView((v) => ({ ...v, y: v.y + step })),
      ArrowDown: () => setView((v) => ({ ...v, y: v.y - step })),
    };
    const action = keys[event.key];
    if (!action) return;
    event.preventDefault();
    if (event.key.startsWith('Arrow')) setGliding(true);
    action();
  };

  // --- Fullscreen -----------------------------------------------------------
  const frameRef = useRef<HTMLDivElement>(null);
  const toggleFullscreen = async () => {
    const frame = frameRef.current;
    if (!frame) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await frame.requestFullscreen?.();
  };
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === frameRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const api: ViewerApi = {
    scale: view.scale,
    rotation: view.rotation,
    toContent: (clientX, clientY) => {
      if (view.rotation !== 0) return null;
      const { left, top } = stageSize();
      return {
        x: (clientX - left - view.x) / view.scale,
        y: (clientY - top - view.y) / view.scale,
      };
    },
  };

  const transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale}) translate(${width / 2}px, ${height / 2}px) rotate(${view.rotation}deg) translate(${-width / 2}px, ${-height / 2}px)`;

  return (
    <ViewerContext.Provider value={api}>
      <div
        ref={frameRef}
        className="viewer-frame bg-surface-sunken relative flex h-full min-h-[24rem] flex-col overflow-hidden rounded-[var(--radius-lg)]"
      >
        <div
          ref={stageRef}
          role="application"
          aria-label={t('stage', { label })}
          aria-roledescription={t('roledescription')}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
          onDoubleClick={(event) => {
            if (!panEnabled) return;
            const rect = event.currentTarget.getBoundingClientRect();
            zoomAt(2, event.clientX - rect.left, event.clientY - rect.top, true);
          }}
          className={`relative min-h-0 flex-1 touch-none select-none focus-visible:-outline-offset-2 ${
            panEnabled ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'
          }`}
        >
          <div
            className="absolute top-0 left-0 origin-top-left will-change-transform"
            style={{
              width,
              height,
              transform,
              visibility: ready ? 'visible' : 'hidden',
              transition: gliding ? 'transform 220ms cubic-bezier(0.2, 0.7, 0.2, 1)' : 'none',
            }}
          >
            {children}
            {overlay ? <div className="absolute inset-0">{overlay}</div> : null}
          </div>
        </div>

        <div className="border-border-subtle bg-surface-1/90 flex flex-wrap items-center gap-1 border-t px-2 py-1.5 backdrop-blur">
          <ToolButton label={t('zoomOut')} onClick={() => zoomAt(0.8, undefined, undefined, true)}>
            −
          </ToolButton>
          <span
            className="text-text-muted w-14 text-center text-xs tabular-nums"
            aria-live="polite"
          >
            {Math.round(view.scale * 100)} %
          </span>
          <ToolButton label={t('zoomIn')} onClick={() => zoomAt(1.25, undefined, undefined, true)}>
            +
          </ToolButton>
          <ToolButton label={t('fit')} onClick={() => fit(view.rotation, true)}>
            ⤢
          </ToolButton>
          <ToolButton label={t('actual')} onClick={actualSize}>
            1:1
          </ToolButton>
          <ToolButton label={t('rotate')} onClick={rotate}>
            ⟳
          </ToolButton>
          <ToolButton
            label={fullscreen ? t('exitFullscreen') : t('fullscreen')}
            onClick={() => void toggleFullscreen()}
          >
            {fullscreen ? '⤡' : '⛶'}
          </ToolButton>
          {toolbar ? <span className="ml-auto flex items-center gap-1">{toolbar}</span> : null}
        </div>
        <p className="sr-only">{t('keys')}</p>
      </div>
    </ViewerContext.Provider>
  );
}

export function ToolButton({
  label,
  onClick,
  children,
  pressed,
  disabled,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  pressed?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`text-text-secondary hover:bg-surface-3 hover:text-text-primary min-w-8 rounded-[var(--radius-md)] px-2 py-1 text-sm transition-colors duration-[var(--duration-fast)] disabled:cursor-default disabled:opacity-40 ${
        pressed ? 'bg-accent/15 text-text-primary ring-accent/50 ring-1' : ''
      }`}
    >
      {children}
    </button>
  );
}
