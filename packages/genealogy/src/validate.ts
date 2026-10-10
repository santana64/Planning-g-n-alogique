import {
  isBefore,
  wholeYearsBetween,
  resolveLifespan,
  type GenealogicalDate,
  type JdnInterval,
  type Trivalent,
} from '@chronolignee/domain';
import {
  DEFAULT_THRESHOLDS,
  type EntityRef,
  type Finding,
  type FindingCode,
  type PlausibilityThresholds,
  type Severity,
} from './findings';
import {
  isParentType,
  type GenealogyGraph,
  type GraphEdge,
  type GraphEvent,
  type GraphPerson,
  type PersonId,
  type RelationshipType,
} from './graph';

/**
 * Genealogical validation.
 *
 * Two entry points with deliberately different contracts:
 *
 *   validateRelationshipProposal — asked BEFORE a write, may return blocking
 *                                  errors, and refusing is correct.
 *   auditPerson / auditTree      — asked ABOUT existing data, never blocks,
 *                                  and exists to give a researcher leads.
 *
 * The same underlying rule can appear in both. What changes is whether acting
 * on it is the user's choice.
 */

function personRef(person: GraphPerson | undefined, id: PersonId): EntityRef {
  return person ? { kind: 'PERSON', id, label: person.displayName } : { kind: 'PERSON', id };
}

function finding(
  code: FindingCode,
  severity: Severity,
  certainty: 'CERTAIN' | 'POSSIBLE',
  entities: readonly EntityRef[],
  params?: Record<string, string | number>,
  suggestedAction?: Finding['suggestedAction'],
): Finding {
  return {
    code,
    severity,
    certainty,
    entities,
    ...(params ? { params } : {}),
    ...(suggestedAction ? { suggestedAction } : {}),
  };
}

/**
 * Severity from certainty.
 *
 * This single function is what keeps hard invariants and research warnings
 * apart. A death certainly before a birth is corruption and blocks. The same
 * comparison over two "about 1877" dates is merely possible, and blocking it
 * would refuse perfectly ordinary imprecise data.
 */
function severityFrom(violation: Trivalent, hardWhenCertain: boolean): Severity | null {
  if (violation === 'NO') return null;
  if (violation === 'YES') return hardWhenCertain ? 'ERROR' : 'WARNING';
  return 'WARNING';
}

function certaintyFrom(violation: Trivalent): 'CERTAIN' | 'POSSIBLE' {
  return violation === 'YES' ? 'CERTAIN' : 'POSSIBLE';
}

type Bounded = { readonly earliest: number; readonly latest: number };

function bounded(interval: JdnInterval | null | undefined): interval is Bounded {
  return !!interval && interval.earliest !== null && interval.latest !== null;
}

/**
 * Does `a` come before `b` — and is that worth saying?
 *
 * `isBefore` answers MAYBE whenever it cannot tell, which includes the case
 * where one side has no date at all. An undated marriage is not "possibly
 * before the birth"; it is undated, and saying otherwise would bury every
 * real lead under one warning per undated record. So a MAYBE is kept only
 * when both windows are bounded and genuinely overlap. A YES is always kept:
 * "before 1800" is before a birth in 1850 even with its start unknown.
 */
function precedes(
  a: JdnInterval | null | undefined,
  b: JdnInterval | null | undefined,
): 'YES' | 'MAYBE' | null {
  if (!a || !b) return null;
  const answer = isBefore(a, b);
  if (answer === 'YES') return 'YES';
  if (answer === 'MAYBE' && bounded(a) && bounded(b)) return 'MAYBE';
  return null;
}

/** Events that make a union, for the marriage rules. */
const UNION_EVENTS: ReadonlySet<string> = new Set(['MARRIAGE', 'CIVIL_UNION', 'MARRIAGE_CONTRACT']);

/** Events about a life that may, and often do, come after it. */
const AFTER_DEATH_EVENTS: ReadonlySet<string> = new Set([
  'DEATH',
  'BURIAL',
  'CREMATION',
  'PROBATE',
]);

/**
 * The roles that make an event part of this person's own life.
 *
 * A father takes part in his child's birth, a godparent in a baptism, a
 * witness in a neighbour's marriage; none of those has to fall between the
 * participant's birth and death — a birth after the father's death is a
 * posthumous birth, and has its own rule.
 */
const OWN_ROLES: ReadonlySet<GraphEvent['role']> = new Set(['PRINCIPAL', 'SPOUSE']);

// --- Pre-write validation ---------------------------------------------------

export interface RelationshipProposal {
  readonly sourceId: PersonId;
  readonly targetId: PersonId;
  readonly type: RelationshipType;
}

/**
 * Validate a relationship before it is written.
 *
 * Returns blocking errors for the states the graph must never enter, and
 * warnings for everything else. Callers must refuse the write when any ERROR
 * is present.
 */
export function validateRelationshipProposal(
  graph: GenealogyGraph,
  proposal: RelationshipProposal,
  thresholds: PlausibilityThresholds = DEFAULT_THRESHOLDS,
): Finding[] {
  const findings: Finding[] = [];
  const { sourceId, targetId, type } = proposal;

  const source = graph.people.get(sourceId);
  const target = graph.people.get(targetId);
  const refs = [personRef(source, sourceId), personRef(target, targetId)];

  if (sourceId === targetId) {
    findings.push(
      finding('SELF_RELATIONSHIP', 'ERROR', 'CERTAIN', refs, undefined, 'REVIEW_RELATIONSHIP'),
    );
    return findings;
  }

  const alreadyExists = graph.edges.some(
    (e) => e.sourceId === sourceId && e.targetId === targetId && e.type === type,
  );
  if (alreadyExists) {
    findings.push(
      finding('DUPLICATE_RELATIONSHIP', 'ERROR', 'CERTAIN', refs, { type }, 'REVIEW_RELATIONSHIP'),
    );
  }

  if (isParentType(type)) {
    if (graph.wouldCreateCycle(sourceId, targetId)) {
      findings.push(
        finding('ANCESTRY_CYCLE', 'ERROR', 'CERTAIN', refs, undefined, 'REVIEW_RELATIONSHIP'),
      );
      // Everything below assumes an acyclic graph, so stop here.
      return findings;
    }
    if (source && target) {
      findings.push(...checkParentChildPlausibility(source, target, type, thresholds));
    }
  }

  return findings;
}

// --- Plausibility rules -----------------------------------------------------

function lifespanOf(person: GraphPerson, todayJdn: number): JdnInterval {
  if (person.lifespan) return person.lifespan;
  return resolveLifespan(
    {
      birth: person.birth ?? null,
      death: person.death ?? null,
      isDeceased: person.isDeceased ?? undefined,
    },
    todayJdn,
  ).interval;
}

/**
 * Age of `person` at `jdn`, as a certainty-aware comparison against a bound.
 * Returns how certainly the age was below (or above) the bound.
 */
function ageViolation(
  birth: GenealogicalDate | null | undefined,
  jdn: number,
  boundYears: number,
  direction: 'BELOW' | 'ABOVE',
): { violation: Trivalent; ageYears: number | null } {
  const interval = birth?.interval;
  if (!interval) return { violation: 'NO', ageYears: null };

  const calendar = birth?.calendar ?? 'GREGORIAN';

  // An earlier birth means an older person, so the two bounds of the birth
  // window give the two bounds of the age. Naming them by what they mean
  // rather than by which end of the interval they came from is what keeps the
  // comparisons below readable.
  const oldestAge =
    interval.earliest !== null ? wholeYearsBetween(interval.earliest, jdn, calendar) : null;
  const youngestAge =
    interval.latest !== null ? wholeYearsBetween(interval.latest, jdn, calendar) : null;

  if (oldestAge === null && youngestAge === null) return { violation: 'NO', ageYears: null };

  // Certain when even the most favourable reading of the birth window still
  // breaks the bound; merely possible when only the extreme reading does.
  const [certainAge, possibleAge] =
    direction === 'BELOW' ? [oldestAge, youngestAge] : [youngestAge, oldestAge];
  const breaks = (age: number): boolean =>
    direction === 'BELOW' ? age < boundYears : age > boundYears;

  if (certainAge !== null && breaks(certainAge)) {
    return { violation: 'YES', ageYears: certainAge };
  }
  if (possibleAge !== null && breaks(possibleAge)) {
    return { violation: 'MAYBE', ageYears: possibleAge };
  }
  return { violation: 'NO', ageYears: null };
}

export function checkParentChildPlausibility(
  parent: GraphPerson,
  child: GraphPerson,
  type: RelationshipType,
  thresholds: PlausibilityThresholds = DEFAULT_THRESHOLDS,
): Finding[] {
  const findings: Finding[] = [];
  const refs = [personRef(child, child.id), personRef(parent, parent.id)];

  const childBirth = child.birth?.interval;
  const parentBirth = parent.birth?.interval;
  if (!childBirth || childBirth.earliest === null) return findings;

  // --- Child born before the parent ---------------------------------------
  if (parentBirth) {
    const violation = isBefore(childBirth, parentBirth);
    const severity = severityFrom(violation, true);
    if (severity) {
      findings.push(
        finding(
          'CHILD_BORN_BEFORE_PARENT',
          severity,
          certaintyFrom(violation),
          refs,
          undefined,
          'REVIEW_DATES',
        ),
      );
      // A reversed generation makes every age check below meaningless.
      return findings;
    }
  }

  // Ages are measured at the child's earliest possible birth, which is the
  // most conservative choice: it cannot manufacture a violation.
  const childBirthJdn = childBirth.earliest;

  // --- Parent too young ---------------------------------------------------
  const tooYoung = ageViolation(parent.birth, childBirthJdn, thresholds.minParentAgeYears, 'BELOW');
  if (tooYoung.violation !== 'NO' && tooYoung.ageYears !== null) {
    findings.push(
      finding(
        'PARENT_TOO_YOUNG',
        'WARNING',
        certaintyFrom(tooYoung.violation),
        refs,
        { age: tooYoung.ageYears, threshold: thresholds.minParentAgeYears },
        'REVIEW_DATES',
      ),
    );
  }

  // --- Parent too old -----------------------------------------------------
  // Only applied to biological parentage: an adoptive parent of 70 is normal.
  if (type === 'PARENT_BIOLOGICAL') {
    // Deliberately conservative: with no recorded sex we fall through to the
    // wider paternal bound, which warns less. A false warning on every
    // undocumented parent would train the researcher to ignore warnings.
    const isMother = parent.recordedSex === 'FEMALE';
    const bound = isMother ? thresholds.maxMotherAgeYears : thresholds.maxFatherAgeYears;
    const code: FindingCode = isMother ? 'MOTHER_TOO_OLD' : 'FATHER_TOO_OLD';

    const tooOld = ageViolation(parent.birth, childBirthJdn, bound, 'ABOVE');
    if (tooOld.violation !== 'NO' && tooOld.ageYears !== null) {
      findings.push(
        finding(
          code,
          'WARNING',
          certaintyFrom(tooOld.violation),
          refs,
          { age: tooOld.ageYears, threshold: bound },
          'REVIEW_DATES',
        ),
      );
    }

    // --- Birth after the parent's death ----------------------------------
    const parentDeath = parent.death?.interval;
    if (parentDeath?.latest != null) {
      const gapDays = childBirthJdn - parentDeath.latest;
      if (gapDays > 0) {
        if (isMother) {
          // A delivery at or just after death is real; weeks later is not.
          if (gapDays > thresholds.maternalPostMortemMaxDays) {
            findings.push(
              finding(
                'BIRTH_AFTER_MOTHER_DEATH',
                'ERROR',
                'CERTAIN',
                refs,
                { days: gapDays },
                'REVIEW_DATES',
              ),
            );
          }
        } else if (gapDays > thresholds.posthumousBirthMaxDays) {
          findings.push(
            finding(
              'CHILD_BORN_BEFORE_PARENT',
              'WARNING',
              'CERTAIN',
              refs,
              { days: gapDays },
              'REVIEW_DATES',
            ),
          );
        } else {
          // Within gestation: a normal posthumous birth, worth noting only.
          findings.push(finding('POSTHUMOUS_BIRTH', 'INFO', 'CERTAIN', refs, { days: gapDays }));
        }
      }
    }
  }

  return findings;
}

// --- Audit of existing data -------------------------------------------------

export interface AuditOptions {
  readonly todayJdn: number;
  readonly thresholds?: PlausibilityThresholds;
}

/** Findings about one person. Never blocking. */
export function auditPerson(
  graph: GenealogyGraph,
  personId: PersonId,
  options: AuditOptions,
): Finding[] {
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
  const person = graph.people.get(personId);
  if (!person) return [];

  const findings: Finding[] = [];
  const self = [personRef(person, personId)];

  // --- Death before birth --------------------------------------------------
  // Through `precedes`, not `isBefore` alone: an unknown date is a window
  // with no bounds, and comparing two of them answered MAYBE — a "possible
  // death before birth" on every person recorded without dates.
  const deathFirst = precedes(person.death?.interval, person.birth?.interval);
  if (deathFirst) {
    const violation = deathFirst;
    const severity = severityFrom(violation, true);
    if (severity) {
      findings.push(
        finding(
          'DEATH_BEFORE_BIRTH',
          severity,
          certaintyFrom(violation),
          self,
          undefined,
          'REVIEW_CLAIMS',
        ),
      );
    }
  }

  // --- Implausible lifespan ------------------------------------------------
  const span = lifespanOf(person, options.todayJdn);
  if (span.earliest !== null && span.latest !== null) {
    const years = wholeYearsBetween(span.earliest, span.latest);
    if (years > thresholds.maxLifespanYears) {
      // Uncertain dates widen the window, so a wide window is not by itself
      // an implausible life. Only claim certainty when both ends are precise.
      const precise = person.birth?.precision === 'DAY' && person.death?.precision === 'DAY';
      findings.push(
        finding(
          'LIFESPAN_IMPLAUSIBLE',
          'WARNING',
          precise ? 'CERTAIN' : 'POSSIBLE',
          self,
          { years: Math.floor(years), threshold: thresholds.maxLifespanYears },
          'REVIEW_DATES',
        ),
      );
    }
  }

  // --- No temporal evidence at all ----------------------------------------
  if (span.earliest === null && span.latest === null) {
    findings.push(
      finding('NO_TEMPORAL_EVIDENCE', 'INFO', 'CERTAIN', self, undefined, 'ADD_SOURCE'),
    );
  }

  // --- Parent relationships ------------------------------------------------
  for (const edge of graph.parentsOf(personId)) {
    const parent = graph.people.get(edge.sourceId);
    if (parent)
      findings.push(...checkParentChildPlausibility(parent, person, edge.type, thresholds));
  }

  // --- Siblings born impossibly close --------------------------------------
  findings.push(...checkSiblingSpacing(graph, personId, thresholds));

  // --- The events of a life, against the life ------------------------------
  findings.push(...checkEventsInLife(person, personId, thresholds));

  // --- Two accepted answers to one question --------------------------------
  findings.push(...checkAcceptedClaims(person, personId));

  return findings;
}

/**
 * A person's own events, measured against their birth and death.
 *
 * Unions get their own codes because they are what researchers look at
 * first and what goes wrong most often (a marriage copied onto the wrong
 * generation). Everything else falls under EVENT_OUTSIDE_LIFESPAN.
 *
 * A marriage after death is a warning even when certain: French law allows
 * a posthumous marriage (article 171 of the Civil Code), so the date may be
 * right. Every other event before a birth or after a death is an error when
 * certain — nobody is censused before being born.
 */
function checkEventsInLife(
  person: GraphPerson,
  personId: PersonId,
  thresholds: PlausibilityThresholds,
): Finding[] {
  const events = person.events ?? [];
  if (events.length === 0) return [];

  const birth = person.birth?.interval;
  const death = person.death?.interval;
  const self = personRef(person, personId);
  const findings: Finding[] = [];

  // Only a certain ordering is reported here. Two windows at the same
  // precision overlap whenever they share a year: a baptism "1850" and a
  // birth "1850" are the normal case, not a possible baptism before birth.
  // A MAYBE would put a warning on every person whose records were dated to
  // the year, which is most people before 1800 — and the one real case it
  // could catch (a union in the year of birth) MARRIED_TOO_YOUNG reports.
  const before = (a: JdnInterval | null | undefined, b: JdnInterval | null | undefined) =>
    precedes(a, b) === 'YES';

  for (const event of events) {
    if (!OWN_ROLES.has(event.role)) continue;
    const when = event.date?.interval;
    if (!when) continue;
    const refs = event.eventId ? [self, { kind: 'EVENT' as const, id: event.eventId }] : [self];

    if (UNION_EVENTS.has(event.type)) {
      if (before(when, birth)) {
        findings.push(
          finding('MARRIAGE_BEFORE_BIRTH', 'ERROR', 'CERTAIN', refs, undefined, 'REVIEW_DATES'),
        );
        // An age at a union that precedes the birth is negative, and saying
        // so a second time adds nothing.
        continue;
      }

      if (before(death, when)) {
        findings.push(
          finding('MARRIAGE_AFTER_DEATH', 'WARNING', 'CERTAIN', refs, undefined, 'REVIEW_DATES'),
        );
      }

      if (bounded(birth) && bounded(when)) {
        // CERTAIN when even the oldest the person can have been is under the
        // threshold. POSSIBLE only when the most likely age — midpoint to
        // midpoint — is: two "about" dates ten years wide each can always
        // produce a child bride at their extremes (born "about 1708",
        // married "about 1728" allows ten), and flagging that would accuse
        // every couple recorded from an approximate register.
        const oldest = wholeYearsBetween(birth.earliest, when.latest);
        const likely = wholeYearsBetween(
          Math.floor((birth.earliest + birth.latest) / 2),
          Math.floor((when.earliest + when.latest) / 2),
        );
        const minimum = thresholds.minMarriageAgeYears;
        if (oldest < minimum || likely < minimum) {
          findings.push(
            finding(
              'MARRIED_TOO_YOUNG',
              'WARNING',
              oldest < minimum ? 'CERTAIN' : 'POSSIBLE',
              refs,
              { age: Math.max(0, oldest < minimum ? oldest : likely), threshold: minimum },
              'REVIEW_DATES',
            ),
          );
        }
      }
      continue;
    }

    // The end of a life before its start is DEATH_BEFORE_BIRTH's to report;
    // saying it again per burial and probate would only repeat it.
    if (event.type !== 'BIRTH' && !AFTER_DEATH_EVENTS.has(event.type)) {
      if (before(when, birth)) {
        findings.push(
          finding(
            'EVENT_OUTSIDE_LIFESPAN',
            'ERROR',
            'CERTAIN',
            refs,
            { eventType: event.type, side: 'BEFORE_BIRTH' },
            'REVIEW_DATES',
          ),
        );
        continue;
      }
    }

    if (!AFTER_DEATH_EVENTS.has(event.type)) {
      if (before(death, when)) {
        findings.push(
          finding(
            'EVENT_OUTSIDE_LIFESPAN',
            'ERROR',
            'CERTAIN',
            refs,
            { eventType: event.type, side: 'AFTER_DEATH' },
            'REVIEW_DATES',
          ),
        );
      }
    }
  }

  return findings;
}

/**
 * Two accepted claims that answer the same question differently.
 *
 * Accepting a claim is a researcher's judgement about which record to
 * believe; accepting two that cannot both be true means one judgement has to
 * be taken back. Overlapping windows ("1877" and "about 1877") are the same
 * answer at two precisions, and are not a contradiction.
 */
function checkAcceptedClaims(person: GraphPerson, personId: PersonId): Finding[] {
  const claims = person.acceptedDateClaims ?? [];
  if (claims.length < 2) return [];

  const findings: Finding[] = [];
  const reported = new Set<string>();
  for (let i = 0; i < claims.length; i += 1) {
    for (let j = i + 1; j < claims.length; j += 1) {
      const a = claims[i];
      const b = claims[j];
      if (!a || !b || a.predicate !== b.predicate || reported.has(a.predicate)) continue;
      const apart =
        isBefore(a.date.interval, b.date.interval) === 'YES' ||
        isBefore(b.date.interval, a.date.interval) === 'YES';
      if (!apart) continue;
      reported.add(a.predicate);
      const refs: EntityRef[] = [personRef(person, personId)];
      if (a.claimId) refs.push({ kind: 'CLAIM', id: a.claimId });
      if (b.claimId) refs.push({ kind: 'CLAIM', id: b.claimId });
      findings.push(
        finding(
          'CONTRADICTORY_ACCEPTED_CLAIMS',
          'WARNING',
          'CERTAIN',
          refs,
          { predicate: a.predicate },
          'REVIEW_CLAIMS',
        ),
      );
    }
  }
  return findings;
}

function checkSiblingSpacing(
  graph: GenealogyGraph,
  personId: PersonId,
  thresholds: PlausibilityThresholds,
): Finding[] {
  const person = graph.people.get(personId);
  const birth = person?.birth?.interval;
  if (!person || !birth || birth.earliest === null || birth.latest === null) return [];
  // Only meaningful for a precise birth; a year-wide window always "overlaps".
  if (birth.latest - birth.earliest > 31) return [];

  const findings: Finding[] = [];
  const reported = new Set<PersonId>();

  for (const parentEdge of graph.parentsOf(personId, true)) {
    for (const siblingEdge of graph.childrenOf(parentEdge.sourceId, true)) {
      const siblingId = siblingEdge.targetId;
      if (siblingId === personId || reported.has(siblingId)) continue;

      const sibling = graph.people.get(siblingId);
      const siblingBirth = sibling?.birth?.interval;
      if (!sibling || !siblingBirth?.earliest || !siblingBirth.latest) continue;
      if (siblingBirth.latest - siblingBirth.earliest > 31) continue;

      const gap = Math.abs(birth.earliest - siblingBirth.earliest);
      // Twins are the obvious exception and are not a finding.
      if (gap > 2 && gap < thresholds.minSiblingIntervalDays) {
        reported.add(siblingId);
        findings.push(
          finding(
            'SIBLINGS_BORN_TOO_CLOSE',
            'WARNING',
            'CERTAIN',
            [personRef(person, personId), personRef(sibling, siblingId)],
            { days: gap },
            'REVIEW_DATES',
          ),
        );
      }
    }
  }
  return findings;
}

/** Whole-tree audit. Used by the Research surface and after an import. */
export function auditTree(graph: GenealogyGraph, options: AuditOptions): Finding[] {
  const findings: Finding[] = [];

  // Cycles first: they invalidate every other traversal-based check.
  for (const cycle of graph.findCycles()) {
    findings.push(
      finding(
        'ANCESTRY_CYCLE',
        'ERROR',
        'CERTAIN',
        cycle.map((id) => personRef(graph.people.get(id), id)),
        { length: cycle.length },
        'REVIEW_RELATIONSHIP',
      ),
    );
  }

  for (const id of graph.people.keys()) {
    findings.push(...auditPerson(graph, id, options));
  }

  const components = graph.components();
  if (components.length > 1) {
    // Sorted so the largest component is the "main" family.
    const sorted = [...components].sort((a, b) => b.length - a.length);
    for (const component of sorted.slice(1)) {
      const firstId = component[0];
      if (!firstId) continue;
      findings.push(
        finding(
          'DISCONNECTED_COMPONENT',
          'INFO',
          'CERTAIN',
          [personRef(graph.people.get(firstId), firstId)],
          { size: component.length },
        ),
      );
    }
  }

  return dedupeFindings(findings);
}

/**
 * Collapse findings that describe the same problem from both ends.
 * A parent/child age warning is discovered once from each person.
 */
function dedupeFindings(findings: readonly Finding[]): Finding[] {
  const seen = new Map<string, Finding>();
  for (const f of findings) {
    const key = [f.code, ...f.entities.map((e) => e.id).sort()].join('|');
    const existing = seen.get(key);
    // Keep the more severe, then the more certain, version.
    if (!existing) {
      seen.set(key, f);
    } else if (existing.severity !== 'ERROR' && f.severity === 'ERROR') {
      seen.set(key, f);
    } else if (existing.certainty === 'POSSIBLE' && f.certainty === 'CERTAIN') {
      seen.set(key, f);
    }
  }
  return [...seen.values()];
}

export type { GraphEdge };
