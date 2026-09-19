import { NextResponse } from 'next/server';
import { commitImport } from '@/server/gedcom-import';
import { getSession } from '@/lib/session';

/** Commit a previously analysed import into the tree. */
export const runtime = 'nodejs';

const ERROR_STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  ALREADY_COMMITTED: 409,
  FILE_MISSING: 410,
  UNSUPPORTED_ENCODING: 415,
};

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ treeSlug: string; jobId: string }> },
) {
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
  return NextResponse.json(result.summary);
}
