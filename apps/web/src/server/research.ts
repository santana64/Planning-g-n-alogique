import 'server-only';
import { cache } from 'react';
import { getTranslations } from 'next-intl/server';
import { dateToJdn, formatGenealogicalDate, jdnToGregorian } from '@chronolignee/domain';
import { decodeDate } from '@chronolignee/db';
import { auditTree, sortBySeverity, type Finding } from '@chronolignee/genealogy';
import { db } from '@/lib/db';
import { findingMessage } from '@/lib/finding-messages';
import { hiddenInGraph, resolveTreeAccess, type TreeAccess } from './access';
import { treeGraph } from './graph-cache';

/**
 * The research desk of one tree.
 *
 * Four questions, in the order a genealogist asks them:
 *
 *   1. What do the dates say is impossible or odd? (the audit)
 *   2. What is recorded without a source? (events and accepted claims that
 *      no citation supports)
 *   3. What is contested? (claims a researcher marked as disputed)
 *   4. What are we still looking for? (research tasks)
 *
 * Members only, like the history: it names what the family does not know,
 * which is not a public page. And among members, anything about a person this
 * reader may not see is left out entirely — a finding "X died before being
 * born" about a protected relative would publish the dates the protection
 * hides.
 */

/** Lists are capped; the page says how many there are in total. */
const LIST_CAP = 200;

export interface ResearchFinding {
  readonly code: Finding['code'];
  readonly severity: Finding['severity'];
  readonly certainty: Finding['certainty'];
  readonly message: string;
  readonly personId: string | null;
}

export interface UnsourcedFact {
  readonly kind: 'EVENT' | 'CLAIM';
  readonly id: string;
  /** "Mariage", "Date de naissance". */
  readonly label: string;
  /** The value as recorded, when there is one. */
  readonly detail: string;
  readonly people: ReadonlyArray<{ readonly id: string; readonly name: string }>;
}

export interface ContestedClaim {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly personId: string;
  readonly personName: string;
  readonly note: string | null;
}

export interface ResearchTaskView {
  readonly id: string;
  readonly title: string;
  readonly hypothesis: string | null;
  readonly status: 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'RESOLVED' | 'ABANDONED';
  readonly priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  readonly personId: string | null;
  readonly personName: string | null;
  readonly repository: string | null;
  readonly callNumber: string | null;
  readonly placeLabel: string | null;
  readonly url: string | null;
  /** "1698 – 1710", or null. */
  readonly period: string | null;
  readonly outcome: string | null;
}

export interface ResearchDesk {
  readonly access: TreeAccess;
  readonly findings: readonly ResearchFinding[];
  readonly unsourced: readonly UnsourcedFact[];
  readonly unsourcedTotal: number;
  readonly contested: readonly ContestedClaim[];
  readonly tasks: readonly ResearchTaskView[];
  /** Visible people, for the "about whom" field of a new task. */
  readonly people: ReadonlyArray<{ readonly id: string; readonly name: string }>;
}

const OWN_ROLES = ['PRINCIPAL', 'SPOUSE'] as const;

const yearOf = (jdn: number | null): string | null =>
  jdn === null ? null : String(jdnToGregorian(jdn).year);

export const loadResearchDesk = cache(async (treeSlug: string): Promise<ResearchDesk | null> => {
  const access = await resolveTreeAccess(treeSlug);
  if (!access || access.role === null) return null;

  const todayJdn = dateToJdn(new Date());
  const graph = await treeGraph(access.treeId, todayJdn);
  const hidden = hiddenInGraph(graph, access);
  const visible = (personId: string | null | undefined) =>
    !!personId && graph.people.has(personId) && !hidden(personId);
  const nameOf = (personId: string) => graph.people.get(personId)?.displayName ?? '';

  const [tFindings, tEvents, tClaims] = await Promise.all([
    getTranslations('findings'),
    getTranslations('events'),
    getTranslations('claims'),
  ]);
  const eventName = (type: string) => (tEvents.has(type) ? tEvents(type) : type);
  const claimName = (predicate: string) =>
    tClaims.has(predicate) ? tClaims(predicate) : predicate;

  // --- 1. The audit -------------------------------------------------------
  const findings: ResearchFinding[] = sortBySeverity(auditTree(graph, { todayJdn }))
    // A finding is shown only when every person it names is visible.
    .filter((finding) =>
      finding.entities.every((entity) => entity.kind !== 'PERSON' || visible(entity.id)),
    )
    .map((finding) => ({
      code: finding.code,
      severity: finding.severity,
      certainty: finding.certainty,
      message: findingMessage(tFindings, finding, eventName),
      personId: finding.entities.find((entity) => entity.kind === 'PERSON')?.id ?? null,
    }));

  // --- 2. What no source supports -----------------------------------------
  const eventWhere = {
    treeId: access.treeId,
    deletedAt: null,
    citations: { none: {} },
    participants: { some: { role: { in: [...OWN_ROLES] } } },
  };
  const claimWhere = {
    treeId: access.treeId,
    status: 'ACCEPTED' as const,
    personId: { not: null },
    citations: { none: {} },
  };
  const [events, eventCount, claims, claimCount] = await Promise.all([
    db.event.findMany({
      where: eventWhere,
      select: {
        id: true,
        type: true,
        customType: true,
        dateQualifier: true,
        dateCalendar: true,
        datePrecision: true,
        dateStartYear: true,
        dateStartMonth: true,
        dateStartDay: true,
        dateEndYear: true,
        dateEndMonth: true,
        dateEndDay: true,
        dateOriginalText: true,
        dateUnparsed: true,
        participants: {
          where: { role: { in: [...OWN_ROLES] } },
          select: { personId: true },
        },
      },
      orderBy: { dateSortJdn: { sort: 'asc', nulls: 'last' } },
      take: LIST_CAP,
    }),
    db.event.count({ where: eventWhere }),
    db.claim.findMany({
      where: claimWhere,
      select: { id: true, predicate: true, valueText: true, personId: true },
      orderBy: { createdAt: 'asc' },
      take: LIST_CAP,
    }),
    db.claim.count({ where: claimWhere }),
  ]);

  const unsourced: UnsourcedFact[] = [];
  for (const event of events) {
    const people = event.participants
      .map((participant) => participant.personId)
      .filter((id) => visible(id));
    // An event of a hidden person alone is left out, not anonymised: its
    // date is the very thing the protection exists for.
    if (people.length === 0) continue;
    const date = decodeDate(event);
    unsourced.push({
      kind: 'EVENT',
      id: event.id,
      label: event.type === 'CUSTOM' && event.customType ? event.customType : eventName(event.type),
      detail:
        date.interval.earliest === null && date.interval.latest === null
          ? ''
          : formatGenealogicalDate(date),
      people: [...new Set(people)].map((id) => ({ id, name: nameOf(id) })),
    });
  }
  for (const claim of claims) {
    if (!visible(claim.personId)) continue;
    const personId = claim.personId as string;
    unsourced.push({
      kind: 'CLAIM',
      id: claim.id,
      label: claimName(claim.predicate),
      detail: claim.valueText,
      people: [{ id: personId, name: nameOf(personId) }],
    });
  }

  // --- 3. What is contested -----------------------------------------------
  const disputed = await db.claim.findMany({
    where: { treeId: access.treeId, status: 'DISPUTED', personId: { not: null } },
    select: { id: true, predicate: true, valueText: true, personId: true, reviewNote: true },
    orderBy: { updatedAt: 'desc' },
    take: LIST_CAP,
  });
  const contested: ContestedClaim[] = disputed
    .filter((claim) => visible(claim.personId))
    .map((claim) => ({
      id: claim.id,
      label: claimName(claim.predicate),
      value: claim.valueText,
      personId: claim.personId as string,
      personName: nameOf(claim.personId as string),
      note: claim.reviewNote,
    }));

  // --- 4. What we are still looking for -----------------------------------
  const taskRows = await db.researchTask.findMany({
    where: { treeId: access.treeId },
    orderBy: [{ status: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
    take: LIST_CAP,
  });
  const tasks: ResearchTaskView[] = taskRows.map((task) => {
    const from = yearOf(task.searchFromJdn);
    const to = yearOf(task.searchToJdn);
    const personShown = task.personId !== null && visible(task.personId);
    return {
      id: task.id,
      title: task.title,
      hypothesis: task.hypothesis,
      status: task.status,
      priority: task.priority,
      // A task about a hidden person keeps its question and loses its name.
      personId: personShown ? task.personId : null,
      personName: personShown && task.personId ? nameOf(task.personId) : null,
      repository: task.repository,
      callNumber: task.callNumber,
      placeLabel: task.placeLabel,
      url: task.url,
      period: from && to ? (from === to ? from : `${from} – ${to}`) : (from ?? to),
      outcome: task.outcome,
    };
  });

  const people = [...graph.people.values()]
    .filter((person) => visible(person.id))
    .map((person) => ({ id: person.id, name: person.displayName }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  return {
    access,
    findings,
    unsourced,
    unsourcedTotal: eventCount + claimCount,
    contested,
    tasks,
    people,
  };
});
