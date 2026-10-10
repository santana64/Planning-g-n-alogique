'use client';

import { useTranslations } from 'next-intl';
import type { TreeStatistics } from '@chronolignee/genealogy';
import { ColumnChart, RankedBars } from './charts';

/**
 * The charts, in reading order: when the family was born, how long they
 * lived, how many children a couple had, then what they were called, what
 * they did, and where they were born.
 */
export function StatisticsCharts({ statistics: s }: { statistics: TreeStatistics }) {
  const t = useTranslations('statistics');

  const sexSeries = [
    { key: 'female', label: t('series.female'), color: 'var(--sex-female)' },
    { key: 'male', label: t('series.male'), color: 'var(--sex-male)' },
    { key: 'other', label: t('series.other'), color: 'var(--sex-unknown)' },
  ];
  const one = [{ key: 'count', label: t('series.count'), color: 'var(--accent-primary)' }];

  return (
    <div className="flex flex-col gap-10">
      <section className="border-border-subtle bg-surface-0 rounded-[var(--radius-lg)] border p-5 shadow-[var(--shadow-low)]">
        <ColumnChart
          title={t('charts.births')}
          columns={s.birthsByDecade.map((row) => ({
            key: String(row.decade),
            label: String(row.decade),
            values: { female: row.female, male: row.male, other: row.other },
          }))}
          // Only the series that occur: an empty "sexe non renseigné" entry
          // in the legend is noise.
          series={sexSeries.filter((serie) =>
            s.birthsByDecade.some((row) => row[serie.key as 'female' | 'male' | 'other'] > 0),
          )}
          unit={(value) => t('units.births', { count: value })}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="border-border-subtle bg-surface-0 rounded-[var(--radius-lg)] border p-5 shadow-[var(--shadow-low)]">
          <ColumnChart
            title={t('charts.ageAtDeath')}
            columns={s.lifespan.bands.map((band) => ({
              key: String(band.from),
              label: band.from >= 100 ? '100+' : `${band.from}`,
              values: { count: band.count },
            }))}
            series={one}
            unit={(value) => t('units.people', { count: value })}
          />
        </section>
        <section className="border-border-subtle bg-surface-0 rounded-[var(--radius-lg)] border p-5 shadow-[var(--shadow-low)]">
          <ColumnChart
            title={t('charts.familySize')}
            columns={s.childrenPerCouple.bands.map((band) => ({
              key: String(band.children),
              label: String(band.children),
              values: { count: band.couples },
            }))}
            series={one}
            unit={(value) => t('units.couples', { count: value })}
          />
        </section>
      </div>

      {s.lifespan.byCentury.length > 1 ? (
        <section className="border-border-subtle bg-surface-0 rounded-[var(--radius-lg)] border p-5 shadow-[var(--shadow-low)]">
          <ColumnChart
            title={t('charts.lifespanByCentury')}
            columns={s.lifespan.byCentury.map((row) => ({
              key: String(row.century),
              label: t('century', { century: row.century }),
              values: { count: Math.round(row.median ?? 0) },
            }))}
            series={one}
            unit={(value) => t('years', { count: value })}
          />
        </section>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <RankedBars
          title={t('charts.namesFemale')}
          items={s.givenNames.female}
          color="var(--sex-female)"
        />
        <RankedBars
          title={t('charts.namesMale')}
          items={s.givenNames.male}
          color="var(--sex-male)"
        />
        <RankedBars title={t('charts.occupations')} items={s.occupations} />
        <RankedBars title={t('charts.birthPlaces')} items={s.birthPlaces} />
      </div>
    </div>
  );
}
