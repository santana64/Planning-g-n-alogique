'use client';

import { useActionState, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { IDLE, type ActionState } from '@/server/action-state';
import { createEventAction, deleteEventAction, updateEventAction } from '@/server/event-actions';
import type { PersonEventRow } from '@/server/people';
import type { AIStatus } from '@/server/ai';
import { EventCitations } from '@/components/archive/event-citations';
import { Field, Select, SubmitButton, TextInput } from './fields';
import { PersonPicker } from './person-picker';

/**
 * A person's events.
 *
 * Birth and death are edited on the person form, because a person form that
 * could not ask when someone was born would be absurd. Everything else lives
 * here — and "everything else" is most of a life: a marriage, a census, a
 * migration, a trade, a conscription. Those are what turn a pair of dates into
 * a biography, and they are what the archives actually hold.
 *
 * Vital events are listed but not editable here, so the same date cannot be
 * corrected from two screens that disagree about what happens to the old one.
 */

/** In the order an editor reaches for them, not the model's order. */
const EVENT_OPTIONS = [
  'MARRIAGE',
  'MARRIAGE_CONTRACT',
  'MARRIAGE_BANN',
  'CIVIL_UNION',
  'DIVORCE',
  'BAPTISM',
  'BURIAL',
  'CREMATION',
  'RESIDENCE',
  'OCCUPATION',
  'EDUCATION',
  'MILITARY_SERVICE',
  'MIGRATION',
  'NATURALIZATION',
  'CENSUS',
  'PROBATE',
  'WILL',
  'RELIGIOUS_EVENT',
  'CUSTOM',
] as const;

const CONFIDENCE_OPTIONS = ['VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'VERY_LOW'] as const;

/** Types where a second person is the normal case rather than an oddity. */
const PAIRED = new Set([
  'MARRIAGE',
  'MARRIAGE_CONTRACT',
  'MARRIAGE_BANN',
  'CIVIL_UNION',
  'DIVORCE',
]);

const VITAL = new Set(['BIRTH', 'DEATH']);

export function EventEditor({
  treeSlug,
  personId,
  events,
  canEdit,
  canDelete,
  ai,
}: {
  treeSlug: string;
  personId: string;
  events: readonly PersonEventRow[];
  canEdit: boolean;
  canDelete: boolean;
  ai: AIStatus;
}) {
  const t = useTranslations('eventEditor');
  const kinds = useTranslations('events');
  const [createState, createAction, creating] = useActionState<ActionState, FormData>(
    createEventAction,
    IDLE,
  );
  const [deleteState, deleteAction] = useActionState<ActionState, FormData>(
    deleteEventAction,
    IDLE,
  );
  const [type, setType] = useState('MARRIAGE');
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      {events.length === 0 ? (
        <p className="text-text-faint text-sm">{t('nothingRecorded')}</p>
      ) : (
        <ul className="flex flex-col">
          {events.map((event) =>
            editing === event.eventId ? (
              <li
                key={event.eventId}
                className="border-border-subtle border-b py-3 last:border-b-0"
              >
                <EventCorrection
                  treeSlug={treeSlug}
                  event={event}
                  onDone={() => setEditing(null)}
                />
              </li>
            ) : (
              <li
                key={event.eventId}
                className="border-border-subtle flex flex-col gap-1 border-b py-2 last:border-b-0"
              >
                <span className="flex items-baseline justify-between gap-4">
                  <span className="text-text-primary text-sm">{event.label}</span>
                  <span className="text-text-muted flex items-baseline gap-2 text-sm">
                    <span className="tabular">{event.dateLabel}</span>
                    {/* An unreadable date is shown as written and marked as
                     * such. Hiding it would remove the one clue needed to
                     * correct it. */}
                    {event.dateUnparsed ? (
                      <span className="text-warning text-xs">{t('unreadableDate')}</span>
                    ) : null}
                    {event.placeName ? (
                      <span className="text-text-faint text-xs">{event.placeName}</span>
                    ) : null}

                    {canEdit && !VITAL.has(event.type) ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setEditing(event.eventId)}
                          className="text-text-faint hover:text-accent text-xs"
                        >
                          {t('correct')}
                        </button>
                        {canDelete ? (
                          <form action={deleteAction} className="inline">
                            <input type="hidden" name="treeSlug" value={treeSlug} />
                            <input type="hidden" name="eventId" value={event.eventId} />
                            <button
                              type="submit"
                              className="text-text-faint hover:text-danger text-xs"
                            >
                              {t('remove')}
                            </button>
                          </form>
                        ) : null}
                      </>
                    ) : canEdit ? (
                      // Vital events are corrected on the person form, where the
                      // previous value is archived rather than overwritten.
                      <span className="text-text-faint text-xs">{t('viaTheRecord')}</span>
                    ) : null}
                  </span>
                </span>

                <EventCitations
                  treeSlug={treeSlug}
                  eventId={event.eventId}
                  eventLabel={event.label}
                  citations={event.citations}
                  canEdit={canEdit}
                  canDelete={canDelete}
                  personId={personId}
                  ai={ai}
                />
              </li>
            ),
          )}
        </ul>
      )}

      {deleteState.status === 'error' && deleteState.message ? (
        <p role="status" className="text-danger text-sm">
          {deleteState.message}
        </p>
      ) : null}

      {canEdit && !adding ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-accent self-start text-sm hover:underline"
        >
          {t('add')}
        </button>
      ) : null}

      {canEdit && adding ? (
        <form
          action={createAction}
          className="border-border-subtle bg-surface-1/40 flex flex-col gap-4 rounded-[var(--radius-md)] border p-4"
        >
          <input type="hidden" name="treeSlug" value={treeSlug} />
          <input type="hidden" name="personId" value={personId} />
          <input type="hidden" name="role" value={PAIRED.has(type) ? 'SPOUSE' : 'PRINCIPAL'} />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="event-type" className="text-text-secondary text-sm font-medium">
                {t('type')}
              </label>
              <select
                id="event-type"
                name="type"
                value={type}
                onChange={(event) => setType(event.target.value)}
                className="border-border-default bg-surface-1 text-text-primary hover:border-border-strong focus:border-accent w-full rounded-[var(--radius-md)] border px-3 py-2 transition-colors duration-[var(--duration-fast)] focus:outline-none"
              >
                {EVENT_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value === 'CUSTOM' ? t('custom') : kinds(value)}
                  </option>
                ))}
              </select>
            </div>

            {type === 'CUSTOM' ? (
              <Field id="customType" label={t('customLabel')}>
                <TextInput id="customType" name="customType" placeholder={t('customPlaceholder')} />
              </Field>
            ) : null}

            <Field id="event-date" label={t('date')} hint={t('dateHint')}>
              <TextInput id="event-date" name="date" placeholder={t('datePlaceholder')} hasHint />
            </Field>

            <Field id="event-place" label={t('place')}>
              <TextInput id="event-place" name="placeName" placeholder={t('placePlaceholder')} />
            </Field>

            {PAIRED.has(type) ? (
              <div className="flex flex-col gap-2">
                <PersonPicker
                  key={type}
                  name="secondId"
                  label={t('with')}
                  treeSlug={treeSlug}
                  excludeId={personId}
                />
                <label className="text-text-secondary flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="alsoLink"
                    defaultChecked
                    className="accent-accent mt-1"
                  />
                  <span>
                    {t('alsoLink')}
                    <span className="text-text-faint block text-xs">{t('alsoLinkHint')}</span>
                  </span>
                </label>
              </div>
            ) : null}

            <Field id="event-confidence" label={t('confidence')}>
              <Select
                id="event-confidence"
                name="confidence"
                defaultValue="MEDIUM"
                options={CONFIDENCE_OPTIONS.map(
                  (value) => [value, t(`confidences.${value}`)] as const,
                )}
              />
            </Field>
          </div>

          <Field id="event-description" label={t('detail')}>
            <TextInput
              id="event-description"
              name="description"
              placeholder={t('detailPlaceholder')}
            />
          </Field>

          {createState.status !== 'idle' && createState.message ? (
            <p
              role="status"
              className={`rounded-[var(--radius-md)] border px-3 py-2 text-sm ${
                createState.status === 'error'
                  ? 'text-danger border-danger/30 bg-danger/10'
                  : 'text-success border-success/30 bg-success/10'
              }`}
            >
              {createState.message}
            </p>
          ) : null}

          {createState.warnings && createState.warnings.length > 0 ? (
            <ul className="border-warning/30 bg-warning/10 flex flex-col gap-1 rounded-[var(--radius-md)] border px-3 py-2">
              {createState.warnings.map((warning) => (
                <li key={warning} className="text-warning text-sm">
                  {warning}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex items-center gap-3">
            <SubmitButton pending={creating}>{t('submit')}</SubmitButton>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="text-text-muted hover:text-text-primary text-sm"
            >
              {t('cancel')}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function EventCorrection({
  treeSlug,
  event,
  onDone,
}: {
  treeSlug: string;
  event: PersonEventRow;
  onDone: () => void;
}) {
  const t = useTranslations('eventEditor');
  const [state, action, pending] = useActionState<ActionState, FormData>(updateEventAction, IDLE);

  // In an effect, not in the render body: closing the form is a side effect on
  // the parent, and doing it during render makes React re-enter mid-commit.
  useEffect(() => {
    if (state.status === 'success') onDone();
  }, [state, onDone]);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="treeSlug" value={treeSlug} />
      <input type="hidden" name="eventId" value={event.eventId} />

      <p className="text-text-secondary text-sm">{event.label}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`d-${event.eventId}`} label={t('date')}>
          <TextInput id={`d-${event.eventId}`} name="date" defaultValue={event.dateText} />
        </Field>
        <Field id={`p-${event.eventId}`} label={t('place')}>
          <TextInput
            id={`p-${event.eventId}`}
            name="placeName"
            defaultValue={event.placeName ?? ''}
          />
        </Field>
      </div>

      {state.status === 'error' && state.message ? (
        <p role="status" className="text-danger text-sm">
          {state.message}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <SubmitButton pending={pending}>{t('save')}</SubmitButton>
        <button
          type="button"
          onClick={onDone}
          className="text-text-muted hover:text-text-primary text-sm"
        >
          {t('cancel')}
        </button>
      </div>
    </form>
  );
}
