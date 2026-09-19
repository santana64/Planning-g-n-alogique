'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  QUALITY_PRESETS,
  QUALITY_PROFILES,
  chooseAutoQuality,
  isQualitySetting,
  isSoftwareRendererName,
  placeLabels,
  qualityAfterFrames,
  type QualityPreset,
  type QualitySetting,
} from '@chronolignee/engine';
import { Link, useRouter } from '@/i18n/navigation';
import type { ConstellationLink, ConstellationStar } from '@/server/constellation';
import {
  SKY,
  coverageSentence,
  hopSentence,
  labelPriority,
  type ConstellationMode,
} from './appearance';
import type { ConstellationScene, ProjectedPoint } from './scene';

/**
 * The constellation, on screen.
 *
 * The renderer is loaded only here, only in the browser, and only once the
 * browser has said what it can do: WebGPU when there is a real adapter, WebGL
 * 2 otherwise, and when there is neither, a sentence saying so above the list
 * that carries the same people — never an empty black rectangle.
 *
 * Names are DOM text laid over the canvas, placed each frame by priority so
 * that the focus person is always named and a distant cousin only when there
 * is room. They are hidden from assistive technology: the list below the
 * constellation is the accessible version, with the same people and links.
 */

const QUALITY_KEY = 'chronolignee.constellation.quality';
const PICK_RADIUS_PX = 14;
const CLICK_TOLERANCE_PX = 5;

const QUALITY_LABELS: Record<QualitySetting, string> = {
  AUTO: 'Automatique',
  LOW: 'Basse',
  MEDIUM: 'Moyenne',
  HIGH: 'Haute',
  ULTRA: 'Maximale',
};

type Status = 'probing' | 'ready' | 'unsupported' | 'failed';

interface Probe {
  readonly webgpu: boolean;
  readonly webgl2: boolean;
  readonly software: boolean;
}

interface GpuAdapterLike {
  readonly info?: { readonly isFallbackAdapter?: boolean; readonly description?: string };
}

async function probeGraphics(): Promise<Probe> {
  try {
    const gpu = (navigator as { gpu?: { requestAdapter(): Promise<GpuAdapterLike | null> } }).gpu;
    const adapter = gpu ? await gpu.requestAdapter() : null;
    if (adapter) {
      return {
        webgpu: true,
        webgl2: true,
        software:
          adapter.info?.isFallbackAdapter === true ||
          isSoftwareRendererName(adapter.info?.description),
      };
    }
  } catch {
    // An adapter request can throw where WebGPU is half-implemented; that is
    // the same answer as no adapter.
  }

  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) return { webgpu: false, webgl2: false, software: false };
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const name = String(
    debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
  );
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return { webgpu: false, webgl2: true, software: isSoftwareRendererName(name) };
}

function readStoredQuality(): QualitySetting {
  try {
    const stored = window.localStorage.getItem(QUALITY_KEY);
    return isQualitySetting(stored) ? stored : 'AUTO';
  } catch {
    return 'AUTO';
  }
}

function storeQuality(setting: QualitySetting): void {
  try {
    window.localStorage.setItem(QUALITY_KEY, setting);
  } catch {
    // A private window or blocked storage: the choice lasts for this visit.
  }
}

export interface ConstellationViewProps {
  readonly treeSlug: string;
  readonly stars: readonly ConstellationStar[];
  readonly links: readonly ConstellationLink[];
  readonly focusId: string | null;
  readonly presentYear: number;
  readonly hops: number;
  readonly depthAvailable: boolean;
}

export function ConstellationView({
  treeSlug,
  stars,
  links,
  focusId,
  presentYear,
  hops,
  depthAvailable,
}: ConstellationViewProps) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelLayerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ConstellationScene | null>(null);
  const projectedRef = useRef<ProjectedPoint[]>([]);
  const frameTimesRef = useRef<number[]>([]);
  const hoveredRef = useRef<string | null>(null);
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const probeRef = useRef<Probe | null>(null);

  const [status, setStatus] = useState<Status>('probing');
  const [backend, setBackend] = useState<'webgpu' | 'webgl2' | null>(null);
  const [mode, setMode] = useState<ConstellationMode>('plan');
  const [setting, setSetting] = useState<QualitySetting>('AUTO');
  const [preset, setPreset] = useState<QualityPreset>('HIGH');
  const [width, setWidth] = useState(0);
  // By id, not by index: a change of focus reorders the stars, and an index
  // kept across it would name somebody else.
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Everything the per-frame callback reads, kept current without
  // re-subscribing it on every render.
  const live = useRef({ stars, focusId, mode, preset, setting });
  useLayoutEffect(() => {
    live.current = { stars, focusId, mode, preset, setting };
  });

  const drawLabels = useCallback(() => {
    const scene = sceneRef.current;
    const layer = labelLayerRef.current;
    const root = rootRef.current;
    if (!scene || !layer || !root) return;

    const {
      stars: current,
      focusId: focus,
      mode: currentMode,
      preset: currentPreset,
    } = live.current;
    const width = root.clientWidth;
    const height = root.clientHeight;
    const projected = scene.projectStars();
    projectedRef.current = projected;

    const candidates = [];
    for (let index = 0; index < current.length; index += 1) {
      const star = current[index] as ConstellationStar;
      const point = projected[index];
      if (!point?.visible || star.hidden) continue;
      if (currentMode === 'depth' && star.yearsBefore === null) continue;
      candidates.push({
        item: index,
        x: point.x,
        y: point.y + 9,
        width: star.name.length * 6.6 + 10,
        height: 18,
        priority: labelPriority(star, star.id === focus, star.id === hoveredRef.current),
      });
    }
    const kept = placeLabels(candidates, {
      maxLabels: QUALITY_PROFILES[currentPreset].maxLabels,
      viewportWidth: width,
      viewportHeight: height,
    });

    const guides = scene.projectGuides().filter((guide) => guide.visible);
    const needed = kept.length + guides.length;
    while (layer.childElementCount < needed) {
      const span = document.createElement('span');
      span.className = 'constellation-label';
      layer.appendChild(span);
    }
    const spans = layer.children;
    kept.forEach((index, position) => {
      const star = current[index] as ConstellationStar;
      const point = projected[index] as ProjectedPoint;
      const span = spans[position] as HTMLSpanElement;
      span.textContent = star.name;
      span.dataset['kind'] = star.id === focus ? 'focus' : 'person';
      span.style.display = 'block';
      span.style.transform = `translate(${Math.round(point.x)}px, ${Math.round(point.y + 9)}px) translateX(-50%)`;
    });
    guides.forEach((guide, offset) => {
      const span = spans[kept.length + offset] as HTMLSpanElement;
      span.textContent = String(guide.year);
      span.dataset['kind'] = 'guide';
      span.style.display = 'block';
      span.style.transform = `translate(${Math.round(guide.x)}px, ${Math.round(guide.y)}px) translate(-110%, -50%)`;
    });
    for (let position = needed; position < spans.length; position += 1) {
      (spans[position] as HTMLSpanElement).style.display = 'none';
    }
  }, []);

  // Create the renderer once, after asking the browser what it can do.
  useEffect(() => {
    let cancelled = false;
    let scene: ConstellationScene | null = null;
    let observer: ResizeObserver | null = null;

    (async () => {
      const probe = await probeGraphics();
      if (cancelled) return;
      probeRef.current = probe;
      const stored = readStoredQuality();
      setSetting(stored);
      if (!probe.webgpu && !probe.webgl2) {
        setStatus('unsupported');
        return;
      }
      const root = rootRef.current;
      const canvas = canvasRef.current;
      if (!root || !canvas) return;

      const initial =
        stored === 'AUTO'
          ? chooseAutoQuality({
              backend: probe.webgpu ? 'webgpu' : 'webgl2',
              softwareRenderer: probe.software,
              devicePixelRatio: window.devicePixelRatio || 1,
              viewportWidth: root.clientWidth,
              viewportHeight: root.clientHeight,
            })
          : stored;

      try {
        const { createConstellationScene } = await import('./scene');
        const created = await createConstellationScene(canvas, {
          preset: initial,
          forceWebGL: !probe.webgpu,
          reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        });
        if (cancelled) {
          created.dispose();
          return;
        }
        scene = created;
        sceneRef.current = created;
        created.resize(root.clientWidth, root.clientHeight);
        created.onFrame((frameMs) => {
          root.dataset['frames'] = String(created.frames);
          root.dataset['settled'] = String(created.settled);
          drawLabels();
          if (frameMs === null || live.current.setting !== 'AUTO') return;
          const times = frameTimesRef.current;
          times.push(frameMs);
          if (times.length > 60) times.shift();
          const next = qualityAfterFrames(live.current.preset, times);
          if (next !== live.current.preset) {
            frameTimesRef.current = [];
            setPreset(next);
          }
        });
        observer = new ResizeObserver(() => {
          created.resize(root.clientWidth, root.clientHeight);
          setWidth(root.clientWidth);
        });
        observer.observe(root);
        setWidth(root.clientWidth);
        setPreset(initial);
        setBackend(created.backend);
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('failed');
      }
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
      scene?.dispose();
      sceneRef.current = null;
    };
  }, [drawLabels]);

  useEffect(() => {
    if (status === 'ready') sceneRef.current?.setData(stars, links, focusId, presentYear);
  }, [status, stars, links, focusId, presentYear]);

  useEffect(() => {
    if (status === 'ready') sceneRef.current?.setMode(mode);
  }, [status, mode]);

  useEffect(() => {
    if (status === 'ready') sceneRef.current?.setQuality(preset);
  }, [status, preset]);

  function nearestStar(clientX: number, clientY: number): number | null {
    const root = rootRef.current;
    if (!root) return null;
    const box = root.getBoundingClientRect();
    const x = clientX - box.left;
    const y = clientY - box.top;
    let best: number | null = null;
    let bestDistance = PICK_RADIUS_PX;
    projectedRef.current.forEach((point, index) => {
      if (!point.visible) return;
      const star = stars[index];
      if (!star || (mode === 'depth' && star.yearsBefore === null)) return;
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    return best;
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.buttons !== 0) return;
    const index = nearestStar(event.clientX, event.clientY);
    const star = index === null ? undefined : stars[index];
    const nextId = star?.id ?? null;
    if (nextId === hoveredRef.current) return;
    hoveredRef.current = nextId;
    const point = index === null ? undefined : projectedRef.current[index];
    setHover(star && point ? { id: star.id, x: point.x, y: point.y } : null);
    drawLabels();
  }

  function clearHover() {
    hoveredRef.current = null;
    setHover(null);
  }

  function onPointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    const down = pointerDownRef.current;
    pointerDownRef.current = null;
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > CLICK_TOLERANCE_PX) {
      return;
    }
    const index = nearestStar(event.clientX, event.clientY);
    setSelectedId(index === null ? null : (stars[index]?.id ?? null));
    clearHover();
  }

  function recentre(personId: string) {
    setSelectedId(null);
    clearHover();
    router.push(focusHref(personId), { scroll: false });
  }

  function chooseQuality(next: QualitySetting) {
    setSetting(next);
    storeQuality(next);
    frameTimesRef.current = [];
    const root = rootRef.current;
    if (next !== 'AUTO') {
      setPreset(next);
    } else if (root && backend) {
      setPreset(
        chooseAutoQuality({
          backend,
          softwareRenderer: probeRef.current?.software ?? false,
          devicePixelRatio: window.devicePixelRatio || 1,
          viewportWidth: root.clientWidth,
          viewportHeight: root.clientHeight,
        }),
      );
    }
  }

  const focusHref = (personId: string) =>
    `/app/${treeSlug}/constellation?focus=${personId}&liens=${hops}`;
  const hoveredStar = hover ? stars.find((star) => star.id === hover.id) : undefined;
  const selectedStar = selectedId ? stars.find((star) => star.id === selectedId) : undefined;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {depthAvailable ? (
          <div role="group" aria-label="Disposition" className="flex">
            {(['plan', 'depth'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={mode === option}
                disabled={status !== 'ready'}
                onClick={() => setMode(option)}
                className={`border-border-default border px-3 py-1 text-sm first:rounded-l-[var(--radius-md)] last:rounded-r-[var(--radius-md)] ${
                  mode === option
                    ? 'bg-accent text-accent-contrast border-accent'
                    : 'text-text-secondary hover:text-text-primary'
                } disabled:opacity-50`}
              >
                {option === 'plan' ? 'Plan' : 'Profondeur'}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => sceneRef.current?.zoom(0.8)}
            disabled={status !== 'ready'}
            aria-label="Rapprocher"
            className="border-border-default text-text-secondary hover:text-text-primary rounded-[var(--radius-md)] border px-2.5 py-1 text-sm disabled:opacity-50"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => sceneRef.current?.zoom(1.25)}
            disabled={status !== 'ready'}
            aria-label="Éloigner"
            className="border-border-default text-text-secondary hover:text-text-primary rounded-[var(--radius-md)] border px-2.5 py-1 text-sm disabled:opacity-50"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => sceneRef.current?.resetView()}
            disabled={status !== 'ready'}
            className="border-border-default text-text-secondary hover:text-text-primary rounded-[var(--radius-md)] border px-3 py-1 text-sm disabled:opacity-50"
          >
            Vue d’ensemble
          </button>
        </div>
        <label className="text-text-muted ml-auto flex items-center gap-2 text-xs">
          Qualité
          <select
            value={setting}
            onChange={(event) => chooseQuality(event.target.value as QualitySetting)}
            className="border-border-default bg-surface-1 text-text-primary rounded-[var(--radius-sm)] border px-2 py-1 text-xs"
          >
            {(['AUTO', ...QUALITY_PRESETS] as const).map((option) => (
              <option key={option} value={option}>
                {option === 'AUTO' && status === 'ready'
                  ? `${QUALITY_LABELS.AUTO} (${QUALITY_LABELS[preset].toLowerCase()})`
                  : QUALITY_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div
        ref={rootRef}
        data-renderer={status === 'ready' ? (backend ?? 'probing') : status}
        data-quality={preset}
        data-mode={mode}
        data-frames="0"
        data-settled="false"
        className="relative h-[70vh] min-h-[420px] w-full overflow-hidden rounded-[var(--radius-lg)]"
        style={{ backgroundColor: SKY.background }}
      >
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className={`absolute inset-0 h-full w-full touch-none ${hover ? 'cursor-pointer' : 'cursor-grab'}`}
          onPointerDown={(event) => {
            pointerDownRef.current = { x: event.clientX, y: event.clientY };
          }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={clearHover}
        />
        <div
          ref={labelLayerRef}
          aria-hidden="true"
          className="constellation-labels pointer-events-none absolute inset-0"
        />

        {status === 'probing' ? (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-[#a9b0c0]">
            Préparation de la constellation…
          </p>
        ) : null}
        {status === 'unsupported' || status === 'failed' ? (
          <div className="absolute inset-0 flex items-center justify-center p-8">
            <p className="max-w-md text-center text-sm text-[#e9e4d8]">
              {status === 'unsupported'
                ? 'Ce navigateur ne dispose ni de WebGPU ni de WebGL 2 : la constellation ne peut pas être dessinée ici.'
                : 'La constellation n’a pas pu être dessinée sur cet appareil.'}{' '}
              La liste ci-dessous contient les mêmes personnes et les mêmes liens.
            </p>
          </div>
        ) : null}

        {hoveredStar && hover && !selectedStar ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-10 max-w-64 rounded-[var(--radius-md)] border border-white/10 bg-[#141a2e]/95 px-3 py-2 text-xs text-[#e9e4d8] shadow-lg"
            style={{ left: Math.max(8, Math.min(hover.x + 14, width - 264)), top: hover.y + 14 }}
          >
            <p className="font-medium">{hoveredStar.name}</p>
            {hoveredStar.hidden ? (
              <p className="text-[#a9b0c0]">Rien n’est publié à son sujet.</p>
            ) : (
              <>
                <p className="text-[#a9b0c0]">{hoveredStar.lifeLabel}</p>
                <p className="text-[#a9b0c0]">
                  {hopSentence(hoveredStar.hop)} · {coverageSentence(hoveredStar)}
                </p>
              </>
            )}
          </div>
        ) : null}

        {selectedStar ? (
          <div className="absolute bottom-3 left-3 z-10 flex max-w-sm flex-col gap-2 rounded-[var(--radius-md)] border border-white/10 bg-[#141a2e]/95 p-4 text-sm text-[#e9e4d8] shadow-lg">
            <div className="flex items-start justify-between gap-4">
              <p className="font-medium">{selectedStar.name}</p>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                aria-label="Fermer"
                className="text-[#a9b0c0] hover:text-white"
              >
                ×
              </button>
            </div>
            {selectedStar.hidden ? (
              <p className="text-xs text-[#a9b0c0]">Rien n’est publié à son sujet.</p>
            ) : (
              <>
                <p className="text-xs text-[#a9b0c0]">
                  {selectedStar.lifeLabel} · {hopSentence(selectedStar.hop)} ·{' '}
                  {coverageSentence(selectedStar)}
                </p>
                <div className="flex gap-3 text-xs">
                  <Link
                    href={`/app/${treeSlug}/personnes/${selectedStar.id}`}
                    className="text-[#f0b35a] hover:underline"
                  >
                    Voir la fiche
                  </Link>
                  {selectedStar.id !== focusId ? (
                    <button
                      type="button"
                      onClick={() => recentre(selectedStar.id)}
                      className="text-[#f0b35a] hover:underline"
                    >
                      Centrer ici
                    </button>
                  ) : null}
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>

      <p className="text-text-faint text-xs">
        {status === 'ready'
          ? `Rendu ${backend === 'webgpu' ? 'WebGPU' : 'WebGL 2 (repli)'} · glisser pour tourner, molette pour s’approcher, clic sur une étoile pour la sélectionner.`
          : ' '}
      </p>
    </div>
  );
}
