import { normalisePlaceName } from '../normalise';
import type { Database } from '../client';

/**
 * Resolving a place name to a place.
 *
 * Shared by every write that accepts a typed location, which is the point:
 * matching on the folded name is what stops "Tours" and "tours" becoming two
 * rows, and two rows for one town split a family across a map and across
 * every "who lived here" question ever asked afterwards.
 *
 * Deliberately permissive about what it creates. A place typed once with a
 * spelling nobody else uses is still a place the researcher meant, and
 * refusing it would mean refusing the event.
 */

export type PlaceTx = Pick<Database, 'place'>;

export async function resolvePlace(
  tx: PlaceTx,
  treeId: string,
  // Null is a cleared field, undefined an absent one. Both mean "no place",
  // and it is the caller's job to tell the difference where it matters.
  name: string | null | undefined,
): Promise<string | undefined> {
  if (!name) return undefined;
  const normalised = normalisePlaceName(name);

  const existing = await tx.place.findFirst({
    where: { treeId, normalisedName: normalised },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await tx.place.create({
    // LOW confidence because a name typed into a form has been geocoded by
    // nobody and verified against nothing. The map must be able to tell that
    // apart from a place resolved against a gazetteer.
    data: { treeId, name, normalisedName: normalised, type: 'OTHER', confidence: 'LOW' },
  });
  return created.id;
}
