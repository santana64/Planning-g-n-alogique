'use client';

import { useActionState, useEffect, useState } from 'react';
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

const SEX_OPTIONS = [
  ['UNKNOWN', 'Non renseigné'],
  ['FEMALE', 'Féminin'],
  ['MALE', 'Masculin'],
  ['INTERSEX', 'Intersexe'],
] as const;

const STATUS_OPTIONS = [
  ['UNKNOWN', 'Inconnu'],
  ['LIVING', 'Vivante'],
  ['DECEASED', 'Décédée'],
] as const;

const NAME_TYPE_OPTIONS = [
  ['BIRTH', 'De naissance'],
  ['MARRIED', 'De mariage'],
  ['RELIGIOUS', 'De religion'],
  ['IMMIGRANT', "D'immigration"],
  ['AKA', 'Alias'],
  ['NICKNAME', 'Surnom'],
  ['PROFESSIONAL', 'Professionnel'],
  ['OTHER', 'Autre'],
] as const;

const DATE_HINT =
  'Tel que le registre l’écrit : 12 juin 1877, vers 1750, entre 1801 et 1803, 4 germinal an VII.';

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
}: {
  treeSlug: string;
  person: PersonDetail | null;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionState, FormData>(
    person ? updatePersonAction : createPersonAction,
    IDLE,
  );
  const [names, setNames] = useState<NameDraft[]>(() => draftsFrom(person));
  const [livingStatus, setLivingStatus] = useState(person?.livingStatus ?? 'UNKNOWN');

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
          <h2 className="font-editorial text-text-primary text-lg">Noms</h2>
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
            Ajouter un nom
          </button>
        </header>

        {names.map((name, index) => (
          <fieldset
            key={name.key}
            className="border-border-subtle bg-surface-1/40 flex flex-col gap-3 rounded-[var(--radius-md)] border p-4"
          >
            <legend className="text-text-faint px-1 text-xs">
              {index === 0 ? 'Nom principal — celui qui s’affiche partout' : `Nom ${index + 1}`}
            </legend>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field id={`given-${index}`} label="Prénom(s)" error={error(`names.${index}.given`)}>
                <TextInput
                  id={`given-${index}`}
                  name={`names.${index}.given`}
                  defaultValue={name.given}
                  placeholder="Jean-Baptiste"
                  error={error(`names.${index}.given`)}
                />
              </Field>

              <Field id={`surname-${index}`} label="Nom de famille">
                <TextInput
                  id={`surname-${index}`}
                  name={`names.${index}.surname`}
                  defaultValue={name.surname}
                  placeholder="Chassagne"
                />
              </Field>

              <Field
                id={`surname-prefix-${index}`}
                label="Particule"
                hint="Conservée à l’affichage, ignorée au classement : « de La Tour » se range à T."
              >
                <TextInput
                  id={`surname-prefix-${index}`}
                  name={`names.${index}.surnamePrefix`}
                  defaultValue={name.surnamePrefix}
                  placeholder="de La"
                  hasHint
                />
              </Field>

              <Field id={`nickname-${index}`} label="Surnom">
                <TextInput
                  id={`nickname-${index}`}
                  name={`names.${index}.nickname`}
                  defaultValue={name.nickname}
                  placeholder="Le Grand"
                />
              </Field>

              <Field id={`name-type-${index}`} label="Type">
                <Select
                  id={`name-type-${index}`}
                  name={`names.${index}.type`}
                  defaultValue={name.type}
                  options={NAME_TYPE_OPTIONS}
                />
              </Field>
            </div>

            {names.length > 1 ? (
              <button
                type="button"
                onClick={() => setNames((current) => current.filter((n) => n.key !== name.key))}
                className="text-text-faint hover:text-danger self-start text-xs"
              >
                Retirer ce nom
              </button>
            ) : null}
          </fieldset>
        ))}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Field id="recordedSex" label="Sexe inscrit à l’état civil">
          <Select
            id="recordedSex"
            name="recordedSex"
            defaultValue={person?.recordedSex ?? 'UNKNOWN'}
            options={SEX_OPTIONS}
          />
        </Field>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="livingStatus" className="text-text-secondary text-sm font-medium">
            Statut
          </label>
          <select
            id="livingStatus"
            name="livingStatus"
            value={livingStatus}
            onChange={(event) => setLivingStatus(event.target.value as typeof livingStatus)}
            className="border-border-default bg-surface-1 text-text-primary hover:border-border-strong focus:border-accent w-full rounded-[var(--radius-md)] border px-3 py-2 transition-colors duration-[var(--duration-fast)] focus:outline-none"
          >
            {STATUS_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {livingStatus === 'LIVING' ? (
            <p className="text-source text-xs">
              Masquée pour toute personne extérieure à cet arbre : nom, dates et lieux.
            </p>
          ) : (
            <p className="text-text-faint text-xs">
              Sans date de décès, une durée de vie maximale de 123 ans borne la fiche. Cette borne
              est déduite, jamais enregistrée.
            </p>
          )}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Field id="birthDate" label="Date de naissance" hint={DATE_HINT}>
          <TextInput
            id="birthDate"
            name="birthDate"
            defaultValue={person?.birthDateText ?? ''}
            placeholder="12 juin 1877"
            hasHint
          />
        </Field>

        <Field id="birthPlace" label="Lieu de naissance">
          <TextInput
            id="birthPlace"
            name="birthPlace"
            defaultValue={person?.birthPlaceName ?? ''}
            placeholder="Tours, Indre-et-Loire, France"
          />
        </Field>

        <Field id="deathDate" label="Date de décès" hint={DATE_HINT}>
          <TextInput
            id="deathDate"
            name="deathDate"
            defaultValue={person?.deathDateText ?? ''}
            placeholder="vers 1910"
            hasHint
          />
        </Field>

        <Field id="deathPlace" label="Lieu de décès">
          <TextInput
            id="deathPlace"
            name="deathPlace"
            defaultValue={person?.deathPlaceName ?? ''}
            placeholder="Paris, France"
          />
        </Field>
      </section>

      <Field
        id="notes"
        label="Notes de recherche"
        hint="Ce que vous cherchez encore, ce dont vous doutez, où vous avez déjà regardé."
      >
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
        <SubmitButton pending={pending}>
          {person ? 'Enregistrer' : 'Créer la personne'}
        </SubmitButton>
        {person ? (
          <span className="text-text-faint text-xs">
            Une date corrigée archive la précédente au lieu de l’écraser.
          </span>
        ) : null}
      </div>
    </form>
  );
}
