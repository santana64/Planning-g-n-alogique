'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { IDLE, type ActionState } from '@/server/action-state';
import { updateTreeSettingsAction } from '@/server/tree-settings-actions';

const VISIBILITY = ['PRIVATE', 'LINK', 'PUBLIC'] as const;

export function TreeSettingsForm({
  treeSlug,
  settings,
}: {
  treeSlug: string;
  settings: {
    readonly name: string;
    readonly description: string;
    readonly visibility: 'PRIVATE' | 'LINK' | 'PUBLIC';
    readonly redactLivingPeople: boolean;
  };
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    updateTreeSettingsAction,
    IDLE,
  );
  const t = useTranslations('settings');
  const [redact, setRedact] = useState(settings.redactLivingPeople);

  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="treeSlug" value={treeSlug} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="tree-name" className="text-text-secondary text-sm font-medium">
          {t('treeName')}
        </label>
        <input
          id="tree-name"
          name="name"
          required
          maxLength={120}
          defaultValue={settings.name}
          className="border-border-default bg-surface-1 text-text-primary w-full rounded-[var(--radius-md)] border px-3 py-2"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="tree-description" className="text-text-secondary text-sm font-medium">
          {t('description')}
        </label>
        <textarea
          id="tree-description"
          name="description"
          rows={3}
          maxLength={2000}
          defaultValue={settings.description}
          className="border-border-default bg-surface-1 text-text-primary w-full rounded-[var(--radius-md)] border px-3 py-2"
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-text-secondary mb-1 text-sm font-medium">{t('whoCanRead')}</legend>
        {VISIBILITY.map((value) => (
          <label key={value} className="flex items-start gap-3">
            <input
              type="radio"
              name="visibility"
              value={value}
              defaultChecked={settings.visibility === value}
              className="accent-accent mt-1"
            />
            <span className="flex flex-col">
              <span className="text-text-primary text-sm">{t(`visibility.${value}`)}</span>
              <span className="text-text-faint text-xs">{t(`visibilityHints.${value}`)}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="redactLivingPeople"
            checked={redact}
            onChange={(event) => setRedact(event.target.checked)}
            className="accent-accent mt-1"
          />
          <span className="flex flex-col">
            <span className="text-text-primary text-sm">{t('redact')}</span>
            <span className="text-text-faint text-xs">{t('redactHint')}</span>
          </span>
        </label>
        {!redact ? (
          <p
            role="note"
            className="text-warning border-warning/30 bg-warning/10 rounded-[var(--radius-md)] border px-3 py-2 text-sm"
          >
            {t('redactWarning')}
          </p>
        ) : null}
      </div>

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

      <button
        type="submit"
        disabled={pending}
        className="bg-accent text-accent-contrast hover:bg-accent-hover self-start rounded-[var(--radius-md)] px-4 py-2 text-sm font-medium disabled:opacity-60"
      >
        {t('save')}
      </button>
    </form>
  );
}
