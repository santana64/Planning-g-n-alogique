'use server';

import { getTranslations } from 'next-intl/server';
import { ExtractionError } from '@chronolignee/ai';
import { acceptProposal, recordProposals, rejectProposal } from '@chronolignee/db';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { ActionState } from './action-state';
import {
  notFound,
  authoriseWrite,
  peopleOfCitation,
  peopleOfProposal,
  peopleWritable,
} from './authorise';
import { getAIProvider } from './ai';
import { revalidateTree } from './revalidate';

/**
 * Reading a transcription, and deciding what to keep.
 *
 * Extraction reads the verbatim transcription already stored on a citation —
 * never free text from nowhere. A proposal therefore always has a source, a
 * locator and the passage it was read from before anyone is asked to judge
 * it, and an accepted fact inherits that citation automatically.
 */

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

/** The codes the extractor can raise; anything else reads as unavailable. */
const EXTRACTION_CODES = new Set([
  'NOT_CONFIGURED',
  'MISCONFIGURED',
  'EMPTY',
  'TOO_LONG',
  'REFUSED',
  'RATE_LIMITED',
  'TIMEOUT',
  'UNAVAILABLE',
  'REJECTED_REQUEST',
  'INVALID_OUTPUT',
  'ABORTED',
]);

export async function extractFromCitationAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const t = await getTranslations('actions');
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authoriseWrite(treeSlug);
  if ('error' in authorised) return authorised.error;
  const { access, context } = authorised;

  const provider = getAIProvider();
  if (!provider) return { status: 'error', message: t('ai.extraction.NOT_CONFIGURED') };

  // A transcription about someone this author may not see is not sent
  // anywhere, and neither is the name used as a hint.
  const citationId = text(form, 'citationId');
  const personId = text(form, 'personId');
  const concerned = await peopleOfCitation(access.treeId, citationId);
  if (!concerned || !(await peopleWritable(access, [...concerned, personId]))) {
    return { status: 'error', message: t('ai.citationNotFound') };
  }

  const citation = await db.citation.findFirst({
    where: { id: citationId, treeId: context.treeId },
    select: { id: true, quotation: true },
  });
  if (!citation) return { status: 'error', message: t('ai.citationNotFound') };
  if (!citation.quotation?.trim()) return { status: 'error', message: t('ai.extraction.EMPTY') };

  const subject = personId
    ? await db.person.findFirst({
        where: { id: personId, treeId: context.treeId, deletedAt: null },
        select: { id: true, displayName: true },
      })
    : null;

  const started = Date.now();
  try {
    const result = await provider.extract({
      text: citation.quotation,
      subjectHint: subject?.displayName,
    });

    const { proposalIds } = await recordProposals(db, {
      treeId: context.treeId,
      facts: result.facts,
      provenance: result.provenance,
      citationId: citation.id,
      subjectPersonId: subject?.id,
    });

    // Ids, counts and durations. Never the transcription, never a name.
    logger.info(
      {
        event: 'ai.extraction',
        provider: result.provenance.provider,
        model: result.provenance.model,
        treeId: context.treeId,
        citationId: citation.id,
        proposals: proposalIds.length,
        discarded: result.discarded,
        durationMs: Date.now() - started,
      },
      'extraction recorded',
    );

    revalidateTree(treeSlug);

    const parts = [
      proposalIds.length === 0
        ? t('ai.noProposal')
        : t('ai.proposals', { count: proposalIds.length }),
    ];
    // Said out loud: a reading that silently shed statements would be a
    // reading presented as more complete than it was.
    if (result.discarded > 0) {
      parts.push(t('ai.discarded', { count: result.discarded }));
    }
    return {
      status: 'success',
      message: parts.join(' '),
      ...(result.caveats.length > 0 ? { warnings: [...result.caveats] } : {}),
    };
  } catch (error) {
    const code = error instanceof ExtractionError ? error.code : 'UNAVAILABLE';
    logger.warn(
      {
        event: 'ai.extraction_failed',
        provider: provider.name,
        code,
        treeId: context.treeId,
        citationId: citation.id,
        durationMs: Date.now() - started,
      },
      'extraction failed',
    );
    return {
      status: 'error',
      message: t(`ai.extraction.${EXTRACTION_CODES.has(code) ? code : 'UNAVAILABLE'}`),
    };
  }
}

export async function acceptProposalAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const t = await getTranslations('actions');
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authoriseWrite(treeSlug);
  if ('error' in authorised) return authorised.error;

  const proposalId = text(form, 'proposalId');
  const people = await peopleOfProposal(authorised.access.treeId, proposalId);
  if (!people || !(await peopleWritable(authorised.access, [...people, text(form, 'personId')]))) {
    return await notFound();
  }

  try {
    await acceptProposal(
      db,
      {
        proposalId: text(form, 'proposalId'),
        personId: text(form, 'personId') || undefined,
        editedValue: text(form, 'editedValue') || undefined,
      },
      authorised.context,
    );
    revalidateTree(treeSlug);
    return { status: 'success', message: t('ai.accepted') };
  } catch (error) {
    // The service's own messages are written for the user and carry no data
    // beyond what they already see; anything else is reduced to a sentence.
    const message =
      error instanceof Error && /Proposition|personne|Personne|examinée/.test(error.message)
        ? error.message
        : 'L’enregistrement a échoué.';
    return { status: 'error', message };
  }
}

export async function rejectProposalAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const t = await getTranslations('actions');
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authoriseWrite(treeSlug);
  if ('error' in authorised) return authorised.error;

  const proposalId = text(form, 'proposalId');
  const people = await peopleOfProposal(authorised.access.treeId, proposalId);
  if (!people || !(await peopleWritable(authorised.access, people))) return await notFound();

  try {
    await rejectProposal(
      db,
      { proposalId: text(form, 'proposalId'), note: text(form, 'note') || undefined },
      authorised.context,
    );
    revalidateTree(treeSlug);
    return { status: 'success', message: t('ai.rejected') };
  } catch (error) {
    const message =
      error instanceof Error && /Proposition|examinée/.test(error.message)
        ? error.message
        : 'L’enregistrement a échoué.';
    return { status: 'error', message };
  }
}
