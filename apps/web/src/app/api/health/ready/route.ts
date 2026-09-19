import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { objectStore } from '@/lib/storage';

/**
 * Readiness: can this instance serve a page that reads a tree? The database
 * and the object store both answer, each within a few seconds.
 *
 * Unauthenticated, so it says which dependency is down and nothing more — no
 * host, no error message, no version.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TIMEOUT_MS = 3_000;

async function probe(check: () => Promise<unknown>): Promise<'ok' | 'fail'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      check(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS);
      }),
    ]);
    return 'ok';
  } catch {
    return 'fail';
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(): Promise<NextResponse> {
  const [database, storage] = await Promise.all([
    probe(() => db.$queryRaw`SELECT 1`),
    probe(() => objectStore.ready()),
  ]);
  const ready = database === 'ok' && storage === 'ok';
  return NextResponse.json(
    { status: ready ? 'ok' : 'unavailable', checks: { database, storage } },
    { status: ready ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
