import { describe, expect, it } from 'vitest';
import {
  QUALITY_PROFILES,
  chooseAutoQuality,
  isQualitySetting,
  isSoftwareRendererName,
  qualityAfterFrames,
  type RenderCapabilities,
} from './quality';

const DESKTOP: RenderCapabilities = {
  backend: 'webgpu',
  softwareRenderer: false,
  devicePixelRatio: 2,
  viewportWidth: 1280,
  viewportHeight: 800,
};

describe('automatic quality', () => {
  it('gives a desktop WebGPU device the top preset', () => {
    expect(chooseAutoQuality(DESKTOP)).toBe('ULTRA');
  });

  it('asks less of the WebGL 2 fallback', () => {
    expect(chooseAutoQuality({ ...DESKTOP, backend: 'webgl2' })).toBe('HIGH');
  });

  it('asks the least of a software rasteriser, whatever it claims', () => {
    expect(chooseAutoQuality({ ...DESKTOP, softwareRenderer: true })).toBe('LOW');
  });

  it('treats a phone-sized viewport as a phone', () => {
    expect(
      chooseAutoQuality({
        ...DESKTOP,
        viewportWidth: 390,
        viewportHeight: 844,
        devicePixelRatio: 3,
      }),
    ).toBe('MEDIUM');
  });

  it('steps down on a very large display rather than filling it at full sharpness', () => {
    expect(
      chooseAutoQuality({
        ...DESKTOP,
        viewportWidth: 2560,
        viewportHeight: 1440,
        devicePixelRatio: 2,
      }),
    ).toBe('HIGH');
  });
});

describe('software renderer names', () => {
  it.each([
    'Google SwiftShader',
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)',
    'llvmpipe (LLVM 15.0.7, 256 bits)',
    'Microsoft Basic Render Driver',
  ])('recognises %s', (name) => {
    expect(isSoftwareRendererName(name)).toBe(true);
  });

  it.each(['ANGLE (NVIDIA, NVIDIA GeForce RTX 4070)', 'Apple M3', null, ''])(
    'does not mistake %s for one',
    (name) => {
      expect(isSoftwareRendererName(name)).toBe(false);
    },
  );
});

describe('watching the frames', () => {
  const slow = Array.from({ length: 30 }, () => 40);
  const fast = Array.from({ length: 30 }, () => 12);

  it('steps down one notch when frames are sustainedly slow', () => {
    expect(qualityAfterFrames('ULTRA', slow)).toBe('HIGH');
    expect(qualityAfterFrames('MEDIUM', slow)).toBe('LOW');
  });

  it('holds when the frames keep up', () => {
    expect(qualityAfterFrames('ULTRA', fast)).toBe('ULTRA');
  });

  it('ignores a pause that is a spike, not a slow device', () => {
    const spiky = [...fast];
    spiky[10] = 400;
    spiky[20] = 250;
    expect(qualityAfterFrames('HIGH', spiky)).toBe('HIGH');
  });

  it('waits for enough frames before judging', () => {
    expect(qualityAfterFrames('HIGH', slow.slice(0, 10))).toBe('HIGH');
  });

  it('has nowhere lower to go from the bottom', () => {
    expect(qualityAfterFrames('LOW', slow)).toBe('LOW');
  });
});

describe('profiles', () => {
  it('only ever get cheaper towards the bottom', () => {
    const order = ['LOW', 'MEDIUM', 'HIGH', 'ULTRA'] as const;
    for (let index = 1; index < order.length; index += 1) {
      const lower = QUALITY_PROFILES[order[index - 1] as (typeof order)[number]];
      const higher = QUALITY_PROFILES[order[index] as (typeof order)[number]];
      expect(lower.pixelRatioCap).toBeLessThanOrEqual(higher.pixelRatioCap);
      expect(lower.maxLabels).toBeLessThanOrEqual(higher.maxLabels);
      expect(lower.halo).toBeLessThanOrEqual(higher.halo);
    }
  });

  it('recognises a stored setting, and nothing else', () => {
    expect(isQualitySetting('AUTO')).toBe(true);
    expect(isQualitySetting('HIGH')).toBe(true);
    expect(isQualitySetting('high')).toBe(false);
    expect(isQualitySetting(null)).toBe(false);
  });
});
