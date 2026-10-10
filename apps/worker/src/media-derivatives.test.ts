import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { PREVIEW_PX, THUMBNAIL_PX, runMediaDerivatives } from './media-derivatives';

/**
 * Derivatives, on real image bytes.
 *
 * The property that matters most is the one nobody sees: a phone photograph
 * carries the GPS position where it was taken, and none of it may survive
 * into what the archive shows.
 */

async function photograph(width: number, height: number, orientation?: number) {
  let image = sharp({
    create: { width, height, channels: 3, background: { r: 180, g: 140, b: 90 } },
  }).jpeg();
  if (orientation) {
    // An orientation tag, and a GPS position: what a phone writes.
    image = image
      .withMetadata({ orientation })
      .withExifMerge({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '47/1 23/1 0/1' } });
  }
  return new Uint8Array(await image.toBuffer());
}

function harness(original: Uint8Array) {
  const written = new Map<string, Uint8Array>();
  const recorded: unknown[] = [];
  return {
    written,
    recorded,
    deps: {
      read: async () => original,
      write: async (key: string, bytes: Uint8Array) => {
        written.set(key, bytes);
      },
      record: async (_mediaId: string, derivatives: unknown) => {
        recorded.push(derivatives);
      },
    },
  };
}

const payload = {
  treeId: '01900000-0000-7000-8000-000000000001',
  mediaId: '01900000-0000-7000-8000-000000000002',
  storageKey: 'media/01900000-0000-7000-8000-000000000001/abc.jpg',
};

describe('runMediaDerivatives', () => {
  it('writes a thumbnail and a preview, bounded on their long side, beside the original', async () => {
    const { deps, written, recorded } = harness(await photograph(4000, 3000));
    const result = await runMediaDerivatives(deps, payload);

    expect(result).toMatchObject({ width: 4000, height: 3000 });
    expect([...written.keys()].sort()).toEqual([
      'media/01900000-0000-7000-8000-000000000001/abc.preview.webp',
      'media/01900000-0000-7000-8000-000000000001/abc.thumb.webp',
    ]);
    const thumb = await sharp(
      written.get([...written.keys()].find((k) => k.includes('thumb'))!),
    ).metadata();
    expect(thumb.width).toBe(THUMBNAIL_PX);
    const preview = await sharp(
      written.get([...written.keys()].find((k) => k.includes('preview'))!),
    ).metadata();
    expect(preview.width).toBe(PREVIEW_PX);
    expect(recorded).toHaveLength(1);
  });

  it('never enlarges a small image', async () => {
    const { deps, written } = harness(await photograph(200, 100));
    await runMediaDerivatives(deps, payload);
    for (const bytes of written.values()) {
      expect((await sharp(bytes).metadata()).width).toBe(200);
    }
  });

  it('turns the image upright and keeps no EXIF, GPS included', async () => {
    // Orientation 6: the camera was held sideways; the stored pixels are 400x300.
    const original = await photograph(400, 300, 6);
    expect((await sharp(original).metadata()).exif).toBeDefined();
    const { deps, written } = harness(original);
    const result = await runMediaDerivatives(deps, payload);
    expect(result).toMatchObject({ width: 300, height: 400 });
    for (const bytes of written.values()) {
      const metadata = await sharp(bytes).metadata();
      expect(metadata.exif).toBeUndefined();
      // Portrait now: taller than wide, whatever the size it was bounded to.
      expect(metadata.height ?? 0).toBeGreaterThan(metadata.width ?? 0);
    }
  });
});
