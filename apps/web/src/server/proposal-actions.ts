'use server';

import { ExtractionError } from '@chronolignee/ai';
import { acceptProposal, recordProposals, rejectProposal } from '@chronolignee/db';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { ActionState } from './action-state';
import {
  NOT_FOUND,
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

const EXTRACTION_MESSAGES: Record<string, string> = {
  NOT_CONFIGURED: 'La lecture automatique n’est pas disponible sur cette instance.',
  MISCONFIGURED: 'La lecture automatique est mal configurée. Prévenez l’administrateur.',
  EMPTY: 'Cette citation n’a pas de transcription à lire.',
  TOO_LONG: 'Transcription trop longue pour une seule lecture : découpez-la par acte.',
  REFUSED: 'Le modèle a refusé de lire ce texte. Rien n’a été enregistré.',
  RATE_LIMITED: 'Trop de lectures en ce moment. Réessayez dans une minute.',
  TIMEOUT: 'La lecture a pris trop de temps. Réessayez.',
  UNAVAILABLE: 'Le service de lecture ne répond pas. Réessayez plus tard.',
  REJECTED_REQUEST: 'La demande a été refusée par le service de lecture.',
  INVALID_OUTPUT: 'La réponse du modèle était incomplète. Rien n’a été enregistré.',
  ABORTED: 'Lecture interrompue.',
};

export async function extractFromCitationAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authoriseWrite(treeSlug);
  if ('error' in authorised) return authorised.error;
  const { access, context } = authorised;

  const provider = getAIProvider();
  if (!provider) return { status: 'error', message: EXTRACTION_MESSAGES['NOT_CONFIGURED'] };

  // A transcription about someone this author may not see is not sent
  // anywhere, and neither is the name used as a hint.
  const citationId = text(form, 'citationId');
  const personId = text(form, 'personId');
  const concerned = await peopleOfCitation(access.treeId, citationId);
  if (!concerned || !(await peopleWritable(access, [...concerned, personId]))) {
    return { status: 'error', message: 'Citation introuvable dans cet arbre.' };
  }

  const citation = await db.citation.findFirst({
    where: { id: citationId, treeId: context.treeId },
    select: { id: true, quotation: true },
  });
  if (!citation) return { status: 'error', message: 'Citation introuvable dans cet arbre.' };
  if (!citation.quotation?.trim())
    return { status: 'error', message: EXTRACTION_MESSAGES['EMPTY'] };

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
        ? 'Aucune proposition.'
        : proposalIds.length === 1
          ? '1 proposition à examiner.'
          : `${proposalIds.length} propositions à examiner.`,
    ];
    // Said out loud: a reading that silently shed statements would be a
    // reading presented as more complete than it was.
    if (result.discarded > 0) {
      parts.push(
        result.discarded === 1
          ? '1 énoncé écarté : sa citation ne figure pas dans la transcription.'
          : `${result.discarded} énoncés écartés : leur citation ne figure pas dans la transcription.`,
      );
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
      message: EXTRACTION_MESSAGES[code] ?? EXTRACTION_MESSAGES['UNAVAILABLE'],
    };
  }
}

export async function acceptProposalAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authoriseWrite(treeSlug);
  if ('error' in authorised) return authorised.error;

  const proposalId = text(form, 'proposalId');
  const people = await peopleOfProposal(authorised.access.treeId, proposalId);
  if (!people || !(await peopleWritable(authorised.access, [...people, text(form, 'personId')]))) {
    return NOT_FOUND;
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
    return { status: 'success', message: 'Accepté. Le fait est enregistré avec sa source.' };
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
  const treeSlug = text(form, 'treeSlug');
  const authorised = await authoriseWrite(treeSlug);
  if ('error' in authorised) return authorised.error;

  const proposalId = text(form, 'proposalId');
  const people = await peopleOfProposal(authorised.access.treeId, proposalId);
  if (!people || !(await peopleWritable(authorised.access, people))) return NOT_FOUND;

  try {
    await rejectProposal(
      db,
      { proposalId: text(form, 'proposalId'), note: text(form, 'note') || undefined },
      authorised.context,
    );
    revalidateTree(treeSlug);
    return { status: 'success', message: 'Rejeté. La proposition reste consultable.' };
  } catch (error) {
    const message =
      error instanceof Error && /Proposition|examinée/.test(error.message)
        ? error.message
        : 'L’enregistrement a échoué.';
    return { status: 'error', message };
  }
}
