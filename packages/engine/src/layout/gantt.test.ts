import { describe, expect, it } from 'vitest';
import { gregorianToJdn, parseGenealogicalDate } from '@chronolignee/domain';
import { GenealogyGraph, type GraphEdge, type GraphPerson } from '@chronolignee/genealogy';
import { ganttLinks, layoutGantt } from './gantt';
import { cullLabels, decideLod } from '../temporal/lod';

const y = (year: number) => gregorianToJdn(year, 1, 1);

function person(id: string, birth?: number, death?: number): GraphPerson {
  return {
    id,
    displayName: id,
    birth: birth ? parseGenealogicalDate(String(birth)) : null,
    death: death ? parseGenealogicalDate(String(death)) : null,
    lifespan: { earliest: birth ? y(birth) : null, latest: death ? y(death) : null },
  };
}

function parentOf(parent: string, child: string, type: GraphEdge['type'] = 'PARENT_BIOLOGICAL') {
  return { id: `${parent}>${child}`, sourceId: parent, targetId: child, type };
}

describe('row assignment', () => {
  it('puts a parent directly above their children', () => {
    const graph = new GenealogyGraph(
      [person('parent', 1800, 1870), person('child', 1830, 1900)],
      [parentOf('parent', 'child')],
    );
    const layout = layoutGantt(graph);
    expect(layout.rowByPersonId.get('parent')).toBe(0);
    expect(layout.rowByPersonId.get('child')).toBe(1);
  });

  it('orders siblings by birth, not by insertion', () => {
    const graph = new GenealogyGraph(
      [person('parent', 1800, 1870), person('late', 1840, 1900), person('early', 1825, 1890)],
      [parentOf('parent', 'late'), parentOf('parent', 'early')],
    );
    const layout = layoutGantt(graph);
    expect(layout.rowByPersonId.get('early')).toBeLessThan(
      layout.rowByPersonId.get('late') ?? Infinity,
    );
  });

  it('keeps a family contiguous instead of interleaving branches', () => {
    // Two unrelated families born in the same decades. Sorting purely by birth
    // date would alternate their rows and turn every link into a long
    // diagonal; the depth-first walk keeps each family together.
    const graph = new GenealogyGraph(
      [
        person('a-parent', 1800, 1870),
        person('b-parent', 1802, 1875),
        person('a-child', 1830, 1900),
        person('b-child', 1831, 1901),
      ],
      [parentOf('a-parent', 'a-child'), parentOf('b-parent', 'b-child')],
    );
    const layout = layoutGantt(graph);
    const rowOf = (id: string) => layout.rowByPersonId.get(id) ?? -1;

    expect(Math.abs(rowOf('a-parent') - rowOf('a-child'))).toBe(1);
    expect(Math.abs(rowOf('b-parent') - rowOf('b-child'))).toBe(1);
  });

  it('places a couple on adjacent rows', () => {
    const graph = new GenealogyGraph(
      [person('husband', 1800, 1870), person('wife', 1805, 1880)],
      [{ id: 'm', sourceId: 'husband', targetId: 'wife', type: 'SPOUSE', startJdn: y(1825) }],
    );
    const layout = layoutGantt(graph);
    const rowOf = (id: string) => layout.rowByPersonId.get(id) ?? -1;
    expect(Math.abs(rowOf('husband') - rowOf('wife'))).toBe(1);
  });

  it('assigns every person exactly one row', () => {
    const graph = new GenealogyGraph(
      ['a', 'b', 'c', 'd'].map((id) => person(id, 1800, 1870)),
      [parentOf('a', 'b'), parentOf('b', 'c')],
    );
    const layout = layoutGantt(graph);
    expect(layout.rows).toHaveLength(4);
    expect(new Set(layout.rows.map((r) => r.row)).size).toBe(4);
  });

  it('still places an unattached record rather than dropping it', () => {
    // An unattached record is usually a duplicate or an import fragment —
    // exactly the person most in need of attention. Hiding them would be the
    // wrong kind of tidy.
    const graph = new GenealogyGraph(
      [person('connected', 1800, 1870), person('orphan', 1810, 1880)],
      [],
    );
    expect(layoutGantt(graph).rows).toHaveLength(2);
  });

  it('sorts undated people last instead of at the beginning of time', () => {
    const graph = new GenealogyGraph([person('undated'), person('dated', 1800, 1870)], []);
    const layout = layoutGantt(graph);
    expect(layout.rowByPersonId.get('dated')).toBeLessThan(
      layout.rowByPersonId.get('undated') ?? Infinity,
    );
  });

  it('reports the extent of everything laid out', () => {
    const graph = new GenealogyGraph([person('old', 1700, 1760), person('recent', 1950, 2010)], []);
    const layout = layoutGantt(graph);
    expect(layout.earliestJdn).toBe(y(1700));
    expect(layout.latestJdn).toBe(y(2010));
  });

  it('marks an unrecorded death as an open edge', () => {
    const graph = new GenealogyGraph([person('living', 1950)], []);
    expect(layoutGantt(graph).rows[0]?.latestIsOpen).toBe(true);
  });

  it('honours an include filter', () => {
    const graph = new GenealogyGraph(
      ['a', 'b', 'c'].map((id) => person(id, 1800, 1870)),
      [parentOf('a', 'b'), parentOf('b', 'c')],
    );
    const layout = layoutGantt(graph, { include: new Set(['a', 'b']) });
    expect(layout.rows.map((r) => r.personId).sort()).toEqual(['a', 'b']);
  });

  it('terminates on a cyclic graph rather than looping forever', () => {
    const graph = new GenealogyGraph(
      ['a', 'b'].map((id) => person(id, 1800, 1870)),
      [parentOf('a', 'b'), parentOf('b', 'a')],
    );
    // No roots exist, so the fallback picks an earliest-born start.
    expect(layoutGantt(graph).rows).toHaveLength(2);
  });
});

describe('links', () => {
  it('places a parent link at the child birth year', () => {
    const graph = new GenealogyGraph(
      [person('parent', 1800, 1870), person('child', 1830, 1900)],
      [parentOf('parent', 'child')],
    );
    const layout = layoutGantt(graph);
    const links = ganttLinks(graph, layout);

    expect(links).toHaveLength(1);
    expect(links[0]?.kind).toBe('PARENT');
    expect(links[0]?.jdn).toBe(y(1830));
  });

  it('places a marriage link at the marriage, not at a midpoint', () => {
    const graph = new GenealogyGraph(
      [person('a', 1800, 1870), person('b', 1805, 1880)],
      [{ id: 'm', sourceId: 'a', targetId: 'b', type: 'SPOUSE', startJdn: y(1825) }],
    );
    const links = ganttLinks(graph, layoutGantt(graph));
    expect(links[0]?.jdn).toBe(y(1825));
  });

  it('omits a partnership with no recorded date rather than guessing one', () => {
    const graph = new GenealogyGraph(
      [person('a', 1800, 1870), person('b', 1805, 1880)],
      [{ id: 'm', sourceId: 'a', targetId: 'b', type: 'PARTNER' }],
    );
    expect(ganttLinks(graph, layoutGantt(graph))).toHaveLength(0);
  });
});

describe('level of detail', () => {
  const viewport = (fromYear: number, toYear: number) => ({
    startJdn: y(fromYear),
    endJdn: y(toYear),
    widthPx: 1400,
  });

  it('shows everything when a decade fills the screen', () => {
    const lod = decideLod({ viewport: viewport(1900, 1910), rowHeightPx: 22, personCount: 40 });
    expect(lod.level).toBe('DETAIL');
    expect(lod.showPersonLabels).toBe(true);
    expect(lod.showSourceMarkers).toBe(true);
  });

  it('still names forty people across four centuries', () => {
    // Zooming out does not take a name away: the name sits beside the bar and
    // does not need the bar to be wide. Only vertical room and crowding
    // decide, which is what the earlier pixels-per-year rule got wrong.
    const lod = decideLod({ viewport: viewport(1600, 2000), rowHeightPx: 22, personCount: 40 });
    expect(lod.showPersonLabels).toBe(true);
    expect(lod.showRelationshipLinks).toBe(true);
    // Event markers do depend on temporal zoom: a marker is a position on the
    // axis, and at this scale several years land on one pixel.
    expect(lod.showEventMarkers).toBe(false);
  });

  it('stops drawing individual bars once a life is barely a pixel wide', () => {
    // A thousand years across 1400px is 1.4 px per year: a seventy-year life
    // is a hundred pixels, but with twenty thousand of them stacked there is
    // no vertical room. Bars give way to generation bands.
    const lod = decideLod({ viewport: viewport(1000, 2000), rowHeightPx: 3, personCount: 20_000 });
    expect(lod.level).toBe('GENERATION');
    expect(lod.showPersonBars).toBe(false);
    expect(lod.showPersonLabels).toBe(false);
  });

  it('falls back to centuries at the widest scale', () => {
    // Two millennia in a narrow column: 0.2 px per year, so a whole life is
    // fourteen pixels. Nothing below a century is resolvable.
    const lod = decideLod({
      viewport: { startJdn: y(1), endJdn: y(2000), widthPx: 400 },
      rowHeightPx: 2,
      personCount: 20_000,
    });
    expect(lod.level).toBe('CENTURY');
    expect(lod.showPersonBars).toBe(false);
  });

  it('suppresses labels when rows are too short to carry them', () => {
    const lod = decideLod({ viewport: viewport(1900, 1910), rowHeightPx: 6, personCount: 40 });
    expect(lod.showPersonLabels).toBe(false);
  });

  it('suppresses labels for a crowd, whatever the zoom', () => {
    const lod = decideLod({ viewport: viewport(1900, 1910), rowHeightPx: 30, personCount: 5000 });
    expect(lod.showPersonLabels).toBe(false);
  });

  it('keeps the historical layer at every scale', () => {
    for (const [from, to] of [
      [1900, 1901],
      [1600, 2000],
      [1000, 2000],
    ] as const) {
      expect(
        decideLod({ viewport: viewport(from, to), rowHeightPx: 22, personCount: 40 })
          .showHistoricalBands,
      ).toBe(true);
    }
  });
});

describe('label culling', () => {
  const width = () => 60;

  it('keeps labels that clear each other', () => {
    const items = [0, 100, 200, 300];
    expect(cullLabels(items, (x) => x, width)).toEqual(items);
  });

  it('drops labels that would overlap', () => {
    const items = [0, 10, 20, 200];
    expect(cullLabels(items, (x) => x, width)).toEqual([0, 200]);
  });

  it('is stable: the same input gives the same output', () => {
    // Stability matters in motion. A cleverer scoring pass that re-ranks each
    // frame makes labels flicker as the camera drifts by a pixel.
    const items = [0, 30, 65, 140, 155, 400];
    const once = cullLabels(items, (x) => x, width);
    expect(cullLabels(items, (x) => x, width)).toEqual(once);
  });

  it('never returns more than it was given', () => {
    const items = Array.from({ length: 500 }, (_, i) => i * 3);
    expect(cullLabels(items, (x) => x, width).length).toBeLessThanOrEqual(items.length);
  });
});
