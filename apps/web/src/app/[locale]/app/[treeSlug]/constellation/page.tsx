import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { features } from '@/lib/env';
import { loadConstellation, type ConstellationStar } from '@/server/constellation';
import { ConstellationView } from '@/components/constellation/constellation-view';
import { SKY, coverageSentence } from '@/components/constellation/appearance';
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

const REACH = [2, 3, 4, 6] as const;
const DEFAULT_REACH = 3;
const PERSON_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Swatch({ color, glow }: { color: string; glow: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-2.5 w-2.5 rounded-full"
      style={{ backgroundColor: color, opacity: glow, boxShadow: `0 0 6px ${color}` }}
    />
  );
}

export default async function ConstellationPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; treeSlug: string }>;
  searchParams: Promise<{ focus?: string; liens?: string }>;
}) {
  const { locale, treeSlug } = await params;
  setRequestLocale(locale);
  if (!features.constellation) notFound();

  const { focus, liens } = await searchParams;
  const requested = Number.parseInt(liens ?? '', 10);
  const reach = REACH.includes(requested as (typeof REACH)[number]) ? requested : DEFAULT_REACH;
  const focusParam = focus && PERSON_ID.test(focus) ? focus : null;

  const view = await loadConstellation(treeSlug, focusParam, reach);
  if (!view) notFound();

  const byHop = new Map<number, ConstellationStar[]>();
  for (const star of view.stars) {
    const group = byHop.get(star.hop);
    if (group) group.push(star);
    else byHop.set(star.hop, [star]);
  }
  const hasHidden = view.stars.some((star) => star.hidden);
  const t = await getTranslations('constellation');
  const wider = REACH.find((count) => count > reach);
  const constellationHref = (personId: string | null, hops: number) =>
    `/app/${treeSlug}/constellation?${personId ? `focus=${personId}&` : ''}liens=${hops}`;

  return (
    <main id="main" className="bg-surface-0 min-h-dvh px-6 py-10">
      <div className="mx-auto flex max-w-[var(--content-max)] flex-col gap-8">
        <TreeNav
          treeSlug={treeSlug}
          treeName={view.access.treeName}
          role={view.access.role}
          current="constellation"
        />

        <div className="flex flex-col gap-1">
          <h1 className="font-editorial text-text-primary text-3xl tracking-tight">{t('title')}</h1>
          <p className="text-text-muted max-w-2xl text-sm">
            {t('lead')}
            {features.temporalDepth ? t('leadDepth') : ''}
          </p>
        </div>

        <nav aria-label={t('reach')} className="flex items-baseline gap-3">
          <span className="text-text-faint text-xs tracking-wide uppercase">{t('links')}</span>
          {REACH.map((count) => (
            <Link
              key={count}
              href={constellationHref(view.focusId, count)}
              aria-current={count === reach ? 'page' : undefined}
              className={
                count === reach
                  ? 'text-text-primary border-accent border-b-2 text-sm'
                  : 'text-text-muted hover:text-text-primary text-sm'
              }
            >
              {count}
            </Link>
          ))}
        </nav>

        {view.focusHidden ? (
          <p className="border-source/30 bg-source/10 text-source rounded-[var(--radius-md)] border px-4 py-3">
            {t('focusHidden')}
          </p>
        ) : view.focusId === null ? (
          <p className="border-border-subtle text-text-muted rounded-[var(--radius-lg)] border border-dashed p-8">
            {t('noCentre')}
          </p>
        ) : (
          <>
            <ConstellationView
              treeSlug={treeSlug}
              stars={view.stars}
              links={view.links}
              focusId={view.focusId}
              presentYear={view.presentYear}
              hops={reach}
              depthAvailable={features.temporalDepth}
            />

            <ul
              className="flex flex-wrap gap-x-6 gap-y-2 rounded-[var(--radius-md)] px-4 py-3 text-xs text-[#c9ccd6]"
              style={{ backgroundColor: SKY.background }}
            >
              <li className="flex items-center gap-2">
                <Swatch color={SKY.star} glow={1} />
                <Swatch color={SKY.star} glow={0.38} />
                {t('legendGlow')}
              </li>
              <li className="flex items-center gap-2">
                <Swatch color={SKY.focus} glow={1} />
                {t('legendFocus')}
              </li>
              {hasHidden ? (
                <li className="flex items-center gap-2">
                  <Swatch color={SKY.hidden} glow={0.6} />
                  {t('legendHidden')}
                </li>
              ) : null}
              <li className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block h-px w-5"
                  style={{ backgroundColor: SKY.parentLink }}
                />
                {t('legendParent')}
              </li>
              <li className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block h-px w-5"
                  style={{ backgroundColor: SKY.otherParentLink }}
                />
                {t('legendOtherParent')}
              </li>
              <li className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block h-px w-5"
                  style={{ backgroundColor: SKY.partnerLink }}
                />
                {t('legendPartner')}
              </li>
            </ul>

            {view.truncated ? (
              <p className="text-text-muted text-sm">
                {t('beyond', { count: reach })}{' '}
                {wider !== undefined ? (
                  <Link
                    href={constellationHref(view.focusId, wider)}
                    // Inside a sentence, colour alone does not say "link".
                    className="text-accent underline underline-offset-2"
                  >
                    {t('widen', { count: wider })}
                  </Link>
                ) : null}
              </p>
            ) : null}

            <section aria-labelledby="constellation-people" className="flex flex-col gap-3">
              <h2
                id="constellation-people"
                className="text-text-faint text-xs tracking-wide uppercase"
              >
                {t('peopleHeading', { count: view.stars.length })}
              </h2>
              {[...byHop.entries()].map(([hop, group]) => (
                <div key={hop} className="flex flex-col gap-1">
                  <h3 className="text-text-secondary text-sm font-medium">
                    {hop === 0 ? t('atCentre') : t('hopsHeading', { count: hop })}
                  </h3>
                  <ul className="flex flex-col">
                    {group.map((star) => (
                      <li
                        key={star.id}
                        className="border-border-subtle flex flex-wrap items-baseline gap-x-3 border-b py-1.5 text-sm last:border-b-0"
                      >
                        {star.hidden ? (
                          <span className="text-text-muted italic">{star.name}</span>
                        ) : (
                          <Link
                            href={`/app/${treeSlug}/personnes/${star.id}`}
                            className="text-text-primary hover:text-accent hover:underline"
                          >
                            {star.name}
                          </Link>
                        )}
                        {star.lifeLabel ? (
                          <span className="tabular text-text-muted text-xs">{star.lifeLabel}</span>
                        ) : null}
                        {star.hidden ? null : (
                          <span className="text-text-faint text-xs">
                            {coverageSentence(t, star)}
                          </span>
                        )}
                        {!star.hidden && star.id !== view.focusId ? (
                          <Link
                            href={constellationHref(star.id, reach)}
                            className="text-accent ml-auto text-xs hover:underline"
                            aria-label={t('centreOn', { name: star.name })}
                          >
                            Centrer
                          </Link>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
