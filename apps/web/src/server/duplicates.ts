import 'server-only';
import { cache } from 'react';
import { can, privacySubjectFromColumns, type PersonPrivacy } from '@chronolignee/domain';
import { openDuplicates } from '@chronolignee/db';
import { db } from '@/lib/db';
import { isUuid } from '@/lib/ids';
import { lifespanYears } from '@/lib/lifespan';
import { duplicateScanState, type ScanState } from '@/lib/queue';
import { isHiddenFrom, resolveTreeAccess } from './access';
import { loadPersonDetail, type PersonDetail } from './people';
import type { TreeAccess } from './access';

/**
 * The duplicate review.
 *
 * A list of pairs the scan found, and for each pair a page that puts the two
 * records side by side. Nothing here merges anything: the list proposes, the
 * comparison informs, and the merge is a separate, deliberate act
 * ([GENEALOGY_RULES.md](../../../../docs/GENEALOGY_RULES.md)).
 *
 * A pair naming someone this reader may not see is not shown at all. A
 * restricted person is hidden from the tree's editors, and a comparison
 * screen would hand over the name, the dates and the parents in one page.
 */

export interface DuplicateSignalView {
  readonly name: string;
  readonly value: number;
}

export interface DuplicatePairView {
  readonly id: string;
  readonly score: number;
  readonly signals: readonly DuplicateSignalView[];
  readonly left: { readonly id: string; readonly displayName: string; readonly lifespan: string };
  readonly right: { readonly id: string; readonly displayName: string; readonly lifespan: string };
}

export interface DuplicateReview {
  readonly access: TreeAccess;
  readonly canMerge: boolean;
  readonly scanState: ScanState;
  readonly pairs: readonly DuplicatePairView[];
}

/** What the privacy rule reads, and what the list shows beside a name. */
const PERSON_COLUMNS = {
  id: true,
  displayName: true,
  livingStatus: true,
  privacy: true,
  lifespanEarliestJdn: true,
  lifespanLatestJdn: true,
  lifespanLatestInferred: true,
} as const;

type PersonRow = {
  id: string;
  displayName: string;
  livingStatus: 'LIVING' | 'DECEASED' | 'UNKNOWN';
  privacy: PersonPrivacy;
  lifespanEarliestJdn: number | null;
  lifespanLatestJdn: number | null;
  lifespanLatestInferred: boolean;
};

export const loadDuplicateReview = cache(
  async (treeSlug: string): Promise<DuplicateReview | null> => {
    const access = await resolveTreeAccess(treeSlug);
    if (!access || !can(access.role, 'contribute')) return null;

    const candidates = await openDuplicates(db, access.treeId);
    const ids = new Set(candidates.flatMap((row) => [row.left.id, row.right.id]));
    const rows = await db.person.findMany({
      where: { id: { in: [...ids] }, treeId: access.treeId, deletedAt: null },
      select: PERSON_COLUMNS,
    });
    const byId = new Map(rows.map((row) => [row.id, row as PersonRow]));

    const visible = (id: string): PersonRow | null => {
      const row = byId.get(id);
      if (!row) return null;
      return isHiddenFrom(privacySubjectFromColumns(row), access) ? null : row;
    };

    const pairs: DuplicatePairView[] = [];
    for (const candidate of candidates) {
      const left = visible(candidate.left.id);
      const right = visible(candidate.right.id);
      if (!left || !right) continue;
      pairs.push({
        id: candidate.id,
        score: candidate.score,
        signals: signalsOf(candidate.explanation),
        left: { id: left.id, displayName: left.displayName, lifespan: lifespanYears(left) },
        right: { id: right.id, displayName: right.displayName, lifespan: lifespanYears(right) },
      });
    }

    return {
      access,
      canMerge: can(access.role, 'delete'),
      scanState: await duplicateScanState(access.treeId).catch(() => 'idle' as ScanState),
      pairs,
    };
  },
);

function signalsOf(explanation: unknown): DuplicateSignalView[] {
  if (typeof explanation !== 'object' || explanation === null) return [];
  const signals = (explanation as { signals?: unknown }).signals;
  if (!Array.isArray(signals)) return [];
  return signals.flatMap((signal) => {
    if (typeof signal !== 'object' || signal === null) return [];
    const { name, value } = signal as { name?: unknown; value?: unknown };
    return typeof name === 'string' && typeof value === 'number' ? [{ name, value }] : [];
  });
}

export interface DuplicateComparison {
  readonly access: TreeAccess;
  readonly candidateId: string;
  readonly score: number;
  readonly signals: readonly DuplicateSignalView[];
  readonly left: PersonDetail;
  readonly right: PersonDetail;
  readonly canMerge: boolean;
}

/** Two records, side by side, as their own pages show them. */
export async function loadDuplicateComparison(
  treeSlug: string,
  candidateId: string,
): Promise<DuplicateComparison | null> {
  const access = await resolveTreeAccess(treeSlug);
  if (!access || !can(access.role, 'contribute') || !isUuid(candidateId)) return null;

  const candidate = await db.duplicateCandidate.findFirst({
    where: { id: candidateId, treeId: access.treeId, status: 'OPEN' },
    select: { id: true, score: true, explanation: true, leftId: true, rightId: true },
  });
  if (!candidate) return null;

  const [left, right] = await Promise.all([
    loadPersonDetail(treeSlug, candidate.leftId),
    loadPersonDetail(treeSlug, candidate.rightId),
  ]);
  // `redacted` means this reader may not see the person: a comparison would
  // publish exactly what the protection hides.
  if (!left || !right || left.redacted || right.redacted) return null;

  return {
    access,
    candidateId: candidate.id,
    score: candidate.score,
    signals: signalsOf(candidate.explanation),
    left,
    right,
    canMerge: can(access.role, 'delete'),
  };
}
