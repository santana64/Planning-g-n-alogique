'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from '@/i18n/navigation';
import { IDLE, type ActionState } from '@/server/action-state';
import { createSourceAction } from '@/server/evidence-actions';
import { Field, Select, SubmitButton, TextArea, TextInput } from '@/components/people/fields';

/**
 * Recording a source.
 *
 * The call number is given more room than the title, and that is deliberate.
 * A title says what the document is; the call number is what lets the next
 * researcher — or the same one in five years — walk into the reading room and
 * ask for it. Genealogy software that treats it as an afterthought produces
 * trees nobody can check.
 */

const SOURCE_TYPE_OPTIONS = [
  ['CIVIL_REGISTER', 'État civil'],
  ['PARISH_REGISTER', 'Registre paroissial'],
  ['CENSUS', 'Recensement'],
  ['MILITARY_RECORD', 'Registre militaire'],
  ['NOTARIAL_ACT', 'Acte notarié'],
  ['NEWSPAPER', 'Presse'],
  ['CEMETERY', 'Cimetière'],
  ['BOOK', 'Ouvrage'],
  ['WEBSITE', 'Site web'],
  ['DATABASE', 'Base de données'],
  ['PHOTOGRAPH', 'Photographie'],
  ['LETTER', 'Correspondance'],
  ['ORAL_HISTORY', 'Témoignage oral'],
  ['DNA', 'ADN'],
  ['OTHER', 'Autre'],
] as const;

const RELIABILITY_OPTIONS = [
  ['VERY_HIGH', 'Acte original consulté'],
  ['HIGH', 'Copie fiable'],
  ['MEDIUM', 'Vraisemblable'],
  ['LOW', 'Incertain'],
  ['VERY_LOW', 'Hypothèse'],
] as const;

export function SourceForm({ treeSlug }: { treeSlug: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionState, FormData>(createSourceAction, IDLE);

  // In an effect, not the render body: refreshing is a side effect on the
  // router, and doing it during render makes React re-enter mid-commit.
  useEffect(() => {
    if (state.status === 'success') router.refresh();
  }, [state, router]);

  return (
    <form
      action={action}
      className="border-border-subtle bg-surface-1/40 flex flex-col gap-4 rounded-[var(--radius-md)] border p-4"
    >
      <input type="hidden" name="treeSlug" value={treeSlug} />
      <h2 className="font-editorial text-text-primary text-base">Ajouter une source</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="source-title" label="Titre">
          <TextInput
            id="source-title"
            name="title"
            placeholder="Registre paroissial de Tours, 1700-1720"
          />
        </Field>

        <Field id="source-type" label="Nature">
          <Select
            id="source-type"
            name="type"
            defaultValue="PARISH_REGISTER"
            options={SOURCE_TYPE_OPTIONS}
          />
        </Field>

        <Field
          id="source-call-number"
          label="Cote"
          hint="Ce qui permet de redemander le document au dépôt. Le champ le plus utile de cette fiche."
        >
          <TextInput
            id="source-call-number"
            name="callNumber"
            placeholder="6 NUM 7/261/003"
            hasHint
          />
        </Field>

        <Field id="source-repository" label="Dépôt">
          <TextInput
            id="source-repository"
            name="repository"
            placeholder="Archives départementales d’Indre-et-Loire"
          />
        </Field>

        <Field id="source-url" label="Adresse en ligne">
          <TextInput id="source-url" name="url" placeholder="https://archives.touraine.fr/…" />
        </Field>

        <Field id="source-reliability" label="Fiabilité">
          <Select
            id="source-reliability"
            name="reliability"
            defaultValue="MEDIUM"
            options={RELIABILITY_OPTIONS}
          />
        </Field>
      </div>

      <Field id="source-notes" label="Notes">
        <TextArea id="source-notes" name="notes" rows={2} />
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

      <SubmitButton pending={pending}>Ajouter la source</SubmitButton>
    </form>
  );
}
