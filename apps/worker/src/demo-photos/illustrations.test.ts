import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { HEIGHT, WIDTH, demoIllustrations } from './illustrations';

describe('the demonstration illustrations', () => {
  const all = demoIllustrations();

  it('say what they are, in their title and their caption', () => {
    for (const illustration of all) {
      expect(illustration.title.startsWith('Illustration — ')).toBe(true);
      expect(illustration.description).toContain('ce n’est pas une photographie d’époque');
    }
  });

  it('have distinct keys and titles, the seed’s idempotency keys', () => {
    expect(new Set(all.map((i) => i.key)).size).toBe(all.length);
    expect(new Set(all.map((i) => i.title)).size).toBe(all.length);
  });

  it('place every figure inside the image, as a tag region must be', () => {
    for (const illustration of all) {
      expect(illustration.figures.length).toBeGreaterThan(0);
      for (const { region } of illustration.figures) {
        expect(region.x).toBeGreaterThanOrEqual(0);
        expect(region.y).toBeGreaterThanOrEqual(0);
        expect(region.width).toBeGreaterThan(0);
        expect(region.height).toBeGreaterThan(0);
        expect(region.x + region.width).toBeLessThanOrEqual(1.0001);
        expect(region.y + region.height).toBeLessThanOrEqual(1.0001);
      }
    }
  });

  it('draw no text, which would depend on the fonts installed', () => {
    for (const illustration of all) expect(illustration.svg).not.toMatch(/<text\b/);
  });

  it('render to an image of the declared size', async () => {
    const first = all[0];
    if (!first) throw new Error('no illustrations');
    const metadata = await sharp(Buffer.from(first.svg)).metadata();
    expect(metadata.width).toBe(WIDTH);
    expect(metadata.height).toBe(HEIGHT);
  });
});
