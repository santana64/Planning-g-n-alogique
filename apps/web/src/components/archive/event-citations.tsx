'use client';

import { useActionState, useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { IDLE, type ActionState } from '@/server/action-state';
import {
  createCitationAction,
  deleteCitationAction,
  listSourcesAction,
  type SourceChoice,
} from '@/server/evidence-actions';
import type { EventCitation } from '@/server/archive';
import { Field, Select, SubmitButton, TextArea, TextInput } from '@/components/people/fields';

/**
 * What one event rests on.
 *
 * Placed on the event rather than on the person, because that is the grain at
 * which evidence actually works: a register page proves a baptism, not a whole
 * life. Attaching sources to people is how genealogies end up with a list of
 * archives at the bottom of a page and no way to tell which fact came from
 * which.
 *
 * An event with nothing attached says so plainly. Not an error — most facts
 * start unsourced — but the gap should be visible without hunting for it.
 */

const CONFIDENCE_OPTIONS = [
  ['VERY_HIGH', 'Acte original consulté'],
  ['HIGH', 'Source fiable'],
  ['MEDIUM', 'Vraisemblable'],
  ['LOW', 'Incertain'],
  ['VERY_LOW', 'Hypothèse'],
] as const;

export function EventCitations({
  treeSlug,
  eventId,
  eventLabel,
  citations,
  canEdit,
}: {
  treeSlug: string;
  eventId: string;
  eventLabel: string;
  citations: readonly EventCitation[];
  canEdit: boolean;
}) {
  const [createState, createAction, creating] = useActionState<ActionState, FormData>(
    createCitationAction,
    IDLE,
  );
  const [, deleteAction] = useActionState<ActionState, FormData>(deleteCitationAction, IDLE);
  const [adding, setAdding] = useState(false);
  const [sources, setSources] = useState<readonly SourceChoice[]>([]);

  useEffect(() => {
    if (!adding) return;
    void listSourcesAction(treeSlug).then(setSources);
  }, [adding, treeSlug]);

  return (
    <div className="flex flex-col gap-1.5 pl-4">
      {citations.length === 0 ? (
        <p className="text-text-faint text-xs">Aucune source pour cet événement.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {citations.map((citation) => (
            <li key={citation.citationId} className="flex flex-col gap-0.5">
              <span className="flex flex-wrap items-baseline gap-2">
                <span className="text-text-secondary text-xs">{citation.sourceTitle}</span>
                {/* The locator is the part another researcher needs. A source
                 * without one is a building, not evidence. */}
                {citation.locator ? (
                  <span className="text-source text-xs">{citation.locator}</span>
                ) : null}
                {citation.page ? (
                  <span className="text-text-faint text-xs">p. {citation.page}</span>
                ) : null}
                {citation.callNumber ? (
                  <span className="text-text-faint text-xs">Cote {citation.callNumber}</span>
                ) : null}
                {citation.documentId ? (
                  <a
                    href={`/api/trees/${treeSlug}/documents/${citation.documentId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent text-xs hover:underline"
                  >
                    document
                  </a>
                ) : null}
                {canEdit ? (
                  <form action={deleteAction} className="inline">
                    <input type="hidden" name="treeSlug" value={treeSlug} />
                    <input type="hidden" name="citationId" value={citation.citationId} />
                    <button type="submit" className="text-text-faint hover:text-danger text-xs">
                      retirer
                    </button>
                  </form>
                ) : null}
              </span>
              {citation.quotation ? (
                // Verbatim, in quotation marks. A paraphrase in this field is
                // the researcher's reading presented as the register's words.
                <q className="text-text-muted border-border-subtle border-l pl-2 text-xs italic">
                  {citation.quotation}
                </q>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canEdit && !adding ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-accent self-start text-xs hover:underline"
        >
          Citer une source
        </button>
      ) : null}

      {canEdit && adding ? (
        <form
          action={createAction}
          className="border-border-subtle bg-surface-1/40 mt-1 flex flex-col gap-3 rounded-[var(--radius-md)] border p-3"
        >
          <input type="hidden" name="treeSlug" value={treeSlug} />
          <input type="hidden" name="eventId" value={eventId} />
          <p className="text-text-faint text-xs">Source de : {eventLabel}</p>

          {sources.length === 0 ? (
            <p className="text-text-muted text-xs">
              Aucune source enregistrée.{' '}
              <Link href={`/app/${treeSlug}/archives`} className="text-accent hover:underline">
                En ajouter une
              </Link>{' '}
              d’abord.
            </p>
          ) : (
            <>
              <Field id={`cit-source-${eventId}`} label="Source">
                <Select
                  id={`cit-source-${eventId}`}
                  name="sourceId"
                  options={sources.map(
                    (source) =>
                      [
                        source.sourceId,
                        source.callNumber ? `${source.title} — ${source.callNumber}` : source.title,
                      ] as const,
                  )}
                />
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  id={`cit-locator-${eventId}`}
                  label="Où exactement"
                  hint="Vue 118, acte 7, folio 24 — ce qui permet de retrouver le passage."
                >
                  <TextInput
                    id={`cit-locator-${eventId}`}
                    name="locator"
                    placeholder="vue 118, acte 7"
                    hasHint
                  />
                </Field>

                <Field id={`cit-confidence-${eventId}`} label="Certitude">
                  <Select
                    id={`cit-confidence-${eventId}`}
                    name="confidence"
                    defaultValue="HIGH"
                    options={CONFIDENCE_OPTIONS}
                  />
                </Field>
              </div>

              <Field
                id={`cit-quote-${eventId}`}
                label="Transcription"
                hint="Les mots du registre, tels quels. Pas votre lecture de ce qu’ils veulent dire."
              >
                <TextArea
                  id={`cit-quote-${eventId}`}
                  name="quotation"
                  rows={2}
                  placeholder="« … est né le douzième jour de juin mil huit cent vingt-deux … »"
                />
              </Field>
            </>
          )}

          {/* The form stays open after a save rather than closing itself. The
           * citation appears in the list above, the confirmation appears here,
           * and a register page usually supports more than one fact — closing
           * would make the common case the slow one. */}
          {createState.status !== 'idle' && createState.message ? (
            <p
              role="status"
              className={
                createState.status === 'error' ? 'text-danger text-xs' : 'text-success text-xs'
              }
            >
              {createState.message}
            </p>
          ) : null}

          <div className="flex items-center gap-3">
            {sources.length > 0 ? (
              <SubmitButton pending={creating}>Enregistrer la citation</SubmitButton>
            ) : null}
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="text-text-muted hover:text-text-primary text-xs"
            >
              {createState.status === 'success' ? 'Fermer' : 'Annuler'}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
