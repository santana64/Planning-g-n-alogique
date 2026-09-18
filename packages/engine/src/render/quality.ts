/**
 * Graphical quality, decided rather than guessed.
 *
 * Four presets and an automatic choice. The automatic choice starts from what
 * can be known before the first frame — which backend is available, whether
 * the GPU is really a software rasteriser, how many pixels there are to fill
 * — and then watches the frames actually drawn, stepping down when they are
 * sustainedly slow. It never steps back up on its own: a picture that sharpens
 * and blurs as the load varies is worse than one that stays a notch lower.
 */

export const QUALITY_PRESETS = ['LOW', 'MEDIUM', 'HIGH', 'ULTRA'] as const;
export type QualityPreset = (typeof QUALITY_PRESETS)[number];
export type QualitySetting = 'AUTO' | QualityPreset;

export interface QualityProfile {
  /** Ceiling on the device pixel ratio the canvas renders at. */
  readonly pixelRatioCap: number;
  /** Chosen when the renderer is created; changing it means a new renderer. */
  readonly antialias: boolean;
  /** Size of a star's halo relative to its core. */
  readonly halo: number;
  /** How many names may be on screen at once. */
  readonly maxLabels: number;
}

export const QUALITY_PROFILES: Readonly<Record<QualityPreset, QualityProfile>> = {
  LOW: { pixelRatioCap: 1, antialias: false, halo: 2, maxLabels: 24 },
  MEDIUM: { pixelRatioCap: 1.5, antialias: true, halo: 2.6, maxLabels: 48 },
  HIGH: { pixelRatioCap: 2, antialias: true, halo: 3.2, maxLabels: 96 },
  ULTRA: { pixelRatioCap: 3, antialias: true, halo: 3.8, maxLabels: 160 },
};

export interface RenderCapabilities {
  readonly backend: 'webgpu' | 'webgl2';
  /**
   * A software rasteriser (SwiftShader, llvmpipe, WARP) presenting as a GPU,
   * or a WebGPU fallback adapter. Everything is drawn by the CPU.
   */
  readonly softwareRenderer: boolean;
  readonly devicePixelRatio: number;
  /** In CSS pixels. */
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}

/** Physical pixels above which even a WebGPU device is not asked for the top preset. */
const ULTRA_PIXEL_BUDGET = 8_000_000;

export function chooseAutoQuality(capabilities: RenderCapabilities): QualityPreset {
  if (capabilities.softwareRenderer) return 'LOW';

  // A phone, or a window the size of one: a small, often battery-powered GPU.
  if (Math.min(capabilities.viewportWidth, capabilities.viewportHeight) < 600) return 'MEDIUM';

  if (capabilities.backend === 'webgl2') return 'HIGH';

  const physicalPixels =
    capabilities.viewportWidth *
    capabilities.viewportHeight *
    Math.min(capabilities.devicePixelRatio, 3) ** 2;
  return physicalPixels > ULTRA_PIXEL_BUDGET ? 'HIGH' : 'ULTRA';
}

/** A renderer string that names a software rasteriser rather than a GPU. */
export function isSoftwareRendererName(name: string | null | undefined): boolean {
  if (!name) return false;
  return /swiftshader|llvmpipe|softpipe|software|microsoft basic render|\bwarp\b/i.test(name);
}

export interface FrameBudget {
  /** The frame time a preset has to hold. */
  readonly targetMs: number;
  /** How many recent frames the decision looks at. */
  readonly window: number;
}

/** Forty-five frames a second: below that, orbiting a scene visibly stutters. */
export const DEFAULT_FRAME_BUDGET: FrameBudget = { targetMs: 1000 / 45, window: 30 };

/**
 * The preset to use after these frames.
 *
 * The median, not the mean: one garbage collection pause is a spike, not a
 * slow device, and should not cost everyone a notch of sharpness.
 */
export function qualityAfterFrames(
  current: QualityPreset,
  recentFrameMs: readonly number[],
  budget: FrameBudget = DEFAULT_FRAME_BUDGET,
): QualityPreset {
  if (recentFrameMs.length < budget.window) return current;
  const window = [...recentFrameMs.slice(-budget.window)].sort((a, b) => a - b);
  const middle = Math.floor(window.length / 2);
  const median =
    window.length % 2 === 0
      ? ((window[middle - 1] as number) + (window[middle] as number)) / 2
      : (window[middle] as number);

  if (median <= budget.targetMs) return current;
  const index = QUALITY_PRESETS.indexOf(current);
  return index > 0 ? (QUALITY_PRESETS[index - 1] as QualityPreset) : current;
}

export function isQualitySetting(value: unknown): value is QualitySetting {
  return value === 'AUTO' || (QUALITY_PRESETS as readonly unknown[]).includes(value);
}
