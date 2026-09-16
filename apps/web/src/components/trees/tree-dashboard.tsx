'use client';

import { useActionState, useEffect } from 'react';
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

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Propriétaire',
  ADMIN: 'Administrateur',
  EDITOR: 'Éditeur',
  CONTRIBUTOR: 'Contributeur',
  VIEWER: 'Lecteur',
};

export function TreeDashboard({ trees }: { trees: readonly TreeCard[] }) {
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
          <h2 className="text-text-faint text-xs tracking-wide uppercase">Vos arbres</h2>
          <ul className="flex flex-col">
            {trees.map((tree) => (
              <li key={tree.treeId}>
                <Link
                  href={`/app/${tree.slug}/personnes`}
                  className="border-border-subtle hover:bg-surface-1 flex items-baseline justify-between gap-4 border-b px-2 py-3 transition-colors duration-[var(--duration-fast)]"
                >
                  <span className="font-editorial text-text-primary text-base">{tree.name}</span>
                  <span className="text-text-muted text-sm">
                    {tree.peopleCount === 0
                      ? 'vide'
                      : tree.peopleCount === 1
                        ? '1 personne'
                        : `${tree.peopleCount} personnes`}
                    <span className="text-text-faint ml-3 text-xs">
                      {ROLE_LABELS[tree.role] ?? tree.role}
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
          {trees.length === 0 ? 'Commencer' : 'Nouvel arbre'}
        </h2>

        {trees.length === 0 ? (
          <p className="text-text-secondary text-sm">
            Un arbre est privé à sa création. Vous décidez ensuite ce qui est publié — et les
            personnes vivantes restent masquées dans tous les cas.
          </p>
        ) : null}

        <form action={action} className="flex flex-col gap-4">
          <Field id="tree-name" label="Nom de l’arbre" error={state.fieldErrors?.['name']}>
            <TextInput
              id="tree-name"
              name="name"
              placeholder="Famille Chassagne"
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

          <SubmitButton pending={pending}>Créer l’arbre</SubmitButton>
        </form>

        {trees.length === 0 ? (
          <p className="text-text-faint text-sm">
            Ou regardez d’abord{' '}
            <Link href="/demo" className="text-accent hover:underline">
              l’arbre de démonstration
            </Link>{' '}
            : quarante personnes sur trois siècles, avec ses dates illisibles et ses contradictions.
          </p>
        ) : null}
      </section>
    </div>
  );
}
