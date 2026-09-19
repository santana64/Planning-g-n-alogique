import { notFound } from 'next/navigation';
import { can } from '@chronolignee/domain';
import { setRequestLocale } from 'next-intl/server';
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

export default async function PeoplePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; treeSlug: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale, treeSlug } = await params;
  setRequestLocale(locale);

  const { q } = await searchParams;
  const listing = await listPeople(treeSlug, q ?? '');
  // A tree that is private and a tree that does not exist answer identically,
  // so the existence of someone's family archive is not leaked by the
  // difference between 403 and 404.
  if (!listing) notFound();

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
            {listing.total === 0
              ? 'Personne'
              : listing.total === 1
                ? '1 personne'
                : `${listing.total} personnes`}
            {listing.truncated ? ` — ${PEOPLE_PAGE_SIZE} affichées` : ''}
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
            {listing.people.map((person) => (
              <li key={person.personId}>
                <Link
                  href={`/app/${treeSlug}/personnes/${person.personId}`}
                  className="border-border-subtle hover:bg-surface-1 flex items-baseline justify-between gap-4 border-b px-2 py-3 transition-colors duration-[var(--duration-fast)]"
                >
                  <span className="flex items-baseline gap-3">
                    <span className="text-text-faint w-4 text-center text-sm" aria-hidden="true">
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

                  <span className="tabular text-text-muted text-sm">
                    {person.lifespanLabel}
                    {person.isLiving && !person.redacted ? (
                      <span className="text-source ml-2 text-xs">vivante</span>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {listing.truncated ? (
          <p className="text-text-faint text-sm">
            Affinez la recherche pour voir les {listing.total - PEOPLE_PAGE_SIZE} autres.
          </p>
        ) : null}
      </div>
    </main>
  );
}

function EmptyState({
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
  if (filtered) {
    return <p className="text-text-muted py-12">Aucun nom ne correspond.</p>;
  }

  return (
    <div className="border-border-subtle flex flex-col items-start gap-4 rounded-[var(--radius-lg)] border border-dashed p-10">
      <p className="text-text-secondary">Cet arbre est vide.</p>
      {canEdit ? (
        <div className="flex flex-wrap gap-3">
          <Link
            href={`/app/${treeSlug}/personnes/nouvelle`}
            className="bg-accent text-accent-contrast hover:bg-accent-hover rounded-[var(--radius-md)] px-4 py-2 text-sm font-medium"
          >
            Saisir la première personne
          </Link>
          {canImport ? (
            <Link
              href={`/app/${treeSlug}/import`}
              className="border-border-default text-text-primary hover:border-border-strong rounded-[var(--radius-md)] border px-4 py-2 text-sm"
            >
              Importer un GEDCOM
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
