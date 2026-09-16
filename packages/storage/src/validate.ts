import { fileTypeFromBuffer } from 'file-type';

/**
 * Upload validation.
 *
 * The client's declared MIME type is a suggestion from an untrusted source.
 * What matters is what the bytes actually are, so every check here reads the
 * file's own magic numbers and compares them against an allowlist.
 *
 * An allowlist, not a blocklist: a blocklist is a list of the attacks someone
 * thought of, and an archive application accepts files from the internet and
 * stores them for decades.
 */

export type UploadCategory = 'image' | 'document' | 'audio' | 'video' | 'gedcom';

export interface AllowedType {
  readonly mime: string;
  readonly extension: string;
  readonly category: UploadCategory;
}

/**
 * Everything the product accepts.
 *
 * SVG is deliberately absent. It is an image to a user and a script host to a
 * browser, and serving one from our origin would be stored cross-site
 * scripting with extra steps.
 */
export const ALLOWED_TYPES: readonly AllowedType[] = [
  { mime: 'image/jpeg', extension: 'jpg', category: 'image' },
  { mime: 'image/png', extension: 'png', category: 'image' },
  { mime: 'image/webp', extension: 'webp', category: 'image' },
  { mime: 'image/avif', extension: 'avif', category: 'image' },
  { mime: 'image/tiff', extension: 'tiff', category: 'image' },
  { mime: 'application/pdf', extension: 'pdf', category: 'document' },
  { mime: 'audio/mpeg', extension: 'mp3', category: 'audio' },
  { mime: 'audio/ogg', extension: 'ogg', category: 'audio' },
  { mime: 'audio/wav', extension: 'wav', category: 'audio' },
  { mime: 'video/mp4', extension: 'mp4', category: 'video' },
  { mime: 'video/webm', extension: 'webm', category: 'video' },
];

const ALLOWED_BY_MIME = new Map(ALLOWED_TYPES.map((type) => [type.mime, type]));

export type ValidationFailure =
  | 'TOO_LARGE'
  | 'EMPTY'
  | 'UNRECOGNISED_TYPE'
  | 'DISALLOWED_TYPE'
  | 'DECLARED_TYPE_MISMATCH'
  | 'NOT_TEXT';

export interface ValidationSuccess {
  readonly ok: true;
  readonly mime: string;
  readonly extension: string;
  readonly category: UploadCategory;
}

export interface ValidationError {
  readonly ok: false;
  readonly reason: ValidationFailure;
  /** What the bytes actually were, when we could tell. */
  readonly detectedMime: string | undefined;
}

export type ValidationResult = ValidationSuccess | ValidationError;

export interface ValidateOptions {
  readonly maxBytes: number;
  /** What the client said it was. Compared, never trusted. */
  readonly declaredMime?: string | undefined;
}

export async function validateUpload(
  bytes: Uint8Array,
  options: ValidateOptions,
): Promise<ValidationResult> {
  if (bytes.byteLength === 0) {
    return { ok: false, reason: 'EMPTY', detectedMime: undefined };
  }
  if (bytes.byteLength > options.maxBytes) {
    return { ok: false, reason: 'TOO_LARGE', detectedMime: undefined };
  }

  const detected = await fileTypeFromBuffer(bytes);
  if (!detected) {
    return { ok: false, reason: 'UNRECOGNISED_TYPE', detectedMime: undefined };
  }

  const allowed = ALLOWED_BY_MIME.get(detected.mime);
  if (!allowed) {
    return { ok: false, reason: 'DISALLOWED_TYPE', detectedMime: detected.mime };
  }

  // A mismatch between the declaration and the bytes is not fatal on its own —
  // browsers guess badly, especially for TIFF and WebP — but it is worth
  // refusing when the client claimed something from a different category,
  // which is the shape of a deliberate attempt rather than a browser quirk.
  if (options.declaredMime) {
    const declared = ALLOWED_BY_MIME.get(options.declaredMime);
    if (declared && declared.category !== allowed.category) {
      return { ok: false, reason: 'DECLARED_TYPE_MISMATCH', detectedMime: detected.mime };
    }
  }

  return { ok: true, mime: allowed.mime, extension: allowed.extension, category: allowed.category };
}

/**
 * GEDCOM validation, which cannot use magic numbers.
 *
 * A GEDCOM file is plain text with no signature, so `file-type` returns
 * nothing for it. It is identified by its own first line instead — every
 * conforming file begins `0 HEAD` — which is both a type check and a useful
 * early rejection of a file the user picked by mistake.
 */
export function validateGedcom(bytes: Uint8Array, maxBytes: number): ValidationResult {
  if (bytes.byteLength === 0) return { ok: false, reason: 'EMPTY', detectedMime: undefined };
  if (bytes.byteLength > maxBytes) {
    return { ok: false, reason: 'TOO_LARGE', detectedMime: undefined };
  }

  // Enough to see the header without decoding a 40 MB file twice.
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 512));
  const withoutBom = head.charCodeAt(0) === 0xfeff ? head.slice(1) : head;

  if (!/^\s*0\s+HEAD\b/m.test(withoutBom)) {
    return { ok: false, reason: 'NOT_TEXT', detectedMime: undefined };
  }

  return {
    ok: true,
    mime: 'text/vnd.familysearch.gedcom',
    extension: 'ged',
    category: 'gedcom',
  };
}

/**
 * Guard against decompression bombs in image metadata.
 *
 * A 40 KB PNG can declare a 60 000 x 60 000 canvas, and the resize that
 * follows allocates fourteen gigabytes. The dimensions are checked before any
 * image library is handed the file.
 */
export function imageDimensionsAcceptable(
  width: number,
  height: number,
  maxPixels: number,
): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
  if (width <= 0 || height <= 0) return false;
  return width * height <= maxPixels;
}
