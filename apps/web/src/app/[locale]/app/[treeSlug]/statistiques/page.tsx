import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { TreeNav } from '@/components/people/tree-nav';
import { AtAgeTable } from '@/components/statistics/at-age';
import { StatisticsCharts } from '@/components/statistics/statistics-charts';
import { StatTile } from '@/components/statistics/charts';
import { isUuid } from '@/lib/ids';
import { loadAtAge, loadTreeFigures } from '@/server/statistics';

/** Dynamic, because it reads the database on every request. */
export const dynamic = 'force-dynamic';

const AGES = [20, 25, 30, 40, 50, 60] as const;

export default async function StatisticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; treeSlug: string }>;
  searchParams: Promise<{ personne?: string; age?: string; lignee?: string }>;
}) {
  const { locale, treeSlug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('statistics');
  const format = await getFormatter();

  const figures = await loadTreeFigures(treeSlug);
  if (!figures) notFound();
  const { access, statistics: s } = figures;

  // --- "At age X": a GET form, so a comparison is a link one can share -----
  const query = await searchParams;
  const age = AGES.find((value) => String(value) === query.age) ?? 30;
  const line = query.lignee === 'mere' ? 'MOTHER' : 'FATHER';
  const chosen =
    query.personne && isUuid(query.personne)
      ? query.personne
      : (figures.lineageStarts[0]?.id ?? null);
  const comparison = chosen ? await loadAtAge(treeSlug, chosen, age, line) : null;

  const span =
    s.earliestYear !== null && s.latestYear !== null ? `${s.earliestYear} – ${s.latestYear}` : '—';
  const years = (value: number | null) =>
    value === null ? '—' : t('years', { count: Math.round(value) });

  return (
    <main id="main" className="bg-surface-0 min-h-dvh px-6 py-10">
      <div className="mx-auto flex max-w-[var(--content-max)] flex-col gap-10">
        <TreeNav
          treeSlug={treeSlug}
          treeName={access.treeName}
          role={access.role}
          current="statistics"
        />

        <div className="rise flex flex-col gap-2">
          <h1 className="font-editorial text-text-primary text-3xl tracking-tight">{t('title')}</h1>
          <p className="text-text-muted max-w-2xl text-sm">{t('lead')}</p>
        </div>

        <section aria-label={t('headline')} className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile
            value={format.number(s.people)}
            label={t('tiles.people')}
            note={t('tiles.peopleNote', { female: s.bySex.female, male: s.bySex.male })}
          />
          <StatTile value={s.generations} label={t('tiles.generations')} delay={60} />
          <StatTile value={span} label={t('tiles.span')} delay={120} />
          <StatTile
            value={format.number(s.datedShare, { style: 'percent', maximumFractionDigits: 0 })}
            label={t('tiles.dated')}
            note={t('tiles.datedNote', { births: s.datedBirths, deaths: s.datedDeaths })}
            delay={180}
          />
        </section>

        <StatisticsCharts statistics={s} />

        <section aria-labelledby="ages-title" className="flex flex-col gap-4">
          <div className="border-border-subtle flex flex-col gap-1 border-b pb-2">
            <h2 id="ages-title" className="font-editorial text-text-primary text-xl tracking-tight">
              {t('figures.title')}
            </h2>
            <p className="text-text-muted text-sm">{t('figures.lead')}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile
              value={years(s.lifespan.median)}
              label={t('figures.lifespan')}
              note={t('basedOn', { count: s.lifespan.count })}
            />
            <StatTile
              value={years(s.marriageAge.female.median)}
              label={t('figures.marriageFemale')}
              note={t('basedOn', { count: s.marriageAge.female.count })}
              delay={60}
            />
            <StatTile
              value={years(s.marriageAge.male.median)}
              label={t('figures.marriageMale')}
              note={t('basedOn', { count: s.marriageAge.male.count })}
              delay={120}
            />
            <StatTile
              value={
                s.childrenPerCouple.median === null
                  ? '—'
                  : format.number(s.childrenPerCouple.median)
              }
              label={t('figures.children')}
              note={t('couplesBasedOn', { count: s.childrenPerCouple.count })}
              delay={180}
            />
          </div>
          {s.migration.longest ? (
            <p className="text-text-secondary text-sm">
              {t('figures.migration', {
                median: s.migration.median ?? 0,
                count: s.migration.count,
                from: s.migration.longest.from,
                to: s.migration.longest.to,
                km: s.migration.longest.km,
              })}
            </p>
          ) : null}
        </section>

        <section aria-labelledby="at-age-title" className="flex flex-col gap-4">
          <div className="border-border-subtle flex flex-col gap-1 border-b pb-2">
            <h2
              id="at-age-title"
              className="font-editorial text-text-primary text-xl tracking-tight"
            >
              {t('atAge.title')}
            </h2>
            <p className="text-text-muted text-sm">{t('atAge.lead')}</p>
          </div>

          {figures.lineageStarts.length === 0 ? (
            <p className="text-text-faint text-sm">{t('atAge.nobody')}</p>
          ) : (
            <>
              <form method="get" className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-text-secondary font-medium">{t('atAge.person')}</span>
                  <select
                    name="personne"
                    defaultValue={chosen ?? undefined}
                    className="border-border-default bg-surface-1 text-text-primary rounded-[var(--radius-md)] border px-3 py-2"
                  >
                    {figures.lineageStarts.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-text-secondary font-medium">{t('atAge.age')}</span>
                  <select
                    name="age"
                    defaultValue={String(age)}
                    className="border-border-default bg-surface-1 text-text-primary rounded-[var(--radius-md)] border px-3 py-2"
                  >
                    {AGES.map((value) => (
                      <option key={value} value={value}>
                        {t('years', { count: value })}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-text-secondary font-medium">{t('atAge.line')}</span>
                  <select
                    name="lignee"
                    defaultValue={line === 'MOTHER' ? 'mere' : 'pere'}
                    className="border-border-default bg-surface-1 text-text-primary rounded-[var(--radius-md)] border px-3 py-2"
                  >
                    <option value="pere">{t('atAge.father')}</option>
                    <option value="mere">{t('atAge.mother')}</option>
                  </select>
                </label>
                <button
                  type="submit"
                  className="bg-accent text-accent-contrast hover:bg-accent-hover rounded-[var(--radius-md)] px-4 py-2 text-sm font-medium transition-colors duration-[var(--duration-fast)]"
                >
                  {t('atAge.compare')}
                </button>
              </form>
              {comparison ? <AtAgeTable treeSlug={treeSlug} rows={comparison} age={age} /> : null}
            </>
          )}
        </section>

        <p className="text-text-faint border-border-subtle border-t pt-4 text-xs">{t('caveat')}</p>
      </div>
    </main>
  );
}
