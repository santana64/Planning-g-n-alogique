import 'server-only';
import { loadGenealogyGraph } from '@chronolignee/db';
import type { GenealogyGraph } from '@chronolignee/genealogy';
import { db } from '@/lib/db';

/**
 * The whole tree as a graph, kept between requests.
 *
 * Every view of a tree starts from it — timeline, ancestry, descent, fan,
 * constellation, story, the audit on a record page — and building it means
 * reading every person with their events and resolving every lifespan: 0.56 s
 * at 20 000 people (docs/PERFORMANCE.md), on each request, for a result that
 * only changes when someone edits the tree.
 *
 * Keyed by the tree's revision, which every write increments in the same
 * transaction, so a cached graph is never served after an edit: the check
 * costs one indexed read. And by the day, because "today" enters the
 * projection — who may still be alive, where an open lifespan ends.
 *
 * The promise is cached, not the value, so concurrent requests for a tree
 * being loaded share the one load. Per process: several instances each keep
 * their own, and each checks the revision itself.
 */

const MAX_TREES = 8;

interface Entry {
  readonly key: string;
  readonly graph: Promise<GenealogyGraph>;
}

const cache = new Map<string, Entry>();

export async function treeGraph(treeId: string, todayJdn: number): Promise<GenealogyGraph> {
  const tree = await db.tree.findUnique({ where: { id: treeId }, select: { revision: true } });
  const key = `${tree?.revision ?? -1}:${todayJdn}`;

  const hit = cache.get(treeId);
  if (hit?.key === key) {
    // Most recently used goes last; eviction takes from the front.
    cache.delete(treeId);
    cache.set(treeId, hit);
    return hit.graph;
  }

  const entry: Entry = { key, graph: loadGenealogyGraph(db, treeId, todayJdn) };
  cache.delete(treeId);
  cache.set(treeId, entry);
  while (cache.size > MAX_TREES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  // A failed load is not remembered: the next request tries again.
  entry.graph.catch(() => {
    if (cache.get(treeId) === entry) cache.delete(treeId);
  });
  return entry.graph;
}
