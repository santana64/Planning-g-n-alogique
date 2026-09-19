import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { features } from '@/lib/env';
import { loadTemporalFan } from '@/server/temporal-fan';
import { TemporalFanChart } from '@/components/fan/temporal-fan-chart';
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

const DEPTHS = [4, 6, 8, 10] as const;

export default async function EventailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; treeSlug: string; personId: string }>;
  searchParams: Promise<{ g?: string }>;
}) {
  const { locale, treeSlug, personId } = await params;
  setRequestLocale(locale);
  if (!features.temporalDepth) notFound();

  const { g } = await searchParams;
  const requested = Number.parseInt(g ?? '', 10);
  const generations = DEPTHS.includes(requested as (typeof DEPTHS)[number]) ? requested : 6;

  const view = await loadTemporalFan(treeSlug, personId, generations);
  if (!view) notFound();

  return (
    <main id="main" className="bg-surface-0 min-h-dvh px-6 py-10">
      <div className="mx-auto flex max-w-[var(--content-max)] flex-col gap-8">
        <TreeNav
          treeSlug={treeSlug}
          treeName={view.access.treeName}
          role={view.access.role}
          current="people"
        />

        <div className="flex flex-col gap-1">
          <Link
            href={`/app/${treeSlug}/personnes/${personId}`}
            className="text-text-faint hover:text-accent text-sm"
          >
            ← {view.subjectName}
          </Link>
          <h1 className="font-editorial text-text-primary text-3xl tracking-tight">
            Éventail temporel
          </h1>
          <p className="text-text-muted max-w-2xl text-sm">
            L’ascendance en éventail, où chaque anneau est une année et non une génération. Une
            branche qui s’étend plus loin à chaque pas est une branche de générations plus longues ;
            deux ancêtres au même rayon sont nés les mêmes années.
          </p>
        </div>

        <nav aria-label="Profondeur" className="flex items-baseline gap-3">
          <span className="text-text-faint text-xs tracking-wide uppercase">Générations</span>
          {DEPTHS.map((count) => (
            <Link
              key={count}
              href={`/app/${treeSlug}/personnes/${personId}/eventail?g=${count}`}
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

        {view.subjectHidden ? (
          <p className="border-source/30 bg-source/10 text-source rounded-[var(--radius-md)] border px-4 py-3">
            Cette personne est protégée. Son éventail n’est pas affiché : son centre porterait son
            année de naissance.
          </p>
        ) : view.referenceYear === null ? (
          <p className="border-border-subtle text-text-muted rounded-[var(--radius-lg)] border border-dashed p-8">
            La date de naissance de {view.subjectName} n’est pas connue. L’éventail mesure tout à
            partir d’elle : sans ce point de départ, il ne serait qu’un éventail de générations
            déguisé.
          </p>
        ) : (
          <>
            <ul className="text-text-muted flex flex-wrap gap-x-6 gap-y-2 text-xs">
              <li className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block h-3 w-3 rounded-sm bg-[var(--accent-history)]"
                />
                côté paternel
              </li>
              <li className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block h-3 w-3 rounded-sm bg-[var(--accent-primary)]"
                />
                côté maternel
              </li>
              <li>
                Épaisseur : l’incertitude sur la naissance. Un trait fin est une date ; une bande
                large, « vers » ou « entre ».
              </li>
              <li>Pâle : date approchée ou ouverte. Rouge : né·e après la personne centrale.</li>
            </ul>

            <TemporalFanChart view={view} treeSlug={treeSlug} locale={locale} />
          </>
        )}

        {view.unplaced.length > 0 ? (
          <section aria-labelledby="fan-unplaced" className="flex flex-col gap-2">
            <h2 id="fan-unplaced" className="text-text-faint text-xs tracking-wide uppercase">
              Non placés
            </h2>
            <p className="text-text-muted text-sm">
              Dans l’ascendance, mais sans position dans le temps. Les placer quelque part
              inventerait précisément ce que l’éventail montre.
            </p>
            <ul className="flex flex-col">
              {view.unplaced.map((entry) => (
                <li
                  key={`${entry.sosa}-${entry.reason}`}
                  className="border-border-subtle flex items-baseline gap-3 border-b py-1.5 text-sm last:border-b-0"
                >
                  <span className="text-text-faint tabular w-12 text-xs">{entry.sosa}</span>
                  <span
                    className={
                      entry.reason === 'PROTECTED' ? 'text-text-muted italic' : 'text-text-primary'
                    }
                  >
                    {entry.name}
                  </span>
                  <span className="text-text-faint text-xs">
                    {entry.reason === 'PROTECTED'
                      ? 'personne protégée, non publiée'
                      : 'naissance non datée'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </main>
  );
}
