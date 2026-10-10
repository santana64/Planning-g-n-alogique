import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { HistoryList } from '@/components/history/history-list';
import { TreeNav } from '@/components/people/tree-nav';
import { BirthsSparkline } from '@/components/statistics/births-sparkline';
import { StatTile } from '@/components/statistics/charts';
import { Link } from '@/i18n/navigation';
import { features } from '@/lib/env';
import { loadTreeOverview } from '@/server/overview';

/** Dynamic, because it reads the database on every request. */
export const dynamic = 'force-dynamic';

/**
 * A tree's front page.
 *
 * Three questions, in the order someone opening a family archive asks them:
 * how big is it and how far back does it go; is anything waiting for me; and
 * where do I go from here.
 */
export default async function TreeOverviewPage({
  params,
}: {
  params: Promise<{ locale: string; treeSlug: string }>;
}) {
  const { locale, treeSlug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('overview');
  const nav = await getTranslations('tree.nav');
  const format = await getFormatter();

  const overview = await loadTreeOverview(treeSlug);
  if (!overview) notFound();
  const { access, statistics: s, pending } = overview;

  const span =
    s.earliestYear !== null && s.latestYear !== null ? s.latestYear - s.earliestYear : null;

  const waiting = [
    { key: 'anomalies', value: pending.anomalies, href: `/app/${treeSlug}/recherche#anomalies` },
    { key: 'openLeads', value: pending.openLeads, href: `/app/${treeSlug}/recherche#pistes` },
    { key: 'unsourced', value: pending.unsourced, href: `/app/${treeSlug}/recherche#sans-source` },
    { key: 'proposals', value: pending.proposals, href: `/app/${treeSlug}/propositions` },
    { key: 'duplicates', value: pending.duplicates, href: `/app/${treeSlug}/doublons` },
  ].filter((item): item is { key: string; value: number; href: string } => item.value !== null);

  const views = [
    { key: 'timeline', href: `/app/${treeSlug}/chronologie`, glyph: '═' },
    { key: 'people', href: `/app/${treeSlug}/personnes`, glyph: '◎' },
    ...(features.constellation
      ? [{ key: 'constellation', href: `/app/${treeSlug}/constellation`, glyph: '✦' }]
      : []),
    { key: 'map', href: `/app/${treeSlug}/carte`, glyph: '◍' },
    { key: 'archive', href: `/app/${treeSlug}/archives`, glyph: '▤' },
    { key: 'statistics', href: `/app/${treeSlug}/statistiques`, glyph: '▥' },
    ...(features.storyDirector
      ? [{ key: 'stories', href: `/app/${treeSlug}/recits`, glyph: '❧' }]
      : []),
  ];

  return (
    <main id="main" className="bg-surface-0 min-h-dvh px-6 py-10">
      <div className="mx-auto flex max-w-[var(--content-max)] flex-col gap-10">
        <TreeNav
          treeSlug={treeSlug}
          treeName={access.treeName}
          role={access.role}
          current="overview"
        />

        <section className="rise border-border-subtle bg-surface-1/40 relative overflow-hidden rounded-[var(--radius-lg)] border p-6 md:p-8">
          <div className="relative z-10 flex flex-col gap-2">
            <p className="text-text-faint text-xs tracking-wide uppercase">{t('eyebrow')}</p>
            <h1 className="font-editorial text-text-primary text-4xl tracking-tight">
              {access.treeName}
            </h1>
            <p className="text-text-secondary max-w-2xl text-sm">
              {s.earliestYear !== null && s.latestYear !== null
                ? t('summary', {
                    people: s.people,
                    from: s.earliestYear,
                    to: s.latestYear,
                    years: span ?? 0,
                    generations: s.generations,
                  })
                : t('summaryEmpty', { people: s.people })}
            </p>
          </div>
          <div className="mt-6">
            <BirthsSparkline decades={s.birthsByDecade} label={t('sparkline')} />
          </div>
        </section>

        <section aria-label={t('figures')} className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile value={format.number(s.people)} label={t('tiles.people')} />
          <StatTile value={s.generations} label={t('tiles.generations')} delay={60} />
          <StatTile
            value={span === null ? '—' : t('tiles.yearsValue', { years: span })}
            label={t('tiles.span')}
            delay={120}
          />
          <StatTile
            value={format.number(s.datedShare, { style: 'percent', maximumFractionDigits: 0 })}
            label={t('tiles.dated')}
            delay={180}
          />
        </section>

        {waiting.length > 0 ? (
          <section aria-labelledby="waiting-title" className="flex flex-col gap-3">
            <h2
              id="waiting-title"
              className="font-editorial text-text-primary text-xl tracking-tight"
            >
              {t('waiting.title')}
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {waiting.map((item, index) => (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    className="rise group border-border-subtle bg-surface-0 hover:border-accent/60 flex h-full flex-col gap-1 rounded-[var(--radius-lg)] border p-4 shadow-[var(--shadow-low)] transition-[border-color,transform] duration-[var(--duration-fast)] hover:-translate-y-0.5"
                    style={{ ['--delay' as string]: `${index * 50}ms` }}
                  >
                    <span
                      className={`font-editorial text-3xl tabular-nums ${item.value > 0 ? 'text-text-primary' : 'text-text-faint'}`}
                    >
                      {item.value}
                    </span>
                    <span className="text-text-secondary text-sm">
                      {t(`waiting.${item.key}`, { count: item.value })}
                    </span>
                    <span className="text-accent mt-auto pt-2 text-xs opacity-80 group-hover:opacity-100">
                      {t('waiting.go')} →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <section aria-labelledby="views-title" className="flex flex-col gap-3">
            <h2
              id="views-title"
              className="font-editorial text-text-primary text-xl tracking-tight"
            >
              {t('views.title')}
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {views.map((view, index) => (
                <li key={view.key}>
                  <Link
                    href={view.href}
                    className="rise group border-border-subtle hover:border-border-strong hover:bg-surface-1 flex h-full items-start gap-3 rounded-[var(--radius-lg)] border p-4 transition-colors duration-[var(--duration-fast)]"
                    style={{ ['--delay' as string]: `${120 + index * 40}ms` }}
                  >
                    <span
                      aria-hidden="true"
                      className="text-accent font-editorial text-2xl leading-none transition-transform duration-[var(--duration-fast)] group-hover:scale-110"
                    >
                      {view.glyph}
                    </span>
                    <span className="flex flex-col gap-0.5">
                      <span className="text-text-primary text-sm font-medium">{nav(view.key)}</span>
                      <span className="text-text-muted text-xs">{t(`views.${view.key}`)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          {access.role !== null ? (
            <section aria-labelledby="recent-title" className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between">
                <h2
                  id="recent-title"
                  className="font-editorial text-text-primary text-xl tracking-tight"
                >
                  {t('recent')}
                </h2>
                <Link
                  href={`/app/${treeSlug}/historique`}
                  className="text-accent hover:text-accent-hover text-xs"
                >
                  {t('allHistory')}
                </Link>
              </div>
              <HistoryList treeSlug={treeSlug} lines={overview.recent} />
            </section>
          ) : null}
        </div>
      </div>
    </main>
  );
}
