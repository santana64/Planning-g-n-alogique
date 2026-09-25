import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { DEFAULT_DESCENT_GENERATIONS, loadDescent } from '@/server/descent';
import { TreeNav } from '@/components/people/tree-nav';

/**
 * Dynamic, because it reads the database on every request.
 *
 * Stated rather than inferred: the locale layout declares generateStaticParams,
 * which makes every page under it a prerender candidate, and Next would
 * otherwise try to render this one at build time — against a database the build
 * container does not have.
 */
export const dynamic = 'force-dynamic';

const MAX_GENERATIONS = 10;

export default async function DescendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; treeSlug: string; personId: string }>;
  searchParams: Promise<{ g?: string }>;
}) {
  const { locale, treeSlug, personId } = await params;
  setRequestLocale(locale);

  const { g } = await searchParams;
  const requested = Number.parseInt(g ?? '', 10);
  const generations =
    Number.isFinite(requested) && requested > 0
      ? Math.min(requested, MAX_GENERATIONS)
      : DEFAULT_DESCENT_GENERATIONS;

  const t = await getTranslations('descendants');
  const descent = await loadDescent(treeSlug, personId, generations);
  if (!descent) notFound();

  const { access } = descent;

  return (
    <main id="main" className="bg-surface-0 min-h-dvh px-6 py-10">
      <div className="mx-auto flex max-w-[var(--content-max)] flex-col gap-8">
        <TreeNav
          treeSlug={treeSlug}
          treeName={access.treeName}
          role={access.role}
          current="people"
        />

        <div className="flex flex-col gap-1">
          <Link
            href={`/app/${treeSlug}/personnes/${personId}`}
            className="text-text-faint hover:text-accent text-sm"
          >
            ← {descent.subjectName}
          </Link>
          <h1 className="font-editorial text-text-primary text-3xl tracking-tight">{t('title')}</h1>
          <p className="text-text-muted text-sm">{t('lead')}</p>
        </div>

        <nav aria-label={t('depth')} className="flex items-baseline gap-3">
          <span className="text-text-faint text-xs tracking-wide uppercase">
            {t('generations')}
          </span>
          {[3, 5, 7, 10].map((count) => (
            <Link
              key={count}
              href={`/app/${treeSlug}/personnes/${personId}/descendance?g=${count}`}
              aria-current={count === generations ? 'page' : undefined}
              className={
                count === generations
                  ? 'text-text-primary border-accent border-b-2 text-sm'
                  : 'text-text-muted hover:text-text-primary text-sm'
              }
            >
              {count}
            </Link>
          ))}
        </nav>

        <section className="flex flex-wrap items-baseline gap-6">
          <p className="text-text-secondary text-sm">
            <span className="text-text-primary font-editorial text-xl">{descent.totalPeople}</span>{' '}
            {t('people', { count: descent.totalPeople })}
          </p>
          {descent.perGeneration.map((count, generation) => (
            <p key={generation} className="text-text-muted text-sm">
              <span className="text-text-faint text-xs">G{generation}</span>{' '}
              <span className="tabular">{count}</span>
            </p>
          ))}
          {descent.truncated ? <p className="text-text-faint text-sm">{t('continues')}</p> : null}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-text-faint text-xs tracking-wide uppercase">{t('theLine')}</h2>
          <ol className="flex flex-col">
            {descent.rows.map((row) => (
              <li
                key={`${row.personId}-${row.number}`}
                className="border-border-subtle flex items-baseline gap-3 border-b py-1.5 last:border-b-0"
                // Indentation carries the generation, which is what makes a
                // descendant study readable as a document rather than a table.
                style={{ paddingLeft: `${row.generation * 1.5}rem` }}
              >
                <span className="text-text-faint tabular w-20 shrink-0 text-xs">{row.number}</span>

                {row.redacted ? (
                  <span className="text-text-muted font-editorial text-sm italic">
                    {row.displayName}
                  </span>
                ) : (
                  <Link
                    href={`/app/${treeSlug}/personnes/${row.personId}`}
                    className="text-text-primary hover:text-accent font-editorial text-sm"
                  >
                    {row.displayName}
                  </Link>
                )}

                {row.lifespanLabel ? (
                  <span className="text-text-muted tabular text-xs">{row.lifespanLabel}</span>
                ) : null}

                {/* D'Aboville numbers birth order. When the record does not
                 * give one, saying so beats asserting a position. */}
                {row.orderInferred ? (
                  <span className="text-warning text-xs">{t('orderInferred')}</span>
                ) : null}
                {row.repeated ? (
                  <span className="text-source text-xs">descend par deux lignes</span>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}
