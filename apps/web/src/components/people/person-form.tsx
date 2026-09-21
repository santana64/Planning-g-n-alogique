'use client';

import { useActionState, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { defaultPersonPrivacy, type PersonPrivacy } from '@chronolignee/domain';
import { useRouter } from '@/i18n/navigation';
import { IDLE, type ActionState } from '@/server/action-state';
import { createPersonAction, updatePersonAction } from '@/server/person-actions';
import type { PersonDetail } from '@/server/people';
import { Field, Select, SubmitButton, TextArea, TextInput } from './fields';

/**
 * The person form.
 *
 * Dates are free text. This is the central decision of the screen and it is
 * not laziness: a date picker cannot express "vers 1750", "entre 1801 et
 * 1803", "4 germinal an VII", or "9 br 1889" — and those are what registers
 * actually contain. The field accepts what the record says and the domain
 * parser decides what it means; anything it cannot read is kept verbatim
 * rather than dropped or rounded into a lie.
 *
 * Names are a list because one person is "Marie Lefèvre" at birth and "Marie
 * Chassagne" after marriage, and a genealogy that can only hold one of those
 * cannot find her in both halves of her life.
 */

const SEX_OPTIONS = ['UNKNOWN', 'FEMALE', 'MALE', 'INTERSEX'] as const;

const STATUS_OPTIONS = ['UNKNOWN', 'LIVING', 'DECEASED'] as const;

/**
 * Who may see this person, in the words of the people it concerns.
 *
 * The last two reach beyond the tree's own rule — publishing a living person,
 * hiding someone from the tree's own editors — and are offered only to those
 * who run the tree; the server refuses them to anyone else whatever the form
 * sends.
 */
const PRIVACY_OPTIONS: readonly PersonPrivacy[] = ['INHERIT', 'REDACTED', 'RESTRICTED', 'VISIBLE'];
const STEWARD_ONLY: ReadonlySet<PersonPrivacy> = new Set(['RESTRICTED', 'VISIBLE']);

const NAME_TYPE_OPTIONS = [
  'BIRTH',
  'MARRIED',
  'RELIGIOUS',
  'IMMIGRANT',
  'AKA',
  'NICKNAME',
  'PROFESSIONAL',
  'OTHER',
] as const;

interface NameDraft {
  readonly key: string;
  readonly type: string;
  readonly given: string;
  readonly surnamePrefix: string;
  readonly surname: string;
  readonly nickname: string;
}

function draftsFrom(person: PersonDetail | null): NameDraft[] {
  if (!person || person.names.length === 0) {
    return [{ key: 'n0', type: 'BIRTH', given: '', surnamePrefix: '', surname: '', nickname: '' }];
  }
  return person.names.map((name, index) => ({
    key: `n${index}`,
    type: name.type,
    given: name.given,
    surnamePrefix: name.surnamePrefix,
    surname: name.surname,
    nickname: name.nickname,
  }));
}

export function PersonForm({
  treeSlug,
  person,
  canSteward,
}: {
  treeSlug: string;
  person: PersonDetail | null;
  /** May publish a living person or restrict someone to the administrators. */
  canSteward: boolean;
}) {
  const t = useTranslations('personForm');
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionState, FormData>(
    person ? updatePersonAction : createPersonAction,
    IDLE,
  );
  const [names, setNames] = useState<NameDraft[]>(() => draftsFrom(person));
  const [livingStatus, setLivingStatus] = useState(person?.livingStatus ?? 'UNKNOWN');
  const [privacy, setPrivacy] = useState<PersonPrivacy>(
    person?.privacy ?? defaultPersonPrivacy(person?.livingStatus ?? 'UNKNOWN'),
  );
  // Until the author chooses, the setting follows the status: someone marked
  // as living starts hidden from outside the tree, and the form shows it.
  const [privacyChosen, setPrivacyChosen] = useState(false);
  const privacyLocked = !canSteward && STEWARD_ONLY.has(privacy);
  const privacyChoices = PRIVACY_OPTIONS.filter((value) => canSteward || !STEWARD_ONLY.has(value));
  const dateHint = t('dateHint');

  // A newly created person has no page yet, so the form navigates to the one
  // the write just produced. An edit stays where it is: being thrown somewhere
  // else after saving loses the reader's place in a long record.
  useEffect(() => {
    if (state.status === 'success' && !person && state.personId) {
      router.push(`/app/${treeSlug}/personnes/${state.personId}`);
    }
  }, [state, person, router, treeSlug]);

  const error = (field: string) => state.fieldErrors?.[field];

  return (
    <form action={action} className="flex flex-col gap-8">
      <input type="hidden" name="treeSlug" value={treeSlug} />
      {person ? <input type="hidden" name="personId" value={person.personId} /> : null}

      <section className="flex flex-col gap-4">
        <header className="flex items-baseline justify-between">
          <h2 className="font-editorial text-text-primary text-lg">{t('names')}</h2>
          <button
            type="button"
            onClick={() =>
              setNames((current) =>
                current.length >= 12
                  ? current
                  : [
                      ...current,
                      {
                        key: `n${Date.now()}`,
                        type: 'MARRIED',
                        given: '',
                        surnamePrefix: '',
                        surname: '',
                        nickname: '',
                      },
                    ],
              )
            }
            className="text-accent text-sm hover:underline"
          >
            {t('addName')}
          </button>
        </header>

        {names.map((name, index) => (
          <fieldset
            key={name.key}
            className="border-border-subtle bg-surface-1/40 flex flex-col gap-3 rounded-[var(--radius-md)] border p-4"
          >
            <legend className="text-text-faint px-1 text-xs">
              {index === 0 ? t('mainName') : t('otherName', { number: index + 1 })}
            </legend>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field id={`given-${index}`} label={t('given')} error={error(`names.${index}.given`)}>
                <TextInput
                  id={`given-${index}`}
                  name={`names.${index}.given`}
                  defaultValue={name.given}
                  placeholder={t('givenPlaceholder')}
                  error={error(`names.${index}.given`)}
                />
              </Field>

              <Field id={`surname-${index}`} label={t('surname')}>
                <TextInput
                  id={`surname-${index}`}
                  name={`names.${index}.surname`}
                  defaultValue={name.surname}
                  placeholder={t('surnamePlaceholder')}
                />
              </Field>

              <Field
                id={`surname-prefix-${index}`}
                label={t('surnamePrefix')}
                hint={t('surnamePrefixHint')}
              >
                <TextInput
                  id={`surname-prefix-${index}`}
                  name={`names.${index}.surnamePrefix`}
                  defaultValue={name.surnamePrefix}
                  placeholder={t('surnamePrefixPlaceholder')}
                  hasHint
                />
              </Field>

              <Field id={`nickname-${index}`} label={t('nickname')}>
                <TextInput
                  id={`nickname-${index}`}
                  name={`names.${index}.nickname`}
                  defaultValue={name.nickname}
                  placeholder={t('nicknamePlaceholder')}
                />
              </Field>

              <Field id={`name-type-${index}`} label={t('nameType')}>
                <Select
                  id={`name-type-${index}`}
                  name={`names.${index}.type`}
                  defaultValue={name.type}
                  options={NAME_TYPE_OPTIONS.map(
                    (value) => [value, t(`nameTypes.${value}`)] as const,
                  )}
                />
              </Field>
            </div>

            {names.length > 1 ? (
              <button
                type="button"
                onClick={() => setNames((current) => current.filter((n) => n.key !== name.key))}
                className="text-text-faint hover:text-danger self-start text-xs"
              >
                {t('removeName')}
              </button>
            ) : null}
          </fieldset>
        ))}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Field id="recordedSex" label={t('recordedSex')}>
          <Select
            id="recordedSex"
            name="recordedSex"
            defaultValue={person?.recordedSex ?? 'UNKNOWN'}
            options={SEX_OPTIONS.map((value) => [value, t(`sexes.${value}`)] as const)}
          />
        </Field>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="livingStatus" className="text-text-secondary text-sm font-medium">
            {t('status')}
          </label>
          <select
            id="livingStatus"
            name="livingStatus"
            value={livingStatus}
            onChange={(event) => {
              const next = event.target.value as typeof livingStatus;
              setLivingStatus(next);
              if (!privacyChosen && !STEWARD_ONLY.has(privacy)) {
                setPrivacy(defaultPersonPrivacy(next));
              }
            }}
            className="border-border-default bg-surface-1 text-text-primary hover:border-border-strong focus:border-accent w-full rounded-[var(--radius-md)] border px-3 py-2 transition-colors duration-[var(--duration-fast)] focus:outline-none"
          >
            {STATUS_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {t(`statuses.${value}`)}
              </option>
            ))}
          </select>
          {livingStatus === 'LIVING' ? null : (
            <p className="text-text-faint text-xs">{t('inferredLifespan')}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label htmlFor="privacy" className="text-text-secondary text-sm font-medium">
            {t('visibility')}
          </label>
          {privacyLocked ? (
            // Decided by someone who runs the tree. Sent back unchanged, so
            // saving a corrected date does not undo a choice this author
            // could not have made.
            <>
              <input type="hidden" name="privacy" value={privacy} />
              <p id="privacy" className="text-text-primary text-sm">
                {t(`privacyLabels.${privacy}`)}
                <span className="text-text-faint">{t('chosenByAdministrator')}</span>
              </p>
            </>
          ) : (
            <select
              id="privacy"
              name="privacy"
              value={privacy}
              aria-describedby="privacy-hint"
              onChange={(event) => {
                setPrivacy(event.target.value as PersonPrivacy);
                setPrivacyChosen(true);
              }}
              className="border-border-default bg-surface-1 text-text-primary hover:border-border-strong focus:border-accent w-full rounded-[var(--radius-md)] border px-3 py-2 transition-colors duration-[var(--duration-fast)] focus:outline-none"
            >
              {privacyChoices.map((value) => (
                <option key={value} value={value}>
                  {t(`privacyLabels.${value}`)}
                </option>
              ))}
            </select>
          )}
          <p id="privacy-hint" className="text-source text-xs">
            {t(`privacyHints.${privacy}`)}
          </p>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Field id="birthDate" label={t('birthDate')} hint={dateHint}>
          <TextInput
            id="birthDate"
            name="birthDate"
            defaultValue={person?.birthDateText ?? ''}
            placeholder={t('birthDatePlaceholder')}
            hasHint
          />
        </Field>

        <Field id="birthPlace" label={t('birthPlace')}>
          <TextInput
            id="birthPlace"
            name="birthPlace"
            defaultValue={person?.birthPlaceName ?? ''}
            placeholder={t('birthPlacePlaceholder')}
          />
        </Field>

        <Field id="deathDate" label={t('deathDate')} hint={dateHint}>
          <TextInput
            id="deathDate"
            name="deathDate"
            defaultValue={person?.deathDateText ?? ''}
            placeholder={t('deathDatePlaceholder')}
            hasHint
          />
        </Field>

        <Field id="deathPlace" label={t('deathPlace')}>
          <TextInput
            id="deathPlace"
            name="deathPlace"
            defaultValue={person?.deathPlaceName ?? ''}
            placeholder={t('deathPlacePlaceholder')}
          />
        </Field>
      </section>

      <Field id="notes" label={t('researchNotes')} hint={t('researchNotesHint')}>
        <TextArea id="notes" name="notes" defaultValue={person?.notes ?? ''} />
      </Field>

      {state.status !== 'idle' && state.message ? (
        <p
          role="status"
          className={`rounded-[var(--radius-md)] border px-3 py-2 text-sm ${
            state.status === 'error'
              ? 'text-danger border-danger/30 bg-danger/10'
              : 'text-success border-success/30 bg-success/10'
          }`}
        >
          {state.message}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <SubmitButton pending={pending}>{person ? t('save') : t('create')}</SubmitButton>
        {person ? <span className="text-text-faint text-xs">{t('correctionArchives')}</span> : null}
      </div>
    </form>
  );
}
