import 'server-only';
import { db } from '@/lib/db';
import { resolveTreeAccess, type TreeAccess } from './access';

/**
 * Proposals awaiting a decision.
 *
 * Shown only to people who can edit the tree. A pending proposal is work in
 * progress — a machine's reading nobody has vouched for — and publishing it
 * to a visitor would present unverified statements about a family as though
 * they were part of its record.
 */

export const PREDICATE_LABELS: Record<string, string> = {
  NAME: 'Nom',
  RECORDED_SEX: 'Sexe inscrit',
  BIRTH_DATE: 'Date de naissance',
  BIRTH_PLACE: 'Lieu de naissance',
  BAPTISM_DATE: 'Date de baptême',
  DEATH_DATE: 'Date de décès',
  DEATH_PLACE: 'Lieu de décès',
  BURIAL_DATE: 'Date d’inhumation',
  MARRIAGE_DATE: 'Date de mariage',
  MARRIAGE_PLACE: 'Lieu de mariage',
  OCCUPATION: 'Profession',
  RESIDENCE: 'Résidence',
  PARENT: 'Parent',
  SPOUSE: 'Conjoint',
  CHILD: 'Enfant',
};

export interface ProposalRow {
  readonly proposalId: string;
  readonly predicate: string;
  readonly predicateLabel: string;
  readonly valueText: string;
  /** Who the record names, spelled as the record spells them. */
  readonly subjectName: string;
  readonly evidence: string;
  /** The provider's own confidence. Displayed, never used to decide. */
  readonly modelConfidence: number | null;
  readonly readBy: string;
  readonly personId: string | null;
  readonly personName: string | null;
  readonly sourceTitle: string | null;
  readonly locator: string | null;
}

async function loadRows(where: { treeId: string; personId?: string }): Promise<ProposalRow[]> {
  const rows = await db.aiProposal.findMany({
    where: { ...where, status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: 200,
    select: {
      id: true,
      predicate: true,
      valueText: true,
      value: true,
      evidenceSnippet: true,
      modelConfidence: true,
      provider: true,
      model: true,
      personId: true,
      person: { select: { displayName: true } },
      citation: { select: { locator: true, source: { select: { title: true } } } },
    },
  });

  return rows.map((row) => {
    const value = (row.value ?? {}) as { subjectName?: string };
    return {
      proposalId: row.id,
      predicate: row.predicate,
      predicateLabel: PREDICATE_LABELS[row.predicate] ?? row.predicate,
      valueText: row.valueText,
      subjectName: value.subjectName ?? '',
      evidence: row.evidenceSnippet ?? '',
      modelConfidence: row.modelConfidence,
      readBy:
        row.provider === 'fake' ? 'Lecture par règles (sans IA)' : `${row.provider} · ${row.model}`,
      personId: row.personId,
      personName: row.person?.displayName ?? null,
      sourceTitle: row.citation?.source.title ?? null,
      locator: row.citation?.locator ?? null,
    };
  });
}

/** Pending proposals about one person, for the review panel on their record. */
export async function loadPendingForPerson(
  access: TreeAccess,
  personId: string,
): Promise<ProposalRow[]> {
  if (!access.canEdit) return [];
  return loadRows({ treeId: access.treeId, personId });
}

/** Every pending proposal in a tree, including those that name nobody known. */
export async function loadPendingForTree(
  treeSlug: string,
): Promise<{ access: TreeAccess; rows: ProposalRow[] } | null> {
  const access = await resolveTreeAccess(treeSlug);
  if (!access) return null;
  return { access, rows: access.canEdit ? await loadRows({ treeId: access.treeId }) : [] };
}
