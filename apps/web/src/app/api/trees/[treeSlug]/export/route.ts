import { NextResponse } from 'next/server';
import { can } from '@chronolignee/domain';
import { buildGedcomPlan, recordRevision } from '@chronolignee/db';
import { writeGedcom } from '@chronolignee/gedcom';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { getSession } from '@/lib/session';
import { resolveTreeAccess } from '@/server/access';

/**
 * The whole tree as a GEDCOM 7 file.
 *
 * For those allowed to take it away — owner and administrators — because the
 * file holds every living person the tree records, unredacted. Each export is
 * written to the history: a copy of living relatives' data leaving the
 * instance is exactly what a family asks about later.
 *
 * Linked with a plain anchor, never a prefetching one: fetching this is an
 * act, and a prefetch would record exports nobody asked for.
 */
export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ treeSlug: string }> },
): Promise<Response> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });

  const { treeSlug } = await params;
  const access = await resolveTreeAccess(treeSlug);
  // Not a member: the same answer as for a tree that does not exist.
  if (!access || access.role === null) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  if (!can(access.role, 'export')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const plan = await buildGedcomPlan(db, access.treeId);
  const file = writeGedcom(plan, { generator: 'CHRONOLIGNEE' });

  await recordRevision(db, {
    treeId: access.treeId,
    entityType: 'Tree',
    entityId: access.treeId,
    action: 'EXPORT',
    actorId: session.user.id,
    after: { format: 'GEDCOM 7', people: plan.people.length },
    summary: `Export GEDCOM : ${plan.people.length} personnes`,
  });
  logger.info(
    { event: 'tree.exported', treeId: access.treeId, people: plan.people.length },
    'tree exported',
  );

  const day = new Date().toISOString().slice(0, 10);
  return new Response(file, {
    headers: {
      // The GEDCOM 7 media type. The slug is [a-z0-9-] by construction, so it
      // is safe in the header as it stands.
      'Content-Type': 'text/vnd.familysearch.gedcom; charset=utf-8',
      'Content-Disposition': `attachment; filename="${access.treeSlug}-${day}.ged"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
