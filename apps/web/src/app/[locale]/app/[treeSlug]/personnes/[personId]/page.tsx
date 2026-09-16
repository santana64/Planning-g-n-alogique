import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { SEVERITY_LABELS, findingMessage } from '@/lib/finding-messages';
import { loadPersonDetail } from '@/server/people';
import { DeletePerson } from '@/components/people/delete-person';
import { EventEditor } from '@/components/people/event-editor';
import { PersonForm } from '@/components/people/person-form';
import { RelationshipEditor } from '@/components/people/relationship-editor';
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

export default async function PersonPage({
  params,
}: {
  params: Promise<{ locale: string; treeSlug: string; personId: string }>;
}) {
  const { locale, treeSlug, personId } = await params;
  setRequestLocale(locale);

  const person = await loadPersonDetail(treeSlug, personId);
  if (!person) notFound();

  const { access } = person;

  return (
    <main id="main" className="bg-surface-0 min-h-dvh px-6 py-10">
      <div className="mx-auto flex max-w-[var(--content-max)] flex-col gap-8">
        <TreeNav
          treeSlug={treeSlug}
          treeName={access.treeName}
          canEdit={access.canEdit}
          current="people"
        />

        <div className="flex flex-col gap-1">
          <Link
            href={`/app/${treeSlug}/personnes`}
            className="text-text-faint hover:text-accent text-sm"
          >
            ← Toutes les personnes
          </Link>
          <h1 className="font-editorial text-text-primary text-3xl tracking-tight">
            {person.displayName}
          </h1>
          <p className="tabular text-text-muted">
            {person.birthLabel} — {person.deathLabel}
          </p>
          <p className="mt-1 flex gap-4">
            <Link
              href={`/app/${treeSlug}/personnes/${person.personId}/ascendance`}
              className="text-accent text-sm hover:underline"
            >
              Ascendance →
            </Link>
            <Link
              href={`/app/${treeSlug}/personnes/${person.personId}/descendance`}
              className="text-accent text-sm hover:underline"
            >
              Descendance →
            </Link>
          </p>
        </div>

        {person.redacted ? (
          <p className="border-source/30 bg-source/10 text-source rounded-[var(--radius-md)] border px-4 py-3">
            Cette personne est vivante. Ses données sont protégées et ne sont pas publiées.
          </p>
        ) : null}

        {person.findings.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-text-faint text-xs tracking-wide uppercase">
              Ce que les dates disent
            </h2>
            <ul className="flex flex-col gap-1.5">
              {person.findings.map((finding, index) => (
                <li
                  key={`${finding.code}-${index}`}
                  className={`flex items-baseline gap-3 rounded-[var(--radius-md)] border px-3 py-2 text-sm ${
                    finding.severity === 'ERROR'
                      ? 'text-danger border-danger/30 bg-danger/10'
                      : finding.severity === 'WARNING'
                        ? 'text-warning border-warning/30 bg-warning/10'
                        : 'text-text-muted border-border-subtle'
                  }`}
                >
                  <span className="shrink-0 text-xs tracking-wide uppercase">
                    {SEVERITY_LABELS[finding.severity]}
                  </span>
                  <span>{findingMessage(finding)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="grid gap-12 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <section className="flex flex-col gap-6">
            <h2 className="text-text-faint text-xs tracking-wide uppercase">Fiche</h2>
            {access.canEdit && !person.redacted ? (
              <PersonForm treeSlug={treeSlug} person={person} />
            ) : (
              <ReadOnlyPerson
                birthLabel={person.birthLabel}
                deathLabel={person.deathLabel}
                notes={person.notes}
              />
            )}

            {access.canEdit ? (
              <DeletePerson
                treeSlug={treeSlug}
                personId={person.personId}
                name={person.displayName}
              />
            ) : null}
          </section>

          <div className="flex flex-col gap-10">
            <section className="flex flex-col gap-4">
              <h2 className="text-text-faint text-xs tracking-wide uppercase">Liens</h2>
              <RelationshipEditor
                treeSlug={treeSlug}
                personId={person.personId}
                personName={person.displayName}
                links={person.links}
                canEdit={access.canEdit && !person.redacted}
              />
            </section>

            <section className="flex flex-col gap-3">
              <h2 className="text-text-faint text-xs tracking-wide uppercase">Événements</h2>
              <EventEditor
                treeSlug={treeSlug}
                personId={person.personId}
                events={person.events}
                canEdit={access.canEdit && !person.redacted}
              />
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}

function ReadOnlyPerson({
  birthLabel,
  deathLabel,
  notes,
}: {
  birthLabel: string;
  deathLabel: string;
  notes: string;
}) {
  return (
    <dl className="flex flex-col gap-3">
      <div className="flex gap-4">
        <dt className="text-text-faint w-32 text-sm">Naissance</dt>
        <dd className="text-text-primary tabular text-sm">{birthLabel}</dd>
      </div>
      <div className="flex gap-4">
        <dt className="text-text-faint w-32 text-sm">Décès</dt>
        <dd className="text-text-primary tabular text-sm">{deathLabel}</dd>
      </div>
      {notes ? (
        <div className="flex gap-4">
          <dt className="text-text-faint w-32 text-sm">Notes</dt>
          <dd className="text-text-secondary text-sm whitespace-pre-wrap">{notes}</dd>
        </div>
      ) : null}
    </dl>
  );
}
