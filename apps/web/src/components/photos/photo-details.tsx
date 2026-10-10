'use client';

import { useActionState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Field, SubmitButton, TextArea, TextInput } from '@/components/people/fields';
import { IDLE, type ActionState } from '@/server/action-state';
import { updateMediaAction } from '@/server/media-actions';

/** Title, when it was taken, a caption and the credit — what makes a photo an archive. */
export function PhotoDetailsForm({
  treeSlug,
  mediaId,
  title,
  captured,
  description,
  copyright,
}: {
  treeSlug: string;
  mediaId: string;
  title: string;
  captured: string;
  description: string;
  copyright: string;
}) {
  const t = useTranslations('photos.details');
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionState, FormData>(updateMediaAction, IDLE);
  useEffect(() => {
    if (state.status === 'success') router.refresh();
  }, [state, router]);

  return (
    <details className="border-border-subtle rounded-[var(--radius-lg)] border">
      <summary className="text-text-secondary hover:text-text-primary cursor-pointer px-4 py-3 text-sm select-none">
        {t('edit')}
      </summary>
      <form action={action} className="flex flex-col gap-3 px-4 pb-4">
        <input type="hidden" name="treeSlug" value={treeSlug} />
        <input type="hidden" name="mediaId" value={mediaId} />
        <Field id="photo-title" label={t('title')}>
          <TextInput id="photo-title" name="title" defaultValue={title} />
        </Field>
        <Field id="photo-captured" label={t('captured')} hint={t('capturedHint')}>
          <TextInput
            id="photo-captured"
            name="captured"
            defaultValue={captured}
            placeholder="ABT 1910"
            hasHint
          />
        </Field>
        <Field id="photo-description" label={t('description')}>
          <TextArea id="photo-description" name="description" rows={3} defaultValue={description} />
        </Field>
        <Field id="photo-copyright" label={t('copyright')}>
          <TextInput id="photo-copyright" name="copyright" defaultValue={copyright} />
        </Field>
        {state.status !== 'idle' && state.message ? (
          <p
            role="status"
            className={`text-xs ${state.status === 'error' ? 'text-danger' : 'text-success'}`}
          >
            {state.message}
          </p>
        ) : null}
        <div>
          <SubmitButton pending={pending}>{t('save')}</SubmitButton>
        </div>
      </form>
    </details>
  );
}
