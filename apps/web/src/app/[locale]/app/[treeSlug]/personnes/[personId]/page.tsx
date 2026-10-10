import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { can } from '@chronolignee/domain';
import { Link } from '@/i18n/navigation';
import { features } from '@/lib/env';
import { loadPersonPhotos } from '@/server/media';
import { loadEpoch } from '@/server/epoch';
import { Epoch } from '@/components/people/epoch';
import { findingMessage, severityLabel } from '@/lib/finding-messages';
import { loadPersonDetail } from '@/server/people';
import { DeletePerson } from '@/components/people/delete-person';
import { EventEditor } from '@/components/people/event-editor';
import { ProposalReview } from '@/components/ai/proposal-review';
import { getAIStatus } from '@/server/ai';
import { loadPendingForPerson } from '@/server/proposals';
import { loadPersonHistory } from '@/server/history';
import { HistoryList } from '@/components/history/history-list';
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

  const t = await getTranslations('person');
  const findings = await getTranslations('findings');
  const eventTypes = await getTranslations('events');
  const eventName = (type: string) => (eventTypes.has(type) ? eventTypes(type) : type);

  const { access } = person;
  const ai = getAIStatus();
  // From the permission table, as the actions check it: a contributor adds
  // and corrects but is never offered a removal the server would refuse.
  const canEdit = access.canEdit && !person.redacted;
  const canDelete = can(access.role, 'delete') && !person.redacted;
  const proposals = person.redacted ? [] : await loadPendingForPerson(access, person.personId);
  // Members only, and never for someone this reader may not see.
  const history =
    person.redacted || access.role === null ? [] : await loadPersonHistory(access, person.personId);
  const photos = person.redacted ? [] : await loadPersonPhotos(access, person.personId);
  const portrait = photos[0] ?? null;
  // Never for a protected person: the events of their life would date it.
  const epoch = person.redacted ? [] : await loadEpoch(access, person.personId);
  const ageAtDeath = ageBetween(person.birthLabel, person.deathLabel);

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
            href={`/app/${treeSlug}/personnes`}
            className="text-text-faint hover:text-accent text-sm"
          >
            ← {t('allPeople')}
          </Link>
          <div className="flex items-center gap-4">
            {portrait ? (
              <Link
                href={`/app/${treeSlug}/photos/${portrait.mediaId}`}
                className="ring-border-default hover:ring-accent block h-16 w-16 shrink-0 overflow-hidden rounded-full ring-2 transition-shadow duration-[var(--duration-fast)]"
              >
                <img
                  src={`/api/trees/${treeSlug}/media/${portrait.mediaId}?variant=thumbnail`}
                  alt={t('portrait', { name: person.displayName })}
                  className="h-full w-full object-cover"
                />
              </Link>
            ) : null}
            <div className="flex flex-col gap-0.5">
              <h1 className="font-editorial text-text-primary flex items-center gap-3 text-3xl tracking-tight">
                {/* The colour of their life on the timeline, as a mark. */}
                <span
                  aria-hidden="true"
                  className="inline-block h-7 w-1.5 rounded-full"
                  style={{ background: SEX_ACCENT[person.recordedSex] ?? 'var(--sex-unknown)' }}
                />
                {person.displayName}
              </h1>
              <p className="tabular text-text-muted">
                {person.birthLabel} — {person.deathLabel}
                {ageAtDeath !== null ? (
                  <span className="text-text-faint ml-3 text-sm">
                    {t('ageAtDeath', { age: ageAtDeath })}
                  </span>
                ) : null}
              </p>
            </div>
          </div>
          {person.privacy && person.privacy !== 'INHERIT' ? (
            <p className="text-source text-xs">{t(`privacy.${person.privacy}`)}</p>
          ) : null}
          {/* Two sources disagreeing is research information, not a glitch to
           * paper over. The accepted claim wins, and the page says what the
           * event on the form still records. */}
          {person.birthFromClaim &&
          person.birthDateText &&
          person.birthDateText !== person.birthLabel ? (
            <p className="text-text-faint text-xs">
              {t('birthFromClaim', { date: person.birthDateText })}
            </p>
          ) : null}
          {person.deathFromClaim &&
          person.deathDateText &&
          person.deathDateText !== person.deathLabel ? (
            <p className="text-text-faint text-xs">
              {t('deathFromClaim', { date: person.deathDateText })}
            </p>
          ) : null}
          <p className="mt-1 flex gap-4">
            <Link
              href={`/app/${treeSlug}/personnes/${person.personId}/ascendance`}
              className="text-accent text-sm hover:underline"
            >
              {t('ancestry')} →
            </Link>
            <Link
              href={`/app/${treeSlug}/personnes/${person.personId}/descendance`}
              className="text-accent text-sm hover:underline"
            >
              {t('descendants')} →
            </Link>
            {features.temporalDepth ? (
              <Link
                href={`/app/${treeSlug}/personnes/${person.personId}/eventail`}
                className="text-accent text-sm hover:underline"
              >
                {t('temporalFan')} →
              </Link>
            ) : null}
            <Link
              href={`/app/${treeSlug}/personnes/${person.personId}/recit`}
              className="text-accent text-sm hover:underline"
            >
              {t('followTheLine')} →
            </Link>
          </p>
        </div>

        {/* Above everything else on the page, because a pending proposal is
         * a decision waiting on the reader, and the rest of the record may be
         * about to change because of it. */}
        {proposals.length > 0 ? (
          <section
            aria-labelledby="proposals-heading"
            className="border-source/30 flex flex-col gap-3 rounded-[var(--radius-lg)] border p-4"
          >
            <h2 id="proposals-heading" className="text-source text-xs tracking-wide uppercase">
              {t('proposalsHeading', { count: proposals.length })}
            </h2>
            <p className="text-text-muted text-sm">{t('proposalsLead')}</p>
            <ProposalReview treeSlug={treeSlug} rows={proposals} showSubject={false} />
          </section>
        ) : null}

        {person.redacted ? (
          <p className="border-source/30 bg-source/10 text-source rounded-[var(--radius-md)] border px-4 py-3">
            {t('protected')}
          </p>
        ) : null}

        {photos.length > 0 ? (
          <section aria-labelledby="photos-title" className="flex flex-col gap-2">
            <h2 id="photos-title" className="text-text-faint text-xs tracking-wide uppercase">
              {t('photos', { count: photos.length })}
            </h2>
            <ul className="flex gap-3 overflow-x-auto pb-1">
              {photos.map((photo) => (
                <li key={photo.mediaId} className="shrink-0">
                  <Link
                    href={`/app/${treeSlug}/photos/${photo.mediaId}`}
                    className="group border-border-subtle bg-surface-sunken block h-28 overflow-hidden rounded-[var(--radius-md)] border"
                  >
                    <img
                      src={`/api/trees/${treeSlug}/media/${photo.mediaId}?variant=thumbnail`}
                      alt={photo.title}
                      loading="lazy"
                      className="h-full w-auto transition-transform duration-[var(--duration-slow)] group-hover:scale-[1.05]"
                    />
                  </Link>
                  {photo.captured ? (
                    <p className="text-text-faint mt-1 text-[11px]">{photo.captured}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {person.findings.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-text-faint text-xs tracking-wide uppercase">{t('whatDatesSay')}</h2>
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
                    {severityLabel(findings, finding.severity)}
                  </span>
                  <span>{findingMessage(findings, finding, eventName)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="grid gap-12 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <section className="flex flex-col gap-6">
            <h2 className="text-text-faint text-xs tracking-wide uppercase">{t('record')}</h2>
            {canEdit ? (
              <PersonForm
                treeSlug={treeSlug}
                person={person}
                canSteward={can(access.role, 'setPersonPrivacy')}
              />
            ) : (
              <ReadOnlyPerson
                birthLabel={person.birthLabel}
                deathLabel={person.deathLabel}
                notes={person.notes}
              />
            )}

            {canDelete ? (
              <DeletePerson
                treeSlug={treeSlug}
                personId={person.personId}
                name={person.displayName}
              />
            ) : null}
          </section>

          <div className="flex flex-col gap-10">
            <section className="flex flex-col gap-4">
              <h2 className="text-text-faint text-xs tracking-wide uppercase">{t('links')}</h2>
              <RelationshipEditor
                treeSlug={treeSlug}
                personId={person.personId}
                personName={person.displayName}
                links={person.links}
                canEdit={canEdit}
                canDelete={canDelete}
              />
            </section>

            <section className="flex flex-col gap-3">
              <h2 className="text-text-faint text-xs tracking-wide uppercase">{t('events')}</h2>
              <EventEditor
                treeSlug={treeSlug}
                personId={person.personId}
                events={person.events}
                canEdit={canEdit}
                canDelete={canDelete}
                ai={ai}
              />
            </section>

            <Epoch events={epoch} name={person.displayName} />

            {history.length > 0 ? (
              <section aria-labelledby="record-history" className="flex flex-col gap-3">
                <h2 id="record-history" className="text-text-faint text-xs tracking-wide uppercase">
                  {t('recordHistory')}
                </h2>
                <HistoryList treeSlug={treeSlug} lines={history} linkPeople={false} />
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}

const SEX_ACCENT: Record<string, string> = {
  FEMALE: 'var(--sex-female)',
  MALE: 'var(--sex-male)',
  INTERSEX: 'var(--sex-other)',
  UNKNOWN: 'var(--sex-unknown)',
};

/**
 * The age at death, only when both ends carry a four-digit year and nothing
 * else could make it ambiguous ("vers", "avant", a range). A number shown
 * beside a name is read as a fact, so it is shown only when it is one, to
 * within a year.
 */
function ageBetween(birth: string, death: string): number | null {
  const plain = /^(?:\d{1,2}(?:er)?\s+\S+\s+)?(\d{4})$/u;
  const b = plain.exec(birth.trim());
  const d = plain.exec(death.trim());
  if (!b?.[1] || !d?.[1]) return null;
  const age = Number(d[1]) - Number(b[1]);
  return age >= 0 && age < 125 ? age : null;
}

async function ReadOnlyPerson({
  birthLabel,
  deathLabel,
  notes,
}: {
  birthLabel: string;
  deathLabel: string;
  notes: string;
}) {
  const t = await getTranslations('person');
  return (
    <dl className="flex flex-col gap-3">
      <div className="flex gap-4">
        <dt className="text-text-faint w-32 text-sm">{t('birth')}</dt>
        <dd className="text-text-primary tabular text-sm">{birthLabel}</dd>
      </div>
      <div className="flex gap-4">
        <dt className="text-text-faint w-32 text-sm">{t('death')}</dt>
        <dd className="text-text-primary tabular text-sm">{deathLabel}</dd>
      </div>
      {notes ? (
        <div className="flex gap-4">
          <dt className="text-text-faint w-32 text-sm">{t('notes')}</dt>
          <dd className="text-text-secondary text-sm whitespace-pre-wrap">{notes}</dd>
        </div>
      ) : null}
    </dl>
  );
}
