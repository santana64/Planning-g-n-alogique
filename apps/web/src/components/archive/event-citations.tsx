'use client';

import { useActionState, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { IDLE, type ActionState } from '@/server/action-state';
import {
  createCitationAction,
  deleteCitationAction,
  listSourcesAction,
  type SourceChoice,
} from '@/server/evidence-actions';
import type { EventCitation } from '@/server/archive';
import type { AIStatus } from '@/server/ai';
import { ExtractButton } from '@/components/ai/extract-button';
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

const CONFIDENCE_OPTIONS = ['VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'VERY_LOW'] as const;

export function EventCitations({
  treeSlug,
  eventId,
  eventLabel,
  citations,
  canEdit,
  canDelete,
  personId,
  ai,
}: {
  treeSlug: string;
  eventId: string;
  eventLabel: string;
  citations: readonly EventCitation[];
  canEdit: boolean;
  canDelete: boolean;
  /** The person whose record this is, as a hint for attributing statements. */
  personId: string;
  ai: AIStatus;
}) {
  const [createState, createAction, creating] = useActionState<ActionState, FormData>(
    createCitationAction,
    IDLE,
  );
  const [deleteState, deleteAction] = useActionState<ActionState, FormData>(
    deleteCitationAction,
    IDLE,
  );
  const t = useTranslations('archive.citations');
  const confidences = useTranslations('archive.citationConfidence');
  const [adding, setAdding] = useState(false);
  const [sources, setSources] = useState<readonly SourceChoice[]>([]);

  useEffect(() => {
    if (!adding) return;
    void listSourcesAction(treeSlug).then(setSources);
  }, [adding, treeSlug]);

  return (
    <div className="flex flex-col gap-1.5 pl-4">
      {citations.length === 0 ? (
        <p className="text-text-faint text-xs">{t('none')}</p>
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
                  <span className="text-text-faint text-xs">
                    {t('page', { page: citation.page })}
                  </span>
                ) : null}
                {citation.callNumber ? (
                  <span className="text-text-faint text-xs">
                    {t('callNumber', { callNumber: citation.callNumber })}
                  </span>
                ) : null}
                {citation.documentId ? (
                  <a
                    href={`/api/trees/${treeSlug}/documents/${citation.documentId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent text-xs hover:underline"
                  >
                    {t('document')}
                  </a>
                ) : null}
                {canDelete ? (
                  <form action={deleteAction} className="inline">
                    <input type="hidden" name="treeSlug" value={treeSlug} />
                    <input type="hidden" name="citationId" value={citation.citationId} />
                    <button type="submit" className="text-text-faint hover:text-danger text-xs">
                      {t('remove')}
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
              {citation.quotation && canEdit && ai.enabled ? (
                <ExtractButton
                  treeSlug={treeSlug}
                  citationId={citation.citationId}
                  personId={personId}
                  ai={ai}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {deleteState.status === 'error' && deleteState.message ? (
        <p role="status" className="text-danger text-xs">
          {deleteState.message}
        </p>
      ) : null}

      {canEdit && !adding ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-accent self-start text-xs hover:underline"
        >
          {t('cite')}
        </button>
      ) : null}

      {canEdit && adding ? (
        <form
          action={createAction}
          className="border-border-subtle bg-surface-1/40 mt-1 flex flex-col gap-3 rounded-[var(--radius-md)] border p-3"
        >
          <input type="hidden" name="treeSlug" value={treeSlug} />
          <input type="hidden" name="eventId" value={eventId} />
          <p className="text-text-faint text-xs">{t('sourceOf', { event: eventLabel })}</p>

          {sources.length === 0 ? (
            <p className="text-text-muted text-xs">
              {t('noSource')}{' '}
              <Link href={`/app/${treeSlug}/archives`} className="text-accent hover:underline">
                {t('addOne')}
              </Link>{' '}
              {t('first')}
            </p>
          ) : (
            <>
              <Field id={`cit-source-${eventId}`} label={t('source')}>
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
                <Field id={`cit-locator-${eventId}`} label={t('where')} hint={t('whereHint')}>
                  <TextInput
                    id={`cit-locator-${eventId}`}
                    name="locator"
                    placeholder={t('wherePlaceholder')}
                    hasHint
                  />
                </Field>

                <Field id={`cit-confidence-${eventId}`} label={t('confidence')}>
                  <Select
                    id={`cit-confidence-${eventId}`}
                    name="confidence"
                    defaultValue="HIGH"
                    options={CONFIDENCE_OPTIONS.map(
                      (value) => [value, confidences(value)] as const,
                    )}
                  />
                </Field>
              </div>

              <Field
                id={`cit-quote-${eventId}`}
                label={t('transcription')}
                hint={t('transcriptionHint')}
              >
                <TextArea
                  id={`cit-quote-${eventId}`}
                  name="quotation"
                  rows={2}
                  placeholder={t('transcriptionPlaceholder')}
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
              <SubmitButton pending={creating}>{t('save')}</SubmitButton>
            ) : null}
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="text-text-muted hover:text-text-primary text-xs"
            >
              {createState.status === 'success' ? t('close') : t('cancel')}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
