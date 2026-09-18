import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gregorianToJdn } from '@chronolignee/domain';
import {
  acceptProposal,
  createCitation,
  createDatabase,
  createEvent,
  createPerson,
  createSource,
  recordProposals,
  rejectProposal,
  type Database,
  type ProposalFact,
} from '../src/index';

/**
 * Machine proposals, human decisions.
 *
 * The invariants the whole AI feature rests on, checked against a real
 * database: nothing a model says reaches the tree without a person accepting
 * it; an accepted fact cites the page it came from; a new accepted birth date
 * supersedes the old one instead of contradicting it; and a rejection is kept.
 */

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // CI injects the variables directly.
}

let db: Database;
let treeId: string;
let ctx: { treeId: string; actorId: string | null };
let subjectId = '';
let citationId = '';

const PROVENANCE = {
  provider: 'fake',
  model: 'rules-fr-1',
  promptVersion: 'fr-register-1',
  pipelineVersion: 'verify-evidence-1',
};

function fact(partial: Partial<ProposalFact> & Pick<ProposalFact, 'predicate'>): ProposalFact {
  return {
    subjectName: 'Jean-Baptiste Chassagne',
    valueText: '12 juin 1822',
    normalised: '12 JUN 1822',
    evidence: 'né le 12 juin 1822',
    confidence: 0.6,
    ...partial,
  };
}

beforeAll(async () => {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required');
  db = createDatabase({ url });

  const tree = await db.tree.create({
    data: { name: 'Proposals', slug: `prop-${Date.now()}-${Math.random().toString(36).slice(2)}` },
  });
  treeId = tree.id;
  ctx = { treeId, actorId: null };

  const subject = await createPerson(
    db,
    {
      recordedSex: 'MALE',
      livingStatus: 'DECEASED',
      names: [
        {
          type: 'BIRTH',
          given: 'Jean-Baptiste',
          surname: 'Chassagne',
          isPreferred: true,
          confidence: 'MEDIUM',
        },
      ],
      birthDate: '1823',
    },
    ctx,
  );
  subjectId = subject.personId;

  const source = await createSource(
    db,
    { title: 'Registre de Tours 1822', callNumber: '6 NUM 7' },
    ctx,
  );
  const event = await createEvent(
    db,
    { type: 'CENSUS', date: '1866', participants: [{ personId: subjectId, role: 'PRINCIPAL' }] },
    ctx,
  );
  const citation = await createCitation(
    db,
    {
      sourceId: source.sourceId,
      eventId: event.eventId,
      locator: 'vue 118',
      quotation: 'né le 12 juin 1822 à Tours',
    },
    ctx,
  );
  citationId = citation.citationId;
}, 90_000);

afterAll(async () => {
  if (treeId) await db.tree.delete({ where: { id: treeId } }).catch(() => undefined);
  await db.$disconnect();
});

describe('recording proposals', () => {
  it('writes nothing canonical', async () => {
    const claimsBefore = await db.claim.count({ where: { treeId } });
    const lifespanBefore = await db.person.findUniqueOrThrow({
      where: { id: subjectId },
      select: { lifespanEarliestJdn: true },
    });

    await recordProposals(db, {
      treeId,
      facts: [fact({ predicate: 'BIRTH_DATE' })],
      provenance: PROVENANCE,
      citationId,
      subjectPersonId: subjectId,
    });

    // The proposal exists; the tree has not moved.
    expect(await db.claim.count({ where: { treeId } })).toBe(claimsBefore);
    const lifespanAfter = await db.person.findUniqueOrThrow({
      where: { id: subjectId },
      select: { lifespanEarliestJdn: true },
    });
    expect(lifespanAfter.lifespanEarliestJdn).toBe(lifespanBefore.lifespanEarliestJdn);
  });

  it('keeps the full provenance and the quoted evidence', async () => {
    const { proposalIds } = await recordProposals(db, {
      treeId,
      facts: [
        fact({
          predicate: 'BIRTH_PLACE',
          valueText: 'Tours',
          normalised: null,
          evidence: 'à Tours',
        }),
      ],
      provenance: PROVENANCE,
      citationId,
      subjectPersonId: subjectId,
    });

    const row = await db.aiProposal.findUniqueOrThrow({
      where: { id: proposalIds[0] ?? '' },
      select: {
        status: true,
        provider: true,
        model: true,
        promptVersion: true,
        pipelineVersion: true,
        evidenceSnippet: true,
        citationId: true,
      },
    });
    expect(row.status).toBe('PENDING');
    expect(row).toMatchObject({
      provider: 'fake',
      model: 'rules-fr-1',
      evidenceSnippet: 'à Tours',
    });
    expect(row.citationId).toBe(citationId);
  });

  it('attributes a statement to the person whose page it came from', async () => {
    const { proposalIds } = await recordProposals(db, {
      treeId,
      facts: [fact({ predicate: 'OCCUPATION', valueText: 'tonnelier', normalised: null })],
      provenance: PROVENANCE,
      subjectPersonId: subjectId,
    });
    const row = await db.aiProposal.findUniqueOrThrow({
      where: { id: proposalIds[0] ?? '' },
      select: { personId: true },
    });
    expect(row.personId).toBe(subjectId);
  });

  it('leaves unassigned a name that matches nobody, rather than guessing', async () => {
    const { proposalIds } = await recordProposals(db, {
      treeId,
      facts: [
        fact({
          predicate: 'OCCUPATION',
          subjectName: 'Personne Introuvable',
          valueText: 'meunier',
          normalised: null,
        }),
      ],
      provenance: PROVENANCE,
      subjectPersonId: subjectId,
    });
    const row = await db.aiProposal.findUniqueOrThrow({
      where: { id: proposalIds[0] ?? '' },
      select: { personId: true },
    });
    expect(row.personId).toBeNull();
  });
});

describe('accepting', () => {
  it('turns a proposal into an accepted claim that cites its page', async () => {
    const { proposalIds } = await recordProposals(db, {
      treeId,
      facts: [fact({ predicate: 'BIRTH_DATE' })],
      provenance: PROVENANCE,
      citationId,
      subjectPersonId: subjectId,
    });

    const { claimId } = await acceptProposal(db, { proposalId: proposalIds[0] ?? '' }, ctx);

    const claim = await db.claim.findUniqueOrThrow({
      where: { id: claimId },
      select: {
        status: true,
        predicate: true,
        aiProposalId: true,
        citations: { select: { citationId: true } },
      },
    });
    expect(claim.status).toBe('ACCEPTED');
    // Machine provenance stays attached for as long as the claim exists.
    expect(claim.aiProposalId).toBe(proposalIds[0]);
    // And the chain to the register page is unbroken.
    expect(claim.citations.map((c) => c.citationId)).toEqual([citationId]);
  });

  it('moves the lifespan to the accepted date', async () => {
    // The person was entered as born "1823"; the register says 12 June 1822.
    const row = await db.person.findUniqueOrThrow({
      where: { id: subjectId },
      select: { lifespanEarliestJdn: true },
    });
    expect(row.lifespanEarliestJdn).toBe(gregorianToJdn(1822, 6, 12));
  });

  it('supersedes the previous accepted birth date instead of contradicting it', async () => {
    const { proposalIds } = await recordProposals(db, {
      treeId,
      facts: [
        fact({
          predicate: 'BIRTH_DATE',
          valueText: '13 juin 1822',
          normalised: '13 JUN 1822',
          evidence: 'né le 13 juin 1822',
        }),
      ],
      provenance: PROVENANCE,
      subjectPersonId: subjectId,
    });
    const { claimId } = await acceptProposal(db, { proposalId: proposalIds[0] ?? '' }, ctx);

    const accepted = await db.claim.findMany({
      where: { treeId, personId: subjectId, predicate: 'BIRTH_DATE', status: 'ACCEPTED' },
      select: { id: true },
    });
    // Exactly one. Two would let the projection pick one arbitrarily.
    expect(accepted.map((c) => c.id)).toEqual([claimId]);

    const superseded = await db.claim.findFirstOrThrow({
      where: { treeId, personId: subjectId, predicate: 'BIRTH_DATE', status: 'SUPERSEDED' },
      select: { supersededById: true },
    });
    // Kept, and pointing at what replaced it.
    expect(superseded.supersededById).toBe(claimId);
  });

  it('records a reviewer’s correction as such', async () => {
    const { proposalIds } = await recordProposals(db, {
      treeId,
      facts: [fact({ predicate: 'OCCUPATION', valueText: 'tonelier', normalised: null })],
      provenance: PROVENANCE,
      subjectPersonId: subjectId,
    });
    const { claimId } = await acceptProposal(
      db,
      { proposalId: proposalIds[0] ?? '', editedValue: 'tonnelier' },
      ctx,
    );

    const proposal = await db.aiProposal.findUniqueOrThrow({
      where: { id: proposalIds[0] ?? '' },
      select: { status: true },
    });
    expect(proposal.status).toBe('EDITED_AND_ACCEPTED');
    const claim = await db.claim.findUniqueOrThrow({
      where: { id: claimId },
      select: { valueText: true },
    });
    expect(claim.valueText).toBe('tonnelier');
  });

  it('lets several occupations accumulate', async () => {
    // Unlike a birth date, a life holds more than one trade.
    for (const trade of ['vigneron', 'aubergiste']) {
      const { proposalIds } = await recordProposals(db, {
        treeId,
        facts: [fact({ predicate: 'OCCUPATION', valueText: trade, normalised: null })],
        provenance: PROVENANCE,
        subjectPersonId: subjectId,
      });
      await acceptProposal(db, { proposalId: proposalIds[0] ?? '' }, ctx);
    }
    const trades = await db.claim.count({
      where: { treeId, personId: subjectId, predicate: 'OCCUPATION', status: 'ACCEPTED' },
    });
    expect(trades).toBeGreaterThanOrEqual(3);
  });

  it('requires a person for a proposal that names nobody in the tree', async () => {
    const { proposalIds } = await recordProposals(db, {
      treeId,
      facts: [
        fact({
          predicate: 'OCCUPATION',
          subjectName: 'Inconnu Total',
          valueText: 'meunier',
          normalised: null,
        }),
      ],
      provenance: PROVENANCE,
    });
    await expect(acceptProposal(db, { proposalId: proposalIds[0] ?? '' }, ctx)).rejects.toThrow(
      /Choisissez la personne/,
    );

    // With the reviewer's choice, it goes through, and the proposal records
    // whom it turned out to be about.
    await acceptProposal(db, { proposalId: proposalIds[0] ?? '', personId: subjectId }, ctx);
    const row = await db.aiProposal.findUniqueOrThrow({
      where: { id: proposalIds[0] ?? '' },
      select: { personId: true, status: true },
    });
    expect(row).toEqual({ personId: subjectId, status: 'ACCEPTED' });
  });

  it('cannot accept the same proposal twice', async () => {
    const { proposalIds } = await recordProposals(db, {
      treeId,
      facts: [
        fact({ predicate: 'RESIDENCE', valueText: 'Tours', normalised: null, evidence: 'à Tours' }),
      ],
      provenance: PROVENANCE,
      subjectPersonId: subjectId,
    });
    await acceptProposal(db, { proposalId: proposalIds[0] ?? '' }, ctx);
    await expect(acceptProposal(db, { proposalId: proposalIds[0] ?? '' }, ctx)).rejects.toThrow(
      /déjà été examinée/,
    );
  });

  it('refuses a proposal from another tree', async () => {
    const other = await db.tree.create({
      data: { name: 'Ailleurs', slug: `oth-${Date.now()}-${Math.random().toString(36).slice(2)}` },
    });
    const { proposalIds } = await recordProposals(db, {
      treeId: other.id,
      facts: [fact({ predicate: 'OCCUPATION', valueText: 'meunier', normalised: null })],
      provenance: PROVENANCE,
    });
    await expect(acceptProposal(db, { proposalId: proposalIds[0] ?? '' }, ctx)).rejects.toThrow(
      /introuvable/,
    );
    await db.tree.delete({ where: { id: other.id } });
  });
});

describe('rejecting', () => {
  it('keeps the rejected proposal and the reason', async () => {
    const { proposalIds } = await recordProposals(db, {
      treeId,
      facts: [
        fact({ predicate: 'DEATH_DATE', valueText: '3 mars 1889', normalised: '3 MAR 1889' }),
      ],
      provenance: PROVENANCE,
      subjectPersonId: subjectId,
    });
    await rejectProposal(
      db,
      { proposalId: proposalIds[0] ?? '', note: 'confondu avec son père' },
      ctx,
    );

    const row = await db.aiProposal.findUniqueOrThrow({
      where: { id: proposalIds[0] ?? '' },
      select: { status: true, reviewNote: true },
    });
    // A rejection is evidence about the tool. Deleting it would make the
    // model's record look better than it is.
    expect(row).toEqual({ status: 'REJECTED', reviewNote: 'confondu avec son père' });

    const claims = await db.claim.count({ where: { aiProposalId: proposalIds[0] ?? '' } });
    expect(claims).toBe(0);
  });
});
