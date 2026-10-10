import 'server-only';
import { NextResponse } from 'next/server';
import { objectStore } from '@/lib/storage';

/**
 * A private object, sent from the application's own origin.
 *
 * Used where the browser must read the bytes itself — an image on a canvas
 * with regions drawn over it, a PDF drawn page by page — so the page's
 * content-security policy can stay at `'self'` instead of being opened to
 * the object store. The caller has already authorised the reader.
 *
 * The response is treated as hostile content: its own policy forbids it to
 * run anything (a PDF opened directly cannot execute script), it is never
 * sniffed into another type, and only the reader's browser may cache it,
 * briefly.
 */
export async function sendPrivateObject(
  key: string,
  contentType: string,
  options: { readonly maxAgeSeconds?: number } = {},
): Promise<NextResponse> {
  let bytes: Uint8Array;
  try {
    bytes = await objectStore.get(key);
  } catch {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  // A copy into a plain ArrayBuffer: the body type does not accept a view
  // over a possibly shared buffer.
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return new NextResponse(body.buffer, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(bytes.byteLength),
      'Content-Disposition': 'inline',
      'Cache-Control': `private, max-age=${options.maxAgeSeconds ?? 300}`,
      'X-Content-Type-Options': 'nosniff',
      // Same as FILE_POLICY in next.config.ts, which sets it on these routes.
      'Content-Security-Policy':
        "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  });
}
