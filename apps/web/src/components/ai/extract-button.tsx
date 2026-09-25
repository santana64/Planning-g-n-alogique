'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { IDLE, type ActionState } from '@/server/action-state';
import { extractFromCitationAction } from '@/server/proposal-actions';
import type { AIStatus } from '@/server/ai';

/**
 * Asking a reader to propose facts from a transcription.
 *
 * Offered only on a citation that already has one, so a proposal can never
 * exist without a source and a locator behind it. The button says who will
 * read the text, and — before it is pressed, not after — whether the text is
 * going to leave this server.
 */
export function ExtractButton({
  treeSlug,
  citationId,
  personId,
  ai,
}: {
  treeSlug: string;
  citationId: string;
  personId: string;
  ai: AIStatus;
}) {
  const t = useTranslations('ai');
  const [state, action, pending] = useActionState<ActionState, FormData>(
    extractFromCitationAction,
    IDLE,
  );

  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="treeSlug" value={treeSlug} />
      <input type="hidden" name="citationId" value={citationId} />
      <input type="hidden" name="personId" value={personId} />

      <div className="flex flex-wrap items-baseline gap-2">
        <button
          type="submit"
          disabled={pending}
          className="text-accent text-xs hover:underline disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? t('reading') : t('proposeFacts')}
        </button>
        <span className="text-text-faint text-xs">
          {ai.sendsDataExternally
            ? t('sentTo', { label: ai.label })
            : t('staysHere', { label: ai.label })}
        </span>
      </div>

      {state.status !== 'idle' && state.message ? (
        <p
          role="status"
          className={state.status === 'error' ? 'text-danger text-xs' : 'text-success text-xs'}
        >
          {state.message}
        </p>
      ) : null}

      {state.warnings && state.warnings.length > 0 ? (
        <ul className="text-text-faint flex flex-col gap-0.5 text-xs">
          {state.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
