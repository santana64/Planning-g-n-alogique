import 'server-only';
import { cache } from 'react';
import { jdnToGregorian } from '@chronolignee/domain';
import { layoutRiver, type RiverLayout } from '@chronolignee/engine';
import { loadTimeline } from './timeline';

/**
 * The river, for one reader.
 *
 * Built from the timeline's snapshot, which has already decided what this
 * reader may see: a protected relative still widens their branch's stream —
 * they lived — but is never named, and a branch whose founder is protected
 * carries no name either.
 */

export interface RiverBranch {
  readonly branchKey: string;
  /** The person the branch begins with, when this reader may see them. */
  readonly founderId: string | null;
  readonly founderName: string | null;
}

export interface RiverView {
  readonly treeName: string;
  readonly layout: RiverLayout;
  readonly branches: Readonly<Record<string, RiverBranch>>;
  readonly todayYear: number;
}

const yearOf = (jdn: number | null) => (jdn === null ? null : jdnToGregorian(jdn).year);

export const loadRiver = cache(async (treeSlug: string): Promise<RiverView | null> => {
  const snapshot = await loadTimeline(treeSlug);
  if (!snapshot) return null;

  const rows = snapshot.rows;
  const byPerson = new Map(rows.map((row) => [row.personId, row]));
  const parentOf = new Map<string, string | null>();
  const branches: Record<string, RiverBranch> = {};

  for (const key of new Set(rows.map((row) => row.branchKey))) {
    const founder = byPerson.get(key);
    // The branch a fork's child left is the branch of their parent.
    const link = founder
      ? snapshot.links.find(
          (candidate) =>
            candidate.kind === 'PARENT' &&
            candidate.toRow === founder.row &&
            rows[candidate.fromRow]?.branchKey !== key,
        )
      : undefined;
    parentOf.set(key, link ? (rows[link.fromRow]?.branchKey ?? null) : null);
    branches[key] = {
      branchKey: key,
      founderId: founder && !founder.redacted ? founder.personId : null,
      founderName: founder && !founder.redacted ? founder.displayName : null,
    };
  }

  const layout = layoutRiver({
    rows: rows.map((row) => ({
      personId: row.personId,
      branchKey: row.branchKey,
      earliestYear: yearOf(row.earliestJdn),
      latestYear: yearOf(row.latestJdn),
    })),
    parentOf,
  });

  return {
    treeName: snapshot.treeName,
    layout,
    branches,
    todayYear: jdnToGregorian(snapshot.todayJdn).year,
  };
});
