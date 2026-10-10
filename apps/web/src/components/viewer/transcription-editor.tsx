'use client';

import { useActionState, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { SubmitButton } from '@/components/people/fields';
import { IDLE, type ActionState } from '@/server/action-state';
import { saveTranscriptionAction } from '@/server/media-actions';

/**
 * Transcribing beside the image.
 *
 * The text area sits next to the scan rather than under it, so a line can be
 * read and typed without scrolling between the two. A serif face, wide line
 * height and no autocorrect: the point is to copy what the clerk wrote,
 * "led. Jean" included, not what a spellchecker would prefer.
 */
export function TranscriptionEditor({
  treeSlug,
  documentId,
  initial,
}: {
  treeSlug: string;
  documentId: string;
  initial: string;
}) {
  const t = useTranslations('documentView');
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [state, action, pending] = useActionState<ActionState, FormData>(
    saveTranscriptionAction,
    IDLE,
  );

  useEffect(() => {
    if (state.status === 'success') router.refresh();
  }, [state, router]);

  const dirty = value !== initial;

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="treeSlug" value={treeSlug} />
      <input type="hidden" name="documentId" value={documentId} />
      <label htmlFor="transcription" className="text-text-secondary text-sm font-medium">
        {t('transcription')}
      </label>
      <textarea
        id="transcription"
        name="transcription"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        rows={14}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        placeholder={t('transcriptionPlaceholder')}
        className="border-border-default bg-surface-1 text-text-primary placeholder:text-text-faint focus:border-accent font-editorial w-full resize-y rounded-[var(--radius-md)] border px-3 py-2 text-[15px] leading-7 focus:outline-none"
      />
      <div className="flex items-center gap-3">
        <SubmitButton pending={pending} disabled={!dirty}>
          {t('saveTranscription')}
        </SubmitButton>
        <span
          role="status"
          className={`text-xs ${state.status === 'error' ? 'text-danger' : 'text-text-faint'}`}
        >
          {state.status !== 'idle' && state.message ? state.message : dirty ? t('unsaved') : ''}
        </span>
      </div>
    </form>
  );
}
