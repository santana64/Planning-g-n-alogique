import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { agreeingSignals } from '@/lib/duplicate-signals';
import { EVENT_LABELS, RELATIONSHIP_LABELS } from '@/lib/labels';
import { loadDuplicateComparison } from '@/server/duplicates';
import { DuplicateDismissButton } from '@/components/duplicates/duplicate-dismiss';
import { DuplicateMergeButton } from '@/components/duplicates/duplicate-merge';
import { TreeNav } from '@/components/people/tree-nav';
import type { PersonDetail } from '@/server/people';

/** Dynamic: it reads the database on every request. */
export const dynamic = 'force-dynamic';

/** What a record shows where it has no date: said in words here. */
const NO_DATE = '—';

function fullName(name: PersonDetail['names'][number]): string {
  return [name.prefix, name.given, name.surnamePrefix, name.surname, name.suffix]
    .filter((part) => part !== '')
    .join(' ');
}

/**
 * One record, told the way its own page tells it.
 *
 * Everything the merge would move is listed — events, links, other names —
 * because the reader is being asked to retire one of the two columns, and
 * the only honest way to ask is to show what each one holds.
 */
function PersonColumn({ person }: { person: PersonDetail }) {
  const others = person.names.filter((name) => !name.isPreferred);
  return (
    <section
      aria-label={person.displayName}
      className="border-border-subtle flex flex-col gap-4 rounded-[var(--radius-lg)] border p-5"
    >
      <div className="flex flex-col gap-1">
        <h2 className="font-editorial text-text-primary text-xl tracking-tight">
          <Link href={`/app/${person.access.treeSlug}/personnes/${person.personId}`}>
            {person.displayName}
          </Link>
        </h2>
        <p className="text-text-faint text-xs">
          {person.birthLabel === NO_DATE
            ? 'naissance inconnue'
            : `naissance : ${person.birthLabel}`}
          {' · '}
          {person.deathLabel === NO_DATE ? 'décès inconnu' : `décès : ${person.deathLabel}`}
        </p>
      </div>

      {others.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h3 className="text-text-muted text-xs tracking-wide uppercase">Autres noms</h3>
          <ul className="text-text-primary flex flex-col gap-0.5 text-sm">
            {others.map((name, index) => (
              <li key={`${name.type}-${index}`}>{fullName(name)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <h3 className="text-text-muted text-xs tracking-wide uppercase">Événements</h3>
        {person.events.length === 0 ? (
          <p className="text-text-faint text-sm">Aucun.</p>
        ) : (
          <ul className="text-text-primary flex flex-col gap-0.5 text-sm">
            {person.events.map((event) => (
              <li key={event.eventId}>
                {EVENT_LABELS[event.type] ?? event.label}
                {event.dateLabel ? ` — ${event.dateLabel}` : ''}
                {event.placeName ? `, ${event.placeName}` : ''}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="text-text-muted text-xs tracking-wide uppercase">Liens</h3>
        {person.links.length === 0 ? (
          <p className="text-text-faint text-sm">Aucun.</p>
        ) : (
          <ul className="text-text-primary flex flex-col gap-0.5 text-sm">
            {person.links.map((link) => (
              <li key={link.relationshipId}>
                {RELATIONSHIP_LABELS[link.type] ?? link.type} : {link.otherName}
              </li>
            ))}
          </ul>
        )}
      </div>

      {person.notes ? (
        <div className="flex flex-col gap-1">
          <h3 className="text-text-muted text-xs tracking-wide uppercase">Notes</h3>
          <p className="text-text-primary text-sm whitespace-pre-line">{person.notes}</p>
        </div>
      ) : null}
    </section>
  );
}

export default async function ComparaisonPage({
  params,
}: {
  params: Promise<{ locale: string; treeSlug: string; candidateId: string }>;
}) {
  const { locale, treeSlug, candidateId } = await params;
  setRequestLocale(locale);

  const comparison = await loadDuplicateComparison(treeSlug, candidateId);
  // Unknown pair, closed pair, or a pair naming someone this reader may not
  // see: the same answer in every case.
  if (!comparison) notFound();

  const { left, right } = comparison;
  const signals = agreeingSignals(comparison.signals);

  return (
    <main id="main" className="bg-surface-0 min-h-dvh px-6 py-10">
      <div className="mx-auto flex max-w-[var(--content-max)] flex-col gap-8">
        <TreeNav
          treeSlug={treeSlug}
          treeName={comparison.access.treeName}
          role={comparison.access.role}
          current="duplicates"
        />

        <div className="flex flex-col gap-2">
          {/* Non-breaking space before the question mark, as French sets it:
              on a phone the heading wrapped and left the "?" on its own line. */}
          <h1 className="font-editorial text-text-primary text-3xl tracking-tight">
            Une même personne&nbsp;?
          </h1>
          <p className="text-text-muted max-w-2xl text-sm">
            {Math.round(comparison.score * 100)} % de rapprochement
            {signals.length > 0 ? ` — concordent : ${signals.join(', ')}` : ''}. Le score dit
            seulement ce qui se ressemble ; la décision vous revient.
          </p>
          <p className="text-text-faint max-w-2xl text-xs">
            Fusionner conserve tout : les deux dates de naissance restent, l’une et l’autre, sur la
            fiche gardée. La fiche fusionnée n’est pas effacée, elle est retirée de l’arbre et
            l’historique garde trace de l’opération.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <PersonColumn person={left} />
          <PersonColumn person={right} />
        </div>

        <div className="border-border-subtle flex flex-wrap items-start gap-4 border-t pt-6">
          {comparison.canMerge ? (
            <>
              <DuplicateMergeButton
                treeSlug={treeSlug}
                keepId={left.personId}
                mergeId={right.personId}
                keptName={left.displayName}
                mergedName={right.displayName}
                label={`Garder « ${left.displayName} » (à gauche)`}
              />
              <DuplicateMergeButton
                treeSlug={treeSlug}
                keepId={right.personId}
                mergeId={left.personId}
                keptName={right.displayName}
                mergedName={left.displayName}
                label={`Garder « ${right.displayName} » (à droite)`}
              />
            </>
          ) : (
            <p className="text-text-muted text-sm">
              Fusionner retire une fiche de l’arbre : seuls les responsables peuvent le faire.
            </p>
          )}
          <DuplicateDismissButton treeSlug={treeSlug} candidateId={comparison.candidateId} />
        </div>
      </div>
    </main>
  );
}
