import { NextResponse } from 'next/server';
import { can } from '@chronolignee/domain';
import { buildGedcomPlan, recordRevision } from '@chronolignee/db';
import { writeGedcomChunks } from '@chronolignee/gedcom';
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
 *
 * Streamed: the file goes out record by record, in batches of about 64 KB,
 * so a large tree's export is never held whole as text or as bytes. The
 * tree's rows are still read in one pass before the first byte — the plan
 * resolves families and cross-references across the whole tree.
 */
export const runtime = 'nodejs';

/** Characters per streamed batch: about 64 KB of mostly ASCII text. */
const BATCH_CHARS = 64 * 1024;

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
  const chunks = writeGedcomChunks(plan, { generator: 'CHRONOLIGNEE' });
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      let batch = '';
      while (batch.length < BATCH_CHARS) {
        const next = chunks.next();
        if (next.done) {
          if (batch) controller.enqueue(encoder.encode(batch));
          controller.close();
          return;
        }
        batch += next.value;
      }
      controller.enqueue(encoder.encode(batch));
    },
    cancel() {
      // The download was abandoned: stop writing a file nobody will read.
      void chunks.return(undefined);
    },
  });

  return new Response(body, {
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
