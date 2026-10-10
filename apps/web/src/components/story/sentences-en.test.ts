import { describe, expect, it } from 'vitest';
import { gregorianToJdn } from '@chronolignee/domain';
import type { StoryDate, StoryPlan } from '@chronolignee/engine';
import type { StoryViewPerson } from '@/server/story';
import { describeCandidate, renderStory } from './sentences';
import { ageTextEn, dateClauseEn, possessive } from './sentences-en';

/**
 * The English telling: the same facts, the same sources, in English that
 * reads as English rather than as French with the words swapped.
 */

function exact(year: number, month: number, day: number, label: string): StoryDate {
  const jdn = gregorianToJdn(year, month, day);
  return { label, earliestJdn: jdn, latestJdn: jdn };
}

const TOURS = { id: 'tours', name: 'Tours', latitude: 47.39, longitude: 0.68 };
const PARIS = { id: 'paris', name: 'Paris', latitude: 48.86, longitude: 2.35 };
const REGISTER = { title: 'Registres d’état civil, Tours (1793-1902)', locator: 'vue 118' };

function person(fields: Partial<StoryViewPerson> & { id: string; name: string }): StoryViewPerson {
  return {
    recordedSex: null,
    hidden: false,
    birth: null,
    death: null,
    occupations: [],
    fatherId: null,
    motherId: null,
    migrated: false,
    moves: [],
    birthRecordedAs: fields.birth ? 'birth' : null,
    deathRecordedAs: fields.death ? 'death' : null,
    ...fields,
  };
}

const EMILE = person({
  id: 'emile',
  name: 'Émile MOREAU',
  recordedSex: 'MALE',
  birth: { date: exact(1884, 3, 15, '15 March 1884'), place: PARIS, sources: [] },
});
const PAUL = person({
  id: 'paul',
  name: 'Paul MOREAU',
  recordedSex: 'MALE',
  birth: { date: exact(1850, 3, 11, '11 March 1850'), place: TOURS, sources: [REGISTER] },
  death: { date: exact(1912, 1, 2, '2 January 1912'), place: TOURS, sources: [] },
});

describe('English, done properly', () => {
  it('puts the right words before each kind of date', () => {
    expect(dateClauseEn('15 March 1884')).toBe('on 15 March 1884');
    expect(dateClauseEn('1884')).toBe('in 1884');
    expect(dateClauseEn('March 1884')).toBe('in March 1884');
    expect(dateClauseEn('about 1750')).toBe('about 1750');
    expect(dateClauseEn('between 1840 and 1845')).toBe('between 1840 and 1845');
  });

  it('says ages and possessives as English does', () => {
    expect(ageTextEn({ min: 1, max: 1 })).toBe('1 year old');
    expect(ageTextEn({ min: 34, max: 34 })).toBe('34 years old');
    expect(ageTextEn({ min: 24, max: 35 })).toBe('between 24 and 35 years old');
    expect(possessive('Paul MOREAU')).toBe('Paul MOREAU’s');
    expect(possessive('Thomas')).toBe('Thomas’');
  });
});

describe('a climb, told in English', () => {
  const plan: StoryPlan = {
    subjectId: 'emile',
    line: 'paternal',
    generations: 1,
    scenes: [
      { kind: 'person-focus', personId: 'emile' },
      {
        kind: 'ancestor-step',
        childId: 'emile',
        parentId: 'paul',
        relation: 'father',
        generation: 1,
        ageAtChildBirth: { min: 34, max: 34 },
      },
      {
        kind: 'migration',
        childId: 'emile',
        parentId: 'paul',
        from: TOURS,
        to: PARIS,
        distanceKm: 205,
      },
      { kind: 'end', personId: 'paul', reason: 'unknown-parent', missing: 'father' },
    ],
  };
  const chapters = renderStory({
    plan,
    people: { emile: EMILE, paul: PAUL },
    history: {},
    locale: 'en',
  });

  it('tells each life in English, keeping its sources', () => {
    expect(chapters[0]?.eyebrow).toBe('Starting point');
    expect(chapters[0]?.sentences[0]?.text).toBe('Born on 15 March 1884 in Paris.');
    expect(chapters[1]?.eyebrow).toBe('Father of Émile MOREAU · 1st generation');
    expect(chapters[1]?.sentences.map((sentence) => sentence.text)).toEqual([
      'Born on 11 March 1850 in Tours.',
      'Died on 2 January 1912 in Tours.',
      'He was 34 years old when Émile MOREAU was born.',
    ]);
    expect(chapters[1]?.sentences[0]?.sources).toEqual([REGISTER]);
  });

  it('tells the move and the end of the line', () => {
    expect(chapters[1]?.asides[0]?.sentences[0]?.text).toBe(
      'Paul MOREAU’s birth is recorded in Tours, that of his son Émile MOREAU in Paris: 205 km apart.',
    );
    expect(chapters[2]?.sentences[0]?.text).toBe(
      'Paul MOREAU’s father is not known: that is where the research goes on.',
    );
  });

  it('describes a suggestion in English', () => {
    const people = new Map([
      ['emile', EMILE],
      ['paul', PAUL],
    ]);
    expect(
      describeCandidate({ kind: 'well-documented', cited: 3, events: 4 }, 'paul', people, 'en'),
    ).toEqual({ title: 'A well-documented life', reason: 'Paul MOREAU: 3 of 4 events sourced.' });
  });
});
