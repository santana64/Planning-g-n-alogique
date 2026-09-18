import { dateToJdn } from '@chronolignee/domain';
import type { Database } from '../client';
import { foldName } from '../normalise';
import { searchPeople } from '../repositories/search';
import { recordRevision } from './audit';
import { refreshLifespan, type PersonWriteContext } from './person';

/**
 * From machine proposal to accepted fact.
 *
 * The one place an AI reading can become part of the tree, and it only ever
 * happens here, one proposal at a time, by a person pressing a button. There
 * is no batch accept, no threshold above which proposals accept themselves,
 * and the model's own confidence is stored to be shown, never to decide.
 *
 * An accepted proposal becomes a Claim with status ACCEPTED — the same kind of
 * record a researcher's own judgement produces — carrying a pointer back to
 * the proposal, so its machine provenance stays auditable for as long as the
 * claim exists.
 */

/** What a provider's verified extraction gives this module to record. */
export interface ProposalFact {
  readonly predicate: string;
  readonly subjectName: string;
  readonly valueText: string;
  readonly normalised: string | null;
  readonly evidence: string;
  readonly confidence: number;
}

export interface RecordProposalsInput {
  readonly treeId: string;
  readonly facts: readonly ProposalFact[];
  readonly provenance: {
    readonly provider: string;
    readonly model: string;
    readonly promptVersion: string;
    readonly pipelineVersion: string;
  };
  /** The citation whose transcription was read. */
  readonly citationId?: string | undefined;
  /** The person whose record the reading was started from. */
  readonly subjectPersonId?: string | undefined;
}

/**
 * Predicates a person holds exactly one accepted value of.
 *
 * Accepting a new one supersedes the old rather than sitting beside it: two
 * accepted birth dates would make the lifespan projection pick one
 * arbitrarily, which is a contradiction presented as an answer. A person has
 * several occupations and two parents, so those accumulate.
 */
const SINGLE_VALUED = new Set([
  'BIRTH_DATE',
  'BIRTH_PLACE',
  'BAPTISM_DATE',
  'DEATH_DATE',
  'DEATH_PLACE',
  'BURIAL_DATE',
  'RECORDED_SEX',
]);

const DATE_PREDICATES = new Set([
  'BIRTH_DATE',
  'BAPTISM_DATE',
  'DEATH_DATE',
  'BURIAL_DATE',
  'MARRIAGE_DATE',
]);

/** Predicates that move a lifespan, so accepting one must refresh the cache. */
const LIFESPAN_PREDICATES = new Set(['BIRTH_DATE', 'BAPTISM_DATE', 'DEATH_DATE', 'BURIAL_DATE']);

/**
 * Who a statement is about, if that can be said without guessing.
 *
 * The record names several people and only some of them are in the tree. A
 * name matching the person the reading started from is theirs; a name with
 * exactly one literal match elsewhere in the tree is that person's; anything
 * else is left unassigned for the reviewer. Picking the likeliest of two Pierre
 * CHASSAGNE is precisely the silent guess this workflow exists to prevent.
 */
async function resolvePerson(
  db: Database,
  treeId: string,
  subjectName: string,
  subject: { id: string; searchName: string } | null,
): Promise<string | null> {
  const folded = foldName(subjectName);
  if (!folded) return null;

  if (subject && (folded.includes(subject.searchName) || subject.searchName.includes(folded))) {
    return subject.id;
  }

  const hits = await searchPeople(db, { treeId, query: subjectName, limit: 3 });
  const literal = hits.filter((hit) => !hit.approximate);
  return literal.length === 1 ? (literal[0]?.personId ?? null) : null;
}

export async function recordProposals(
  db: Database,
  input: RecordProposalsInput,
): Promise<{ proposalIds: string[] }> {
  const subject = input.subjectPersonId
    ? await db.person.findFirst({
        where: { id: input.subjectPersonId, treeId: input.treeId, deletedAt: null },
        select: { id: true, searchName: true },
      })
    : null;

  if (input.citationId) {
    // The citation must be in this tree: a proposal is a claim waiting to
    // happen, and it must not be able to cite another family's archive.
    await db.citation.findFirstOrThrow({
      where: { id: input.citationId, treeId: input.treeId },
      select: { id: true },
    });
  }

  const proposalIds: string[] = [];
  for (const fact of input.facts) {
    const personId = await resolvePerson(db, input.treeId, fact.subjectName, subject);

    const proposal = await db.aiProposal.create({
      data: {
        treeId: input.treeId,
        predicate: fact.predicate as never,
        value: {
          text: fact.valueText,
          normalised: fact.normalised,
          subjectName: fact.subjectName,
        },
        valueText: fact.valueText,
        modelConfidence: fact.confidence,
        evidenceSnippet: fact.evidence,
        provider: input.provenance.provider,
        model: input.provenance.model,
        promptVersion: input.provenance.promptVersion,
        pipelineVersion: input.provenance.pipelineVersion,
        ...(personId ? { personId } : {}),
        ...(input.citationId ? { citationId: input.citationId } : {}),
      },
      select: { id: true },
    });
    proposalIds.push(proposal.id);
  }

  return { proposalIds };
}

export interface AcceptProposalInput {
  readonly proposalId: string;
  /** Required when the proposal names nobody in the tree. */
  readonly personId?: string | undefined;
  /** The reviewer's correction. Accepting with an edit is recorded as such. */
  readonly editedValue?: string | undefined;
}

export async function acceptProposal(
  db: Database,
  input: AcceptProposalInput,
  context: PersonWriteContext,
): Promise<{ claimId: string }> {
  const todayJdn = dateToJdn(new Date());

  return db.$transaction(async (tx) => {
    const proposal = await tx.aiProposal.findFirst({
      where: { id: input.proposalId, treeId: context.treeId },
      select: {
        id: true,
        status: true,
        predicate: true,
        value: true,
        valueText: true,
        personId: true,
        citationId: true,
        provider: true,
        model: true,
      },
    });
    if (!proposal) throw new Error('Proposition introuvable dans cet arbre.');
    // Decided once. Re-accepting a rejected proposal, or accepting twice,
    // would rewrite the history of a decision instead of adding to it.
    if (proposal.status !== 'PENDING') throw new Error('Cette proposition a déjà été examinée.');

    const personId = input.personId || proposal.personId;
    if (!personId) {
      throw new Error('Choisissez la personne que cette proposition concerne.');
    }
    const person = await tx.person.findFirst({
      where: { id: personId, treeId: context.treeId, deletedAt: null },
      select: { id: true, displayName: true },
    });
    if (!person) throw new Error('Personne introuvable dans cet arbre.');

    const original = (proposal.value ?? {}) as {
      text?: string;
      normalised?: string | null;
      subjectName?: string;
    };
    const edited = input.editedValue?.trim();
    const isEdit = Boolean(edited && edited !== proposal.valueText);
    const text = isEdit && edited ? edited : proposal.valueText;
    // An edit replaces the normalised form too: keeping the model's
    // normalisation beside the reviewer's correction would leave two dates
    // on one claim, and the projection reads the normalised one.
    const normalised = isEdit ? null : (original.normalised ?? null);

    const value = {
      text,
      normalised,
      subjectName: original.subjectName ?? null,
      // The key the lifespan projection reads a date from.
      ...(DATE_PREDICATES.has(proposal.predicate) ? { date: normalised ?? text } : {}),
    };

    const now = new Date();
    const claim = await tx.claim.create({
      data: {
        treeId: context.treeId,
        personId: person.id,
        predicate: proposal.predicate,
        value,
        valueText: text,
        status: 'ACCEPTED',
        confidence: 'MEDIUM',
        aiProposalId: proposal.id,
        reviewedAt: now,
        ...(context.actorId ? { createdById: context.actorId, reviewedById: context.actorId } : {}),
      },
      select: { id: true },
    });

    if (proposal.citationId) {
      // The accepted fact cites the page it was read from. This is the link
      // that makes the whole chain checkable.
      await tx.claimCitation.create({
        data: { claimId: claim.id, citationId: proposal.citationId },
      });
    }

    if (SINGLE_VALUED.has(proposal.predicate)) {
      await tx.claim.updateMany({
        where: {
          treeId: context.treeId,
          personId: person.id,
          predicate: proposal.predicate,
          status: 'ACCEPTED',
          id: { not: claim.id },
        },
        // Superseded, never deleted: what was believed before is itself
        // research material, and the chain from old to new is kept.
        data: { status: 'SUPERSEDED', supersededById: claim.id },
      });
    }

    await tx.aiProposal.update({
      where: { id: proposal.id },
      data: {
        status: isEdit ? 'EDITED_AND_ACCEPTED' : 'ACCEPTED',
        reviewedAt: now,
        // The proposal records whom it ended up being about, which may be a
        // person the reviewer picked rather than the one the model named.
        personId: person.id,
        ...(context.actorId ? { reviewedById: context.actorId } : {}),
      },
    });

    if (LIFESPAN_PREDICATES.has(proposal.predicate)) {
      await refreshLifespan(tx, person.id, todayJdn);
    }

    await recordRevision(tx, {
      treeId: context.treeId,
      entityType: 'Claim',
      entityId: claim.id,
      action: 'ACCEPT_CLAIM',
      actorId: context.actorId,
      after: {
        predicate: proposal.predicate,
        value: text,
        edited: isEdit,
        from: `${proposal.provider}/${proposal.model}`,
      },
      summary: `${person.displayName} — ${proposal.predicate} : ${text}${isEdit ? ' (corrigé)' : ''}`,
      ...(context.batchId ? { batchId: context.batchId } : {}),
    });

    await tx.tree.update({
      where: { id: context.treeId },
      data: { revision: { increment: 1 } },
    });

    return { claimId: claim.id };
  });
}

export async function rejectProposal(
  db: Database,
  input: { readonly proposalId: string; readonly note?: string | undefined },
  context: PersonWriteContext,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const proposal = await tx.aiProposal.findFirst({
      where: { id: input.proposalId, treeId: context.treeId },
      select: { id: true, status: true, predicate: true, valueText: true },
    });
    if (!proposal) throw new Error('Proposition introuvable dans cet arbre.');
    if (proposal.status !== 'PENDING') throw new Error('Cette proposition a déjà été examinée.');

    const note = input.note?.trim().slice(0, 1000) || null;

    // Kept, not deleted. A rejected reading is evidence about the tool — how
    // often it is wrong, and how — and deleting it would make the model's
    // record look better than it is.
    await tx.aiProposal.update({
      where: { id: proposal.id },
      data: {
        status: 'REJECTED',
        reviewedAt: new Date(),
        reviewNote: note,
        ...(context.actorId ? { reviewedById: context.actorId } : {}),
      },
    });

    await recordRevision(tx, {
      treeId: context.treeId,
      entityType: 'AiProposal',
      entityId: proposal.id,
      action: 'REJECT_CLAIM',
      actorId: context.actorId,
      before: { predicate: proposal.predicate, value: proposal.valueText },
      after: { note },
      summary: `Proposition rejetée : ${proposal.predicate} ${proposal.valueText}`,
      ...(context.batchId ? { batchId: context.batchId } : {}),
    });
  });
}
