import { describe, expect, it } from 'vitest';
import { parseGenealogicalDate, unknownDate } from '@chronolignee/domain';
import { GenealogyGraph, type GraphEvent, type GraphPerson } from './graph';
import type { Finding, FindingCode } from './findings';
import { auditPerson } from './validate';

/**
 * The events of a life, measured against the life.
 *
 * Every rule here has a false positive that would make it useless if it
 * fired — an undated marriage "possibly before the birth", a father's
 * presence at his posthumous child's birth, a burial after a death — and
 * those are tested as carefully as the true positives.
 */

const TODAY = 2_461_299; // 15 September 2026

const date = (text: string) => parseGenealogicalDate(text);

function event(type: string, when: string | null, role: GraphEvent['role'] = 'PRINCIPAL') {
  return { eventId: `${type}-${when ?? 'undated'}`, type, role, date: when ? date(when) : null };
}

function audit(person: Partial<GraphPerson> & { id?: string }): Finding[] {
  const subject: GraphPerson = { id: 'p', displayName: 'Jean ROUX', ...person };
  return auditPerson(new GenealogyGraph([subject], []), subject.id, { todayJdn: TODAY });
}

const codes = (findings: Finding[]): FindingCode[] => findings.map((f) => f.code);
const only = (findings: Finding[], code: FindingCode) => findings.filter((f) => f.code === code);

describe('a person recorded without dates', () => {
  it('is not suspected of dying before being born', () => {
    // The database hands the audit an unknown date, not a missing one: a
    // window with no bounds. Compared naively, two of those said MAYBE.
    const findings = audit({ birth: unknownDate(), death: unknownDate() });
    expect(codes(findings)).not.toContain('DEATH_BEFORE_BIRTH');
  });

  it('is not suspected about an undated marriage either', () => {
    const findings = audit({
      birth: date('1850'),
      death: date('1910'),
      events: [event('MARRIAGE', null, 'SPOUSE')],
    });
    expect(codes(findings)).toEqual([]);
  });
});

describe('a marriage against the life', () => {
  it('is an error when it certainly precedes the birth', () => {
    const [found] = only(
      audit({ birth: date('12 JUN 1850'), events: [event('MARRIAGE', '3 MAY 1841', 'SPOUSE')] }),
      'MARRIAGE_BEFORE_BIRTH',
    );
    expect(found?.severity).toBe('ERROR');
    expect(found?.certainty).toBe('CERTAIN');
    // The event is named, so the review can go straight to it.
    expect(found?.entities.map((entity) => entity.kind)).toEqual(['PERSON', 'EVENT']);
  });

  it('reports a union in the year of birth as an age, not as "possibly before"', () => {
    const findings = audit({ birth: date('1850'), events: [event('MARRIAGE', '1850', 'SPOUSE')] });
    expect(codes(findings)).toEqual(['MARRIED_TOO_YOUNG']);
    expect(findings[0]?.params).toEqual({ age: 0, threshold: 12 });
  });

  it('stays a warning after the death, because a posthumous marriage is lawful', () => {
    const [found] = only(
      audit({
        birth: date('1850'),
        death: date('2 FEB 1880'),
        events: [event('MARRIAGE', '14 JUL 1881', 'SPOUSE')],
      }),
      'MARRIAGE_AFTER_DEATH',
    );
    expect(found?.severity).toBe('WARNING');
    expect(found?.certainty).toBe('CERTAIN');
  });

  it('flags a bride of ten, and not one of twenty', () => {
    const young = only(
      audit({ birth: date('4 MAR 1850'), events: [event('MARRIAGE', '9 SEP 1860', 'SPOUSE')] }),
      'MARRIED_TOO_YOUNG',
    );
    expect(young).toHaveLength(1);
    expect(young[0]?.certainty).toBe('CERTAIN');
    expect(young[0]?.params).toEqual({ age: 10, threshold: 12 });

    expect(
      codes(audit({ birth: date('1850'), events: [event('MARRIAGE', '1870', 'SPOUSE')] })),
    ).not.toContain('MARRIED_TOO_YOUNG');
  });

  it('says "possibly" when the likely age is under the threshold but not the oldest', () => {
    // Born some time in 1850, married in June 1862: most likely eleven,
    // twelve at the very most.
    const [found] = only(
      audit({ birth: date('1850'), events: [event('MARRIAGE', 'JUN 1862', 'SPOUSE')] }),
      'MARRIED_TOO_YOUNG',
    );
    expect(found?.certainty).toBe('POSSIBLE');
    expect(found?.params).toEqual({ age: 11, threshold: 12 });
  });

  it('does not accuse a couple recorded with two approximate dates', () => {
    // The demonstration's Perrine: born about 1708, married about 1728. The
    // windows allow a bride of ten; the likely age is twenty.
    const findings = audit({
      birth: date('ABT 1708'),
      events: [event('MARRIAGE', 'ABT 1728', 'SPOUSE')],
    });
    expect(codes(findings)).toEqual([]);
  });

  it('does not add an age to a marriage already before the birth', () => {
    const findings = audit({
      birth: date('1850'),
      events: [event('MARRIAGE', '1840', 'SPOUSE')],
    });
    expect(codes(findings)).toEqual(['MARRIAGE_BEFORE_BIRTH']);
  });
});

describe('the other events of a life', () => {
  it('flags a census after the death, and names which side of the life', () => {
    const [found] = only(
      audit({
        birth: date('1820'),
        death: date('5 JAN 1870'),
        events: [event('CENSUS', '1876')],
      }),
      'EVENT_OUTSIDE_LIFESPAN',
    );
    expect(found?.severity).toBe('ERROR');
    expect(found?.params).toEqual({ eventType: 'CENSUS', side: 'AFTER_DEATH' });
  });

  it('flags a baptism before the birth', () => {
    const [found] = only(
      audit({ birth: date('12 JUN 1850'), events: [event('BAPTISM', '1 JUN 1850')] }),
      'EVENT_OUTSIDE_LIFESPAN',
    );
    expect(found?.params).toEqual({ eventType: 'BAPTISM', side: 'BEFORE_BIRTH' });
  });

  it('does not suspect a baptism dated to the year of the birth', () => {
    // The false positive that held this rule back: both dated "1850", the
    // windows overlap, and an uncertain comparison said "maybe before".
    const findings = audit({
      birth: date('1850'),
      death: date('1910'),
      events: [event('BAPTISM', '1850'), event('CENSUS', '1910')],
    });
    expect(codes(findings)).toEqual([]);
  });

  it('does not repeat a death before birth for each burial, nor for the birth itself', () => {
    // Found end to end: the birth event, dated after the death, came out a
    // second time as "an event after the death".
    const findings = audit({
      birth: date('1850'),
      death: date('1840'),
      events: [event('BIRTH', '1850'), event('DEATH', '1840'), event('BURIAL', '1840')],
    });
    expect(codes(findings)).toEqual(['DEATH_BEFORE_BIRTH']);
  });

  it('leaves alone what normally follows a death', () => {
    const findings = audit({
      birth: date('1820'),
      death: date('5 JAN 1870'),
      events: [
        event('BURIAL', '8 JAN 1870'),
        event('PROBATE', '1871'),
        event('DEATH', '5 JAN 1870'),
      ],
    });
    expect(codes(findings)).toEqual([]);
  });

  it('does not measure an event the person only attended', () => {
    // A father is a participant in his posthumous child's birth; a witness
    // may sign a record years before a later namesake is born. Neither is an
    // event of their own life.
    const findings = audit({
      birth: date('1820'),
      death: date('5 JAN 1870'),
      events: [event('BIRTH', '3 JUL 1870', 'PARENT'), event('MARRIAGE', '1810', 'WITNESS')],
    });
    expect(codes(findings)).toEqual([]);
  });
});

describe('two accepted answers to one question', () => {
  it('reports accepted births that cannot both be true', () => {
    const [found] = only(
      audit({
        birth: date('1850'),
        acceptedDateClaims: [
          { claimId: 'c1', predicate: 'BIRTH_DATE', date: date('1850') },
          { claimId: 'c2', predicate: 'BIRTH_DATE', date: date('1856') },
        ],
      }),
      'CONTRADICTORY_ACCEPTED_CLAIMS',
    );
    expect(found?.params).toEqual({ predicate: 'BIRTH_DATE' });
    expect(found?.entities.map((entity) => entity.kind)).toEqual(['PERSON', 'CLAIM', 'CLAIM']);
  });

  it('treats one answer at two precisions as one answer', () => {
    const findings = audit({
      birth: date('1850'),
      acceptedDateClaims: [
        { predicate: 'BIRTH_DATE', date: date('12 JUN 1850') },
        { predicate: 'BIRTH_DATE', date: date('ABT 1850') },
      ],
    });
    expect(codes(findings)).not.toContain('CONTRADICTORY_ACCEPTED_CLAIMS');
  });
});
