import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { DEFAULT_GENERATIONS, loadPedigree } from '@/server/ancestry';
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

const MAX_GENERATIONS = 12;

export default async function AscendancePage({
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
      : DEFAULT_GENERATIONS;

  const t = await getTranslations('ancestry');
  const pedigree = await loadPedigree(treeSlug, personId, generations);
  if (!pedigree) notFound();

  const { access } = pedigree;

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
            ← {pedigree.subjectName}
          </Link>
          <h1 className="font-editorial text-text-primary text-3xl tracking-tight">{t('title')}</h1>
          <p className="text-text-muted text-sm">{t('lead')}</p>
        </div>

        <nav aria-label={t('depth')} className="flex items-baseline gap-3">
          <span className="text-text-faint text-xs tracking-wide uppercase">
            {t('generations')}
          </span>
          {[4, 6, 8, 10].map((count) => (
            <Link
              key={count}
              href={`/app/${treeSlug}/personnes/${personId}/ascendance?g=${count}`}
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

        <section className="flex flex-col gap-3">
          <h2 className="text-text-faint text-xs tracking-wide uppercase">{t('found')}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{t('tableCaption')}</caption>
              <thead>
                <tr className="text-text-faint border-border-subtle border-b text-left">
                  <th scope="col" className="py-2 pr-4 font-normal">
                    {t('columns.generation')}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-normal">
                    {t('columns.positions')}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-normal">
                    {t('columns.peopleFound')}
                  </th>
                  <th scope="col" className="py-2 font-normal">
                    {t('columns.completeness')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {pedigree.completeness.map((row) => (
                  <tr key={row.generation} className="border-border-subtle border-b">
                    <td className="tabular py-2 pr-4">{row.generation}</td>
                    <td className="tabular text-text-muted py-2 pr-4">{row.possible}</td>
                    {/* People, not filled slots. With pedigree collapse the two
                     * differ, and counting slots would claim more research than
                     * was actually done. */}
                    <td className="tabular py-2 pr-4">{row.known}</td>
                    <td className="tabular text-text-muted py-2">
                      {Math.round((row.filledPositions / row.possible) * 100)} %
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pedigree.collapsedCount > 0 ? (
            <p className="text-source text-sm">
              {t('collapsed', { count: pedigree.collapsedCount })}
            </p>
          ) : null}

          {pedigree.truncated ? <p className="text-text-faint text-sm">{t('deeper')}</p> : null}
        </section>

        <section className="flex flex-col gap-6">
          <h2 className="text-text-faint text-xs tracking-wide uppercase">{t('positions')}</h2>
          {pedigree.generations.map((slots, generation) => (
            <div key={generation} className="flex flex-col gap-2">
              <h3 className="text-text-secondary text-sm">
                {t('generationNumber', { number: generation })}
                <span className="text-text-faint ml-2 text-xs">
                  {generation > 0
                    ? t('sosaRange', {
                        from: 2 ** generation,
                        to: 2 ** (generation + 1) - 1,
                      })
                    : t('sosaOne', { from: 2 ** generation })}
                </span>
              </h3>
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {slots.map((slot) => (
                  <li
                    key={slot.sosa}
                    className={`border-border-subtle flex flex-col gap-0.5 rounded-[var(--radius-md)] border px-3 py-2 ${
                      slot.personId ? '' : 'border-dashed'
                    }`}
                  >
                    <span className="text-text-faint tabular text-xs">
                      {slot.sosa}
                      {slot.repeated ? (
                        <span className="text-source ml-2">
                          {t('alsoAt', { positions: slot.alsoAt.join(', ') })}
                        </span>
                      ) : null}
                    </span>
                    {slot.personId ? (
                      slot.redacted ? (
                        <span className="text-text-muted text-sm italic">{slot.displayName}</span>
                      ) : (
                        <Link
                          href={`/app/${treeSlug}/personnes/${slot.personId}`}
                          className="text-text-primary hover:text-accent font-editorial text-sm"
                        >
                          {slot.displayName}
                        </Link>
                      )
                    ) : (
                      // The empty slots are the point of this screen: they say
                      // where the winter's work should go.
                      <span className="text-text-faint text-sm">{t('unknown')}</span>
                    )}
                    {slot.lifespanLabel ? (
                      <span className="text-text-muted tabular text-xs">{slot.lifespanLabel}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
