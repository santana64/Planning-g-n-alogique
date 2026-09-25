'use server';

import { getTranslations } from 'next-intl/server';
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

const CHOICE_CODES = new Set([
  'NOT_CONFIGURED',
  'MISCONFIGURED',
  'EMPTY',
  'REFUSED',
  'RATE_LIMITED',
  'TIMEOUT',
  'UNAVAILABLE',
  'REJECTED_REQUEST',
  'INVALID_OUTPUT',
  'ABORTED',
]);

export async function chooseStoriesAction(
  _previous: StoryChoiceState,
  form: FormData,
): Promise<StoryChoiceState> {
  const t = await getTranslations('actions');
  const value = form.get('treeSlug');
  const treeSlug = typeof value === 'string' ? value : '';

  const session = await getSession();
  if (!session) {
    return { status: 'error', message: t('story.signIn') };
  }
  const access = await resolveTreeAccess(treeSlug);
  if (!access || !access.canEdit) {
    return {
      status: 'error',
      message: t('story.editorsOnly'),
    };
  }
  if (!features.storyDirector) {
    return {
      status: 'error',
      message: t('story.featureOff'),
    };
  }

  const provider = getAIProvider();
  if (!provider) return { status: 'error', message: t('story.choice.NOT_CONFIGURED') };

  const view = await loadStorySuggestions(treeSlug);
  if (!view || view.suggestions.length === 0) {
    return { status: 'error', message: t('story.choice.EMPTY') };
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
    return {
      status: 'error',
      message: t(`story.choice.${CHOICE_CODES.has(code) ? code : 'UNAVAILABLE'}`),
    };
  }
}
