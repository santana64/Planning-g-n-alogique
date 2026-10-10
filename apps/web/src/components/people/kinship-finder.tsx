'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { kinshipAction, type KinshipState } from '@/server/kinship-actions';
import { SubmitButton } from './fields';
import { PersonPicker } from './person-picker';

/**
 * "Quel lien avec… ?" — the relationship between this person and another,
 * named as the family would say it, with the ancestors it runs through.
 */
export function KinshipFinder({
  treeSlug,
  personId,
  personName,
}: {
  treeSlug: string;
  personId: string;
  personName: string;
}) {
  const t = useTranslations('person.kinship');
  const [state, action, pending] = useActionState<KinshipState, FormData>(kinshipAction, {
    status: 'idle',
  });

  return (
    <section aria-labelledby="kinship-title" className="flex flex-col gap-3">
      <h2 id="kinship-title" className="text-text-faint text-xs tracking-wide uppercase">
        {t('title')}
      </h2>
      <form action={action} className="flex flex-col gap-2">
        <input type="hidden" name="treeSlug" value={treeSlug} />
        <input type="hidden" name="subjectId" value={personId} />
        <PersonPicker
          name="otherId"
          label={t('with', { name: personName })}
          treeSlug={treeSlug}
          excludeId={personId}
        />
        <div>
          <SubmitButton pending={pending}>{t('find')}</SubmitButton>
        </div>
      </form>
      {state.status === 'success' ? (
        <div
          key={`${state.otherName}-${state.label}`}
          role="status"
          className="research-row border-border-subtle bg-surface-1 rounded-[var(--radius-md)] border px-4 py-3"
        >
          <p className="text-text-faint text-xs">
            {t('reads', { other: state.otherName, subject: personName })}
          </p>
          <p className="font-editorial text-text-primary text-lg">{state.label}</p>
          {state.through ? <p className="text-text-muted text-sm">{state.through}</p> : null}
        </div>
      ) : state.status === 'error' ? (
        <p role="status" className="text-danger text-sm">
          {state.message}
        </p>
      ) : null}
    </section>
  );
}
