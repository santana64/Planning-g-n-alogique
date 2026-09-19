'use server';

import { ExtractionError } from '@chronolignee/ai';
import { features } from '@/lib/env';
import { logger } from '@/lib/logger';
import { getSession } from '@/lib/session';
import { resolveTreeAccess } from './access';
import { getAIProvider } from './ai';
import { loadStorySuggestions } from './story';
import type { StoryChoiceState } from './story-choice-state';

/**
 * Asking a provider which stories to present.
 *
 * Editors only, on request, never on page load: a selection by a model sends
 * the candidates' titles and reasons — names and years of people who have
 * died, nobody living — to whoever runs that model, and that is the editor's
 * decision to make, button by button. The candidates are rebuilt here from
 * the database rather than taken from the page, so the request cannot be
 * made to carry anything else.
 */

const PRESENTED = 4;

const MESSAGES: Record<string, string> = {
  NOT_CONFIGURED: 'Aucun fournisseur n’est configuré pour choisir les récits sur cette instance.',
  MISCONFIGURED: 'Le fournisseur est mal configuré. Prévenez l’administrateur.',
  EMPTY: 'Aucun récit à choisir pour l’instant.',
  REFUSED: 'Le modèle a refusé de choisir. La sélection par règles reste affichée.',
  RATE_LIMITED: 'Trop de demandes en ce moment. Réessayez dans une minute.',
  TIMEOUT: 'La demande a pris trop de temps. Réessayez.',
  UNAVAILABLE: 'Le service ne répond pas. Réessayez plus tard.',
  REJECTED_REQUEST: 'La demande a été refusée par le service.',
  INVALID_OUTPUT: 'La réponse du modèle était incomplète. La sélection par règles reste affichée.',
  ABORTED: 'Demande interrompue.',
};

export async function chooseStoriesAction(
  _previous: StoryChoiceState,
  form: FormData,
): Promise<StoryChoiceState> {
  const value = form.get('treeSlug');
  const treeSlug = typeof value === 'string' ? value : '';

  const session = await getSession();
  if (!session) {
    return { status: 'error', message: 'Connectez-vous pour demander une sélection.' };
  }
  const access = await resolveTreeAccess(treeSlug);
  if (!access || !access.canEdit) {
    return {
      status: 'error',
      message: 'Seules les personnes qui éditent cet arbre peuvent demander une sélection.',
    };
  }
  if (!features.storyDirector) {
    return {
      status: 'error',
      message: 'Les récits suggérés ne sont pas activés sur cette instance.',
    };
  }

  const provider = getAIProvider();
  if (!provider) return { status: 'error', message: MESSAGES['NOT_CONFIGURED'] as string };

  const view = await loadStorySuggestions(treeSlug);
  if (!view || view.suggestions.length === 0) {
    return { status: 'error', message: MESSAGES['EMPTY'] as string };
  }

  const started = Date.now();
  try {
    const result = await provider.chooseStories({
      candidates: view.suggestions.map(({ id, kind, title, reason }) => ({
        id,
        kind,
        title,
        reason,
      })),
      limit: PRESENTED,
    });
    // Ids, counts and durations. Never a title, never a name.
    logger.info(
      {
        treeId: access.treeId,
        provider: result.provider,
        model: result.model,
        offered: view.suggestions.length,
        chosen: result.selections.length,
        discarded: result.discarded,
        droppedAngles: result.droppedAngles,
        durationMs: Date.now() - started,
      },
      'story selection',
    );
    return {
      status: 'chosen',
      label: provider.label,
      byModel: provider.name !== 'fake',
      selections: result.selections,
    };
  } catch (error) {
    const code = error instanceof ExtractionError ? error.code : 'UNAVAILABLE';
    logger.warn(
      { treeId: access.treeId, code, durationMs: Date.now() - started },
      'story selection failed',
    );
    return { status: 'error', message: MESSAGES[code] ?? (MESSAGES['UNAVAILABLE'] as string) };
  }
}
