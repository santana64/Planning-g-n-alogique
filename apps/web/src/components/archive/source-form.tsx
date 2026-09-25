'use client';

import { useActionState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
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

const SOURCE_TYPES = [
  'CIVIL_REGISTER',
  'PARISH_REGISTER',
  'CENSUS',
  'MILITARY_RECORD',
  'NOTARIAL_ACT',
  'NEWSPAPER',
  'CEMETERY',
  'BOOK',
  'WEBSITE',
  'DATABASE',
  'PHOTOGRAPH',
  'LETTER',
  'ORAL_HISTORY',
  'DNA',
  'OTHER',
] as const;

const RELIABILITIES = ['VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'VERY_LOW'] as const;

export function SourceForm({ treeSlug }: { treeSlug: string }) {
  const t = useTranslations('archive');
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
      <h2 className="font-editorial text-text-primary text-base">{t('addSource')}</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="source-title" label={t('sourceTitle')}>
          <TextInput id="source-title" name="title" placeholder={t('sourceTitlePlaceholder')} />
        </Field>

        <Field id="source-type" label={t('sourceKind')}>
          <Select
            id="source-type"
            name="type"
            defaultValue="PARISH_REGISTER"
            options={SOURCE_TYPES.map((value) => [value, t(`sourceTypes.${value}`)] as const)}
          />
        </Field>

        <Field id="source-call-number" label={t('callNumber')} hint={t('callNumberHint')}>
          <TextInput
            id="source-call-number"
            name="callNumber"
            placeholder={t('callNumberPlaceholder')}
            hasHint
          />
        </Field>

        <Field id="source-repository" label={t('repository')}>
          <TextInput
            id="source-repository"
            name="repository"
            placeholder={t('repositoryPlaceholder')}
          />
        </Field>

        <Field id="source-url" label={t('onlineAddress')}>
          <TextInput id="source-url" name="url" placeholder="https://archives.touraine.fr/…" />
        </Field>

        <Field id="source-reliability" label={t('reliabilityLabel')}>
          <Select
            id="source-reliability"
            name="reliability"
            defaultValue="MEDIUM"
            options={RELIABILITIES.map((value) => [value, t(`reliability.${value}`)] as const)}
          />
        </Field>
      </div>

      <Field id="source-notes" label={t('notes')}>
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

      <SubmitButton pending={pending}>{t('submitSource')}</SubmitButton>
    </form>
  );
}
