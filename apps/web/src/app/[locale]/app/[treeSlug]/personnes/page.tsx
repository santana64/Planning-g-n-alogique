import { notFound } from 'next/navigation';
import { can } from '@chronolignee/domain';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { PEOPLE_PAGE_SIZE, listPeople } from '@/server/people';
import { PeopleSearch } from '@/components/people/people-search';
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

const SEX_MARK: Record<string, string> = {
  FEMALE: '♀',
  MALE: '♂',
  INTERSEX: '⚥',
  UNKNOWN: '·',
};

/** The same colours as the timeline: one reading of a family everywhere. */
const SEX_COLOUR: Record<string, string> = {
  FEMALE: 'var(--sex-female)',
  MALE: 'var(--sex-male)',
  INTERSEX: 'var(--sex-other)',
  UNKNOWN: 'var(--sex-unknown)',
};

export default async function PeoplePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; treeSlug: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale, treeSlug } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('people');
  const { q } = await searchParams;
  const listing = await listPeople(treeSlug, q ?? '');
  // A tree that is private and a tree that does not exist answer identically,
  // so the existence of someone's family archive is not leaked by the
  // difference between 403 and 404.
  if (!listing) notFound();

  // The axis every life is drawn against: the span of the people shown.
  const years = listing.people.flatMap((p) =>
    p.startYear === null ? [] : [p.startYear, p.endYear ?? p.startYear],
  );
  const axis = years.length > 0 ? { from: Math.min(...years), to: Math.max(...years) } : null;

  return (
    <main id="main" className="bg-surface-0 min-h-dvh px-6 py-10">
      <div className="mx-auto flex max-w-[var(--content-max)] flex-col gap-8">
        <TreeNav
          treeSlug={treeSlug}
          treeName={listing.access.treeName}
          role={listing.access.role}
          current="people"
        />

        <div className="flex flex-wrap items-center justify-between gap-4">
          <PeopleSearch initialQuery={listing.query} />
          <p className="text-text-muted text-sm">
            {t('count', { count: listing.total })}
            {listing.truncated ? ` — ${t('shown', { count: PEOPLE_PAGE_SIZE })}` : ''}
          </p>
        </div>

        {listing.people.length === 0 ? (
          <EmptyState
            treeSlug={treeSlug}
            canEdit={listing.access.canEdit}
            canImport={can(listing.access.role, 'import')}
            filtered={Boolean(listing.query)}
          />
        ) : (
          <ul className="flex flex-col">
            {listing.people.map((person, index) => (
              <li key={person.personId}>
                <Link
                  href={`/app/${treeSlug}/personnes/${person.personId}`}
                  className="group border-border-subtle hover:bg-surface-1 flex items-center justify-between gap-4 border-b px-2 py-3 transition-colors duration-[var(--duration-fast)]"
                >
                  <span className="flex min-w-0 items-baseline gap-3">
                    <span
                      className="w-4 shrink-0 text-center text-sm"
                      style={{ color: SEX_COLOUR[person.recordedSex] ?? 'var(--sex-unknown)' }}
                      aria-hidden="true"
                    >
                      {SEX_MARK[person.recordedSex] ?? '·'}
                    </span>
                    <span
                      className={
                        person.redacted
                          ? 'text-text-muted font-editorial text-base italic'
                          : 'text-text-primary font-editorial text-base'
                      }
                    >
                      {person.displayName}
                    </span>
                  </span>

                  <span className="flex shrink-0 items-center gap-4">
                    <LifeTrack person={person} axis={axis} delay={Math.min(index, 20) * 18} />
                    <span className="tabular text-text-muted w-28 text-right text-sm">
                      {person.lifespanLabel}
                      {person.isLiving && !person.redacted ? (
                        <span className="text-source ml-2 text-xs">{t('living')}</span>
                      ) : null}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {listing.truncated ? (
          <p className="text-text-faint text-sm">
            {t('refine', { count: listing.total - PEOPLE_PAGE_SIZE })}
          </p>
        ) : null}
      </div>
    </main>
  );
}

/**
 * A life as a thin bar on the list's own time axis: the generations read as a
 * staircase down the page, and a short life stands out without a number.
 * An inferred end fades out instead of stopping, as on the timeline.
 */
function LifeTrack({
  person,
  axis,
  delay,
}: {
  person: {
    startYear: number | null;
    endYear: number | null;
    endInferred: boolean;
    recordedSex: string;
    isLiving: boolean;
  };
  axis: { from: number; to: number } | null;
  delay: number;
}) {
  if (!axis || person.startYear === null) {
    return <span className="hidden w-40 md:block" aria-hidden="true" />;
  }
  const span = Math.max(axis.to - axis.from, 1);
  const end = person.endYear ?? person.startYear;
  const left = ((person.startYear - axis.from) / span) * 100;
  const width = Math.max(((end - person.startYear) / span) * 100, 1.5);
  const colour = SEX_COLOUR[person.recordedSex] ?? 'var(--sex-unknown)';
  const open = person.endInferred || person.isLiving;
  return (
    <span
      className="bg-surface-2 relative hidden h-1.5 w-40 overflow-hidden rounded-full md:block"
      aria-hidden="true"
    >
      <span
        className="life-track absolute inset-y-0 rounded-full opacity-80 transition-opacity duration-[var(--duration-fast)] group-hover:opacity-100"
        style={{
          left: `${left}%`,
          width: `${width}%`,
          background: open ? `linear-gradient(90deg, ${colour} 60%, transparent)` : colour,
          animationDelay: `${delay}ms`,
        }}
      />
    </span>
  );
}

async function EmptyState({
  treeSlug,
  canEdit,
  canImport,
  filtered,
}: {
  treeSlug: string;
  canEdit: boolean;
  canImport: boolean;
  filtered: boolean;
}) {
  const t = await getTranslations('people');
  if (filtered) {
    return <p className="text-text-muted py-12">{t('noMatch')}</p>;
  }

  return (
    <div className="border-border-subtle flex flex-col items-start gap-4 rounded-[var(--radius-lg)] border border-dashed p-10">
      <p className="text-text-secondary">{t('empty')}</p>
      {canEdit ? (
        <div className="flex flex-wrap gap-3">
          <Link
            href={`/app/${treeSlug}/personnes/nouvelle`}
            className="bg-accent text-accent-contrast hover:bg-accent-hover rounded-[var(--radius-md)] px-4 py-2 text-sm font-medium"
          >
            {t('firstPerson')}
          </Link>
          {canImport ? (
            <Link
              href={`/app/${treeSlug}/import`}
              className="border-border-default text-text-primary hover:border-border-strong rounded-[var(--radius-md)] border px-4 py-2 text-sm"
            >
              {t('importGedcom')}
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
