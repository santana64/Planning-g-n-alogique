import type { TimelineSnapshot } from '@/server/timeline';

/**
 * Parents, children and partners of every row, from the links already sent.
 *
 * The timeline's links are the only relationships the client receives, and
 * they have already been filtered for privacy on the server: a link into a
 * protected person never leaves it. Deriving the family from them, rather
 * than asking for it separately, means the tooltip and the side panel can
 * never show a relative the drawing does not.
 */
export interface TimelineFamily {
  readonly parents: ReadonlyMap<number, readonly number[]>;
  readonly children: ReadonlyMap<number, readonly number[]>;
  readonly partners: ReadonlyMap<number, readonly number[]>;
}

export function familyOf(snapshot: Pick<TimelineSnapshot, 'links' | 'rows'>): TimelineFamily {
  const parents = new Map<number, number[]>();
  const children = new Map<number, number[]>();
  const partners = new Map<number, number[]>();

  const add = (map: Map<number, number[]>, key: number, value: number) => {
    const list = map.get(key);
    if (!list) map.set(key, [value]);
    else if (!list.includes(value)) list.push(value);
  };

  for (const link of snapshot.links) {
    if (link.kind === 'PARENT') {
      add(parents, link.toRow, link.fromRow);
      add(children, link.fromRow, link.toRow);
    } else {
      add(partners, link.fromRow, link.toRow);
      add(partners, link.toRow, link.fromRow);
    }
  }

  // Children in birth order, so "her children" reads as a family does.
  const birth = (row: number) => snapshot.rows[row]?.birthEarliestJdn ?? Number.POSITIVE_INFINITY;
  for (const list of children.values()) list.sort((a, b) => birth(a) - birth(b));
  // Mother first, then father, then anyone else: the order of a French
  // record ("fils de Jean et de Marie" is the other convention; either is
  // fine as long as it never changes between two hovers).
  const rank = (row: number) => {
    const sex = snapshot.rows[row]?.sex;
    return sex === 'FEMALE' ? 0 : sex === 'MALE' ? 1 : 2;
  };
  for (const list of parents.values()) list.sort((a, b) => rank(a) - rank(b));

  return { parents, children, partners };
}
