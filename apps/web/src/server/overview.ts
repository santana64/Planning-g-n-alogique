import 'server-only';
import { cache } from 'react';
import { can } from '@chronolignee/domain';
import { db } from '@/lib/db';
import { loadTreeHistory, type HistoryLine } from './history';
import { loadResearchDesk } from './research';
import { loadTreeFigures, type TreeFigures } from './statistics';

/**
 * A tree at a glance: its extent, its shape, and what is waiting for
 * someone.
 *
 * Each "waiting" count is shown only to the role that can act on it: pending
 * machine proposals and suspected duplicates to editors, anomalies and open
 * leads and recent changes to members. A visitor reading a public tree sees
 * the figures and the ways in, nothing about the work.
 */

export interface TreeOverview extends TreeFigures {
  readonly pending: {
    readonly proposals: number | null;
    readonly duplicates: number | null;
    readonly anomalies: number | null;
    readonly openLeads: number | null;
    readonly unsourced: number | null;
  };
  readonly recent: readonly HistoryLine[];
}

export const loadTreeOverview = cache(async (treeSlug: string): Promise<TreeOverview | null> => {
  const figures = await loadTreeFigures(treeSlug);
  if (!figures) return null;
  const { access } = figures;
  const member = access.role !== null;
  const editor = can(access.role, 'contribute');

  const [proposals, duplicates, desk, history] = await Promise.all([
    editor ? db.aiProposal.count({ where: { treeId: access.treeId, status: 'PENDING' } }) : null,
    editor
      ? db.duplicateCandidate.count({ where: { treeId: access.treeId, status: 'OPEN' } })
      : null,
    member ? loadResearchDesk(treeSlug) : null,
    member ? loadTreeHistory(treeSlug, null) : null,
  ]);

  return {
    ...figures,
    pending: {
      proposals,
      duplicates,
      anomalies: desk ? desk.findings.filter((f) => f.severity !== 'INFO').length : null,
      openLeads: desk
        ? desk.tasks.filter((task) => task.status !== 'RESOLVED' && task.status !== 'ABANDONED')
            .length
        : null,
      unsourced: desk ? desk.unsourcedTotal : null,
    },
    recent: history ? history.lines.slice(0, 6) : [],
  };
});
