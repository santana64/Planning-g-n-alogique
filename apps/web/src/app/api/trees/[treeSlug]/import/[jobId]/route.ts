import { NextResponse } from 'next/server';
import { commitImport, importProgress } from '@/server/gedcom-import';
import { getSession } from '@/lib/session';

/**
 * One analysed import: POST queues its write, GET says where it stands.
 *
 * The write runs in the worker, so POST answers 202 as soon as the job is on
 * the queue, and the page asks GET until the job says it is done or why it
 * is not.
 */
export const runtime = 'nodejs';

const ERROR_STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  ALREADY_COMMITTED: 409,
  IN_PROGRESS: 409,
  QUEUE_UNAVAILABLE: 503,
};

type Params = { params: Promise<{ treeSlug: string; jobId: string }> };

export async function POST(_request: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });

  const { treeSlug, jobId } = await params;
  const result = await commitImport(treeSlug, jobId, session.user.id);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: ERROR_STATUS[result.error] ?? 400 },
    );
  }
  return NextResponse.json({ state: 'QUEUED' }, { status: 202 });
}

export async function GET(_request: Request, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });

  const { treeSlug, jobId } = await params;
  const result = await importProgress(treeSlug, jobId);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: ERROR_STATUS[result.error] ?? 400 },
    );
  }
  return NextResponse.json(result.progress, { headers: { 'cache-control': 'no-store' } });
}
