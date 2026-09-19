import 'server-only';
import { cache } from 'react';
import { dateToJdn, formatGenealogicalDate } from '@chronolignee/domain';
import { loadGenealogyGraph } from '@chronolignee/db';
import { layoutTemporalFan, type FanRing, type FanSector } from '@chronolignee/engine';
import { sosaNumbers } from '@chronolignee/genealogy';
import { db } from '@/lib/db';
import { REDACTED_LABEL, hiddenInGraph, resolveTreeAccess, type TreeAccess } from './access';

/**
 * The temporal fan, ready to draw.
 *
 * Redaction here is about geometry, not only names. A sector's distance from
 * the centre IS its birth year: hiding a living person's name while still
 * placing their band on the "1962" ring publishes exactly what the redaction
 * protects. So a hidden person is not placed at all, and a hidden subject —
 * whose birth year would label the centre — gets no fan.
 */

export interface FanPerson {
  readonly personId: string;
  readonly name: string;
  readonly birthLabel: string;
}

export interface TemporalFanView {
  readonly access: TreeAccess;
  readonly subjectId: string;
  readonly subjectName: string;
  /** True when the subject may not be shown to this viewer; no fan is drawn. */
  readonly subjectHidden: boolean;
  readonly referenceYear: number | null;
  readonly maxYears: number;
  readonly sectors: readonly FanSector[];
  readonly rings: readonly FanRing[];
  readonly people: Readonly<Record<string, FanPerson>>;
  /** In the pedigree but not placeable: undated, or protected. */
  readonly unplaced: readonly {
    readonly sosa: number;
    readonly name: string;
    readonly reason: 'UNDATED' | 'PROTECTED';
  }[];
  readonly generations: number;
}

export const loadTemporalFan = cache(
  async (
    treeSlug: string,
    subjectId: string,
    generations: number,
  ): Promise<TemporalFanView | null> => {
    const access = await resolveTreeAccess(treeSlug);
    if (!access) return null;

    const graph = await loadGenealogyGraph(db, access.treeId, dateToJdn(new Date()));
    const subject = graph.people.get(subjectId);
    if (!subject) return null;

    const hidden = hiddenInGraph(graph, access);

    const base = {
      access,
      subjectId,
      subjectName: hidden(subjectId) ? REDACTED_LABEL : subject.displayName,
      generations,
    };

    if (hidden(subjectId)) {
      return {
        ...base,
        subjectHidden: true,
        referenceYear: null,
        maxYears: 0,
        sectors: [],
        rings: [],
        people: {},
        unplaced: [],
      };
    }

    const sosa = sosaNumbers(graph, subjectId, { generations });
    const ancestors = [];
    const protectedPositions: { sosa: number; name: string; reason: 'PROTECTED' }[] = [];

    for (const [personId, numbers] of sosa.numbersById) {
      if (personId === subjectId) continue;
      const birth = graph.people.get(personId)?.birth?.interval;
      for (const number of numbers) {
        if (hidden(personId)) {
          protectedPositions.push({ sosa: number, name: REDACTED_LABEL, reason: 'PROTECTED' });
          continue;
        }
        ancestors.push({
          personId,
          sosa: number,
          birthEarliestJdn: birth?.earliest ?? null,
          birthLatestJdn: birth?.latest ?? null,
        });
      }
    }

    const layout = layoutTemporalFan(
      {
        birthEarliestJdn: subject.birth?.interval.earliest ?? null,
        birthLatestJdn: subject.birth?.interval.latest ?? null,
      },
      ancestors,
    );

    const people: Record<string, FanPerson> = {};
    for (const sector of layout.sectors) {
      if (people[sector.personId]) continue;
      const person = graph.people.get(sector.personId);
      people[sector.personId] = {
        personId: sector.personId,
        name: person?.displayName ?? '',
        birthLabel: person?.birth ? formatGenealogicalDate(person.birth) : '—',
      };
    }

    const unplaced = [
      ...layout.unplaced.map((entry) => ({
        sosa: entry.sosa,
        name: graph.people.get(entry.personId)?.displayName ?? '',
        reason: 'UNDATED' as const,
      })),
      ...protectedPositions,
    ].sort((a, b) => a.sosa - b.sosa);

    return {
      ...base,
      subjectHidden: false,
      referenceYear: layout.referenceYear,
      maxYears: layout.maxYears,
      sectors: layout.sectors,
      rings: layout.rings,
      people,
      unplaced,
    };
  },
);
