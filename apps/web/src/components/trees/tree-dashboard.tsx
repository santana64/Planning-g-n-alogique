'use client';

import { useActionState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { IDLE, type ActionState } from '@/server/action-state';
import { createTreeAction } from '@/server/tree-actions';
import { Field, SubmitButton, TextInput } from '@/components/people/fields';

/**
 * What an account sees after signing in.
 *
 * An empty state that offers only "create a tree" would be honest but useless:
 * the first question a new user has is whether their existing GEDCOM will
 * survive the move, and the demonstration answers it without asking them to
 * type anything. So the empty state offers both, and the import path is one
 * click from here rather than hidden inside a tree that does not exist yet.
 */
export interface TreeCard {
  readonly treeId: string;
  readonly name: string;
  readonly slug: string;
  readonly role: string;
  readonly peopleCount: number;
}

export function TreeDashboard({ trees }: { trees: readonly TreeCard[] }) {
  const t = useTranslations('dashboard');
  const roles = useTranslations('tree.roles');
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionState & { slug?: string }, FormData>(
    createTreeAction,
    IDLE,
  );

  useEffect(() => {
    if (state.status === 'success' && state.slug) {
      router.push(`/app/${state.slug}/personnes`);
    }
  }, [state, router]);

  return (
    <div className="flex flex-col gap-10">
      {trees.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-text-faint text-xs tracking-wide uppercase">{t('yourTrees')}</h2>
          <ul className="flex flex-col">
            {trees.map((tree) => (
              <li key={tree.treeId}>
                <Link
                  href={`/app/${tree.slug}`}
                  className="border-border-subtle hover:bg-surface-1 flex items-baseline justify-between gap-4 border-b px-2 py-3 transition-colors duration-[var(--duration-fast)]"
                >
                  <span className="font-editorial text-text-primary text-base">{tree.name}</span>
                  <span className="text-text-muted text-sm">
                    {t('peopleCount', { count: tree.peopleCount })}
                    <span className="text-text-faint ml-3 text-xs">
                      {roles.has(tree.role) ? roles(tree.role) : tree.role}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex max-w-md flex-col gap-4">
        <h2 className="text-text-faint text-xs tracking-wide uppercase">
          {trees.length === 0 ? t('start') : t('newTree')}
        </h2>

        {trees.length === 0 ? (
          <p className="text-text-secondary text-sm">{t('privateNote')}</p>
        ) : null}

        <form action={action} className="flex flex-col gap-4">
          <Field id="tree-name" label={t('treeName')} error={state.fieldErrors?.['name']}>
            <TextInput
              id="tree-name"
              name="name"
              placeholder={t('treeNamePlaceholder')}
              error={state.fieldErrors?.['name']}
            />
          </Field>

          {state.status === 'error' && state.message ? (
            <p
              role="status"
              className="text-danger border-danger/30 bg-danger/10 rounded-[var(--radius-md)] border px-3 py-2 text-sm"
            >
              {state.message}
            </p>
          ) : null}

          <SubmitButton pending={pending}>{t('create')}</SubmitButton>
        </form>

        {trees.length === 0 ? (
          <p className="text-text-faint text-sm">
            {t.rich('demoInvitation', {
              link: (chunks) => (
                <Link href="/demo" className="text-accent hover:underline">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        ) : null}
      </section>
    </div>
  );
}
