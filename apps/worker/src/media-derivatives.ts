import sharp from 'sharp';
import { buildDerivedKey } from '@chronolignee/storage';
import type { MediaDerivativesPayload } from '@chronolignee/jobs';

/**
 * A photograph's thumbnail and preview.
 *
 * The original is kept exactly as uploaded — it is the archival object, and
 * its checksum proves it. What the screens show are two derivatives:
 *
 *  - a thumbnail, 320 px on its long side, for galleries and portraits;
 *  - a preview, 2048 px, for the viewer, so a 60-megapixel scan is not sent
 *    to a phone to be looked at on six inches of glass.
 *
 * Both are rotated by the EXIF orientation and then carry **no metadata**:
 * sharp drops EXIF unless asked to keep it, and that is relied on here. A
 * phone photograph's EXIF holds the GPS position where it was taken — very
 * often a relative's home — and a family archive must not publish it in
 * every image it shows.
 *
 * Limits: decompression is capped (sharp's pixel limit), so a crafted
 * image that inflates to gigapixels fails here, in the worker, instead of
 * taking memory from anything else.
 */

export const THUMBNAIL_PX = 320;
export const PREVIEW_PX = 2048;
/** About 268 megapixels: a large museum scan, not a decompression bomb. */
const PIXEL_LIMIT = 268_402_689;

export interface DerivativeDeps {
  readonly read: (key: string) => Promise<Uint8Array>;
  readonly write: (key: string, bytes: Uint8Array, contentType: string) => Promise<void>;
  readonly record: (
    mediaId: string,
    derivatives: {
      thumbnailStorageKey: string;
      previewStorageKey: string;
      width: number;
      height: number;
    },
  ) => Promise<void>;
}

export interface DerivativeResult {
  readonly width: number;
  readonly height: number;
  readonly thumbnailBytes: number;
  readonly previewBytes: number;
}

async function render(source: Uint8Array, size: number, quality: number): Promise<Uint8Array> {
  const buffer = await sharp(source, { limitInputPixels: PIXEL_LIMIT })
    .rotate()
    .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
    .webp({ quality })
    .toBuffer();
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

export async function runMediaDerivatives(
  deps: DerivativeDeps,
  payload: MediaDerivativesPayload,
): Promise<DerivativeResult> {
  const original = await deps.read(payload.storageKey);

  // Dimensions after the EXIF rotation, which is how the image is seen.
  const metadata = await sharp(original, { limitInputPixels: PIXEL_LIMIT }).metadata();
  const rotated = (metadata.orientation ?? 1) >= 5;
  const width = (rotated ? metadata.height : metadata.width) ?? 0;
  const height = (rotated ? metadata.width : metadata.height) ?? 0;

  const [thumbnail, preview] = await Promise.all([
    render(original, THUMBNAIL_PX, 78),
    render(original, PREVIEW_PX, 86),
  ]);

  const thumbnailStorageKey = buildDerivedKey(payload.storageKey, 'thumb', 'webp');
  const previewStorageKey = buildDerivedKey(payload.storageKey, 'preview', 'webp');
  await deps.write(thumbnailStorageKey, thumbnail, 'image/webp');
  await deps.write(previewStorageKey, preview, 'image/webp');
  await deps.record(payload.mediaId, { thumbnailStorageKey, previewStorageKey, width, height });

  return { width, height, thumbnailBytes: thumbnail.byteLength, previewBytes: preview.byteLength };
}
