'use client';

import { useActionState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Select, SubmitButton } from '@/components/people/fields';
import { IDLE, type ActionState } from '@/server/action-state';
import type { PhotoEvent } from '@/server/media';
import { linkEventAction, unlinkEventAction } from '@/server/media-actions';

/**
 * The moments a photograph shows: the wedding, the departure, the regiment.
 *
 * Editors pick among the events of the people recognised in it — the only
 * events it can plausibly show — and the photograph then appears beside that
 * event on each of their records.
 */
export function PhotoEvents({
  treeSlug,
  mediaId,
  events,
  linkable,
  canEdit,
  hasTags,
}: {
  treeSlug: string;
  mediaId: string;
  events: readonly PhotoEvent[];
  linkable: readonly PhotoEvent[];
  canEdit: boolean;
  hasTags: boolean;
}) {
  const t = useTranslations('photos.events');
  const router = useRouter();
  const [linkState, link, linking] = useActionState<ActionState, FormData>(linkEventAction, IDLE);
  const [unlinkState, unlink] = useActionState<ActionState, FormData>(unlinkEventAction, IDLE);
  useEffect(() => {
    if (linkState.status === 'success' || unlinkState.status === 'success') router.refresh();
  }, [linkState, unlinkState, router]);

  if (events.length === 0 && !canEdit) return null;
  const state = linkState.status !== 'idle' ? linkState : unlinkState;
  const describe = (event: PhotoEvent) =>
    [event.label, event.people.join(', '), event.dateLabel].filter(Boolean).join(' · ');

  return (
    <section aria-labelledby="photo-events-title" className="flex flex-col gap-2">
      <h2 id="photo-events-title" className="text-text-faint text-xs tracking-wide uppercase">
        {t('title')}
      </h2>
      {events.length === 0 ? (
        <p className="text-text-faint text-sm">{t('none')}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {events.map((event) => (
            <li
              key={event.eventId}
              className="research-row border-border-default bg-surface-1 text-text-secondary inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm"
            >
              <span
                aria-hidden="true"
                className="bg-accent inline-block h-1.5 w-1.5 rounded-full"
              />
              {describe(event)}
              {canEdit ? (
                <form action={unlink} className="inline">
                  <input type="hidden" name="treeSlug" value={treeSlug} />
                  <input type="hidden" name="mediaId" value={mediaId} />
                  <input type="hidden" name="eventId" value={event.eventId} />
                  <button
                    type="submit"
                    aria-label={t('unlink', { event: describe(event) })}
                    className="text-text-faint hover:text-danger text-xs"
                  >
                    ×
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        linkable.length > 0 ? (
          <form action={link} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="treeSlug" value={treeSlug} />
            <input type="hidden" name="mediaId" value={mediaId} />
            <label htmlFor="photo-event" className="sr-only">
              {t('choose')}
            </label>
            <Select
              id="photo-event"
              name="eventId"
              defaultValue={linkable[0]?.eventId}
              options={linkable.map((event) => [event.eventId, describe(event)] as const)}
            />
            <SubmitButton pending={linking}>{t('link')}</SubmitButton>
          </form>
        ) : (
          <p className="text-text-faint text-xs">{hasTags ? t('nothingToLink') : t('tagFirst')}</p>
        )
      ) : null}
      {state.status === 'error' && state.message ? (
        <p role="status" className="text-danger text-xs">
          {state.message}
        </p>
      ) : null}
    </section>
  );
}
