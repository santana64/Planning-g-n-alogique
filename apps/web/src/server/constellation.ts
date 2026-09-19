import 'server-only';
import { cache } from 'react';
import { dateToJdn, formatGenealogicalDate, jdnToGregorian } from '@chronolignee/domain';
import { loadEvidenceCoverage, loadGenealogyGraph } from '@chronolignee/db';
import { layoutConstellation, type ConstellationLinkKind } from '@chronolignee/engine';
import { isParentType, isPartnerType, type GenealogyGraph } from '@chronolignee/genealogy';
import { db } from '@/lib/db';
import { REDACTED_LABEL, hiddenInGraph, resolveTreeAccess, type TreeAccess } from './access';

/**
 * The constellation, ready to draw.
 *
 * Everything the client receives is decided here, after redaction. A person
 * the viewer may not see arrives as an anonymous point: no name, no dates, no
 * evidence count — and no position in depth, because in the depth mode a
 * point's distance from the viewer is its birth year. Their place on the flat
 * rings is decided without their birth date either, since the order of
 * siblings around a ring would otherwise disclose who was born first.
 */

const DAYS_PER_YEAR = 365.2425;

export interface ConstellationStar {
  readonly id: string;
  readonly name: string;
  readonly hidden: boolean;
  readonly hop: number;
  readonly generation: number;
  readonly x: number;
  readonly y: number;
  /**
   * Years from this person's birth to today, for the depth mode: the middle
   * of the recorded range, and its two ends. Null when undated or hidden —
   * such a person is not placed in depth at all.
   */
  readonly yearsBefore: number | null;
  readonly yearsBeforeEarliest: number | null;
  readonly yearsBeforeLatest: number | null;
  readonly lifeLabel: string | null;
  readonly events: number;
  readonly cited: number;
  /** Share of this person's own events that a citation supports. Null: nothing recorded. */
  readonly coverage: number | null;
}

export interface ConstellationLink {
  readonly from: string;
  readonly to: string;
  readonly kind: ConstellationLinkKind;
  /** False for adoptive, foster, step and guardian parents. */
  readonly biological: boolean;
}

export interface ConstellationView {
  readonly access: TreeAccess;
  readonly focusId: string | null;
  readonly focusName: string;
  /** The requested focus may not be shown to this viewer; nothing is drawn. */
  readonly focusHidden: boolean;
  readonly hops: number;
  readonly stars: readonly ConstellationStar[];
  readonly links: readonly ConstellationLink[];
  readonly truncated: boolean;
  readonly presentYear: number;
}

export const loadConstellation = cache(
  async (
    treeSlug: string,
    requestedFocus: string | null,
    hops: number,
  ): Promise<ConstellationView | null> => {
    const access = await resolveTreeAccess(treeSlug);
    if (!access) return null;

    const todayJdn = dateToJdn(new Date());
    const presentYear = jdnToGregorian(todayJdn).year;
    const [graph, coverage] = await Promise.all([
      loadGenealogyGraph(db, access.treeId, todayJdn),
      loadEvidenceCoverage(db, access.treeId),
    ]);

    const hidden = hiddenInGraph(graph, access);

    const empty = {
      access,
      hops,
      stars: [],
      links: [],
      truncated: false,
      presentYear,
    };

    if (requestedFocus !== null && graph.has(requestedFocus) && hidden(requestedFocus)) {
      return { ...empty, focusId: requestedFocus, focusName: REDACTED_LABEL, focusHidden: true };
    }

    const focusId =
      requestedFocus !== null && graph.has(requestedFocus)
        ? requestedFocus
        : defaultFocus(graph, hidden, coverage);
    if (focusId === null) {
      return { ...empty, focusId: null, focusName: '', focusHidden: false };
    }

    const links: ConstellationLink[] = [];
    for (const edge of graph.edges) {
      if (isParentType(edge.type)) {
        links.push({
          from: edge.sourceId,
          to: edge.targetId,
          kind: 'PARENT',
          biological: edge.type === 'PARENT_BIOLOGICAL' || edge.type === 'PARENT_UNKNOWN',
        });
      } else if (isPartnerType(edge.type)) {
        links.push({ from: edge.sourceId, to: edge.targetId, kind: 'PARTNER', biological: true });
      }
    }

    const layout = layoutConstellation(
      focusId,
      [...graph.people.values()].map((person) => {
        const personHidden = hidden(person.id);
        return {
          id: person.id,
          birthSortJdn: personHidden ? null : (person.birth?.interval.earliest ?? null),
          recordedSex: personHidden ? null : (person.recordedSex ?? null),
        };
      }),
      links,
      { maxHops: hops },
    );

    const yearsBefore = (jdn: number | null | undefined): number | null =>
      jdn === null || jdn === undefined ? null : (todayJdn - jdn) / DAYS_PER_YEAR;

    const stars: ConstellationStar[] = layout.nodes.map((node) => {
      const person = graph.people.get(node.id);
      const base = {
        id: node.id,
        hop: node.hop,
        generation: node.generation,
        x: node.x,
        y: node.y,
      };
      if (!person || hidden(node.id)) {
        return {
          ...base,
          name: REDACTED_LABEL,
          hidden: true,
          yearsBefore: null,
          yearsBeforeEarliest: null,
          yearsBeforeLatest: null,
          lifeLabel: null,
          events: 0,
          cited: 0,
          coverage: null,
        };
      }

      const interval = person.birth?.interval;
      const earliest = yearsBefore(interval?.earliest);
      const latest = yearsBefore(interval?.latest);
      // A one-sided range ("avant 1750") has no middle; the known end stands
      // in for it, and the range drawn in depth shows it is only a bound.
      const middle =
        earliest !== null && latest !== null ? (earliest + latest) / 2 : (earliest ?? latest);
      const counts = coverage.get(node.id);

      return {
        ...base,
        name: person.displayName,
        hidden: false,
        yearsBefore: middle,
        // Earliest birth is furthest back in time.
        yearsBeforeEarliest: earliest,
        yearsBeforeLatest: latest,
        lifeLabel: lifeLabel(person),
        events: counts?.events ?? 0,
        cited: counts?.cited ?? 0,
        coverage: counts && counts.events > 0 ? counts.cited / counts.events : null,
      };
    });

    const focus = stars.find((star) => star.id === focusId);
    return {
      ...empty,
      focusId,
      focusName: focus?.name ?? '',
      focusHidden: false,
      stars,
      links: layout.links,
      truncated: layout.truncated,
    };
  },
);

function lifeLabel(person: {
  readonly birth?: Parameters<typeof formatGenealogicalDate>[0] | null;
  readonly death?: Parameters<typeof formatGenealogicalDate>[0] | null;
}): string {
  const birth = person.birth ? formatGenealogicalDate(person.birth) : '?';
  const death = person.death ? formatGenealogicalDate(person.death) : '';
  return death ? `${birth} – ${death}` : birth;
}

/**
 * Who to centre on when nobody was asked for: the visible person with the
 * most relationships, then the best documented. A deterministic choice, so a
 * shared link to the constellation shows the same thing to everyone.
 */
function defaultFocus(
  graph: GenealogyGraph,
  hidden: (personId: string) => boolean,
  coverage: ReadonlyMap<string, { readonly cited: number }>,
): string | null {
  let best: { id: string; degree: number; cited: number } | null = null;
  for (const person of graph.people.values()) {
    if (hidden(person.id)) continue;
    const degree =
      graph.parentsOf(person.id).length +
      graph.childrenOf(person.id).length +
      graph.partnersOf(person.id).length;
    const cited = coverage.get(person.id)?.cited ?? 0;
    if (
      best === null ||
      degree > best.degree ||
      (degree === best.degree && cited > best.cited) ||
      (degree === best.degree && cited === best.cited && person.id < best.id)
    ) {
      best = { id: person.id, degree, cited };
    }
  }
  return best?.id ?? null;
}
