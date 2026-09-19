'use client';

import { useActionState } from 'react';
import { chooseStoriesAction } from '@/server/story-actions';
import { STORY_CHOICE_IDLE } from '@/server/story-choice-state';
import type { StorySuggestion } from '@/server/story';
import { StoryPlayer } from './story-player';

/**
 * The Director's suggestions.
 *
 * The rules' choice is shown at once: it costs nothing and sends nothing
 * anywhere. An editor may ask a provider to choose instead; its choice
 * replaces the list, and any sentence it wrote is marked as the model's —
 * the stories themselves are the same, told from the record.
 */

export function StorySuggestions({
  treeSlug,
  suggestions,
  rulesChoice,
  provider,
}: {
  treeSlug: string;
  suggestions: readonly StorySuggestion[];
  rulesChoice: readonly string[];
  /** Offered to editors only, when a provider is configured. */
  provider: { readonly label: string; readonly external: boolean } | null;
}) {
  const [state, action, pending] = useActionState(chooseStoriesAction, STORY_CHOICE_IDLE);
  const byId = new Map(suggestions.map((suggestion) => [suggestion.id, suggestion]));

  const shown =
    state.status === 'chosen'
      ? state.selections.flatMap((selection) => {
          const suggestion = byId.get(selection.candidateId);
          return suggestion ? [{ suggestion, angle: selection.angle }] : [];
        })
      : rulesChoice.flatMap((id) => {
          const suggestion = byId.get(id);
          return suggestion ? [{ suggestion, angle: null }] : [];
        });

  const chosenBy =
    state.status === 'chosen'
      ? state.byModel
        ? `Sélection proposée par ${state.label}. Chaque récit reste tiré des données de l’arbre.`
        : `${state.label} : l’ordre des règles, sans phrase ajoutée.`
      : 'Sélection par règles (sans IA) : les motifs les plus marqués de l’arbre.';

  return (
    <div className="flex flex-col gap-6">
      <p className="text-text-muted text-sm" role="status">
        {chosenBy}
      </p>

      <ol className="grid gap-4 sm:grid-cols-2">
        {shown.map(({ suggestion, angle }) => (
          <li
            key={suggestion.id}
            className="border-border-subtle bg-surface-1 flex flex-col gap-3 rounded-[var(--radius-lg)] border p-5"
          >
            <h2 className="font-editorial text-text-primary text-xl tracking-tight">
              {suggestion.title}
            </h2>
            <p className="text-text-secondary text-sm">{suggestion.reason}</p>
            {angle ? (
              <p className="border-history/50 text-text-muted border-l-2 pl-3 text-sm">
                <span className="text-text-faint text-xs tracking-wide uppercase">
                  Écrit par le modèle ·{' '}
                </span>
                {angle}
              </p>
            ) : null}
            <div className="mt-auto flex items-center gap-3">
              <StoryPlayer
                chapters={suggestion.chapters}
                title={suggestion.title}
                label={`Lire « ${suggestion.title} »`}
              />
              <span className="text-text-faint text-xs">
                {suggestion.chapters.length} chapitre{suggestion.chapters.length > 1 ? 's' : ''}
              </span>
            </div>
          </li>
        ))}
      </ol>

      {provider ? (
        <form action={action} className="border-border-subtle flex flex-col gap-2 border-t pt-4">
          <input type="hidden" name="treeSlug" value={treeSlug} />
          {provider.external ? (
            <p className="text-text-muted max-w-2xl text-xs">
              Les titres et les raisons de ces {suggestions.length} récits — noms et années de
              personnes décédées, personne de vivant — seront envoyés à {provider.label} pour qu’il
              choisisse. Il n’écrit aucun récit ; il peut ajouter une phrase, signalée comme la
              sienne.
            </p>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            className="border-border-default text-text-secondary hover:text-text-primary self-start rounded-[var(--radius-md)] border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {pending ? 'Sélection en cours…' : `Demander une sélection à ${provider.label}`}
          </button>
          {state.status === 'error' ? (
            <p className="text-danger text-sm" role="alert">
              {state.message}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
