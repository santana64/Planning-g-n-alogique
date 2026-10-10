import { describe, expect, it } from 'vitest';
import { gregorianToJdn } from '@chronolignee/domain';
import type { StoryDate, StoryPlan } from '@chronolignee/engine';
import type { StoryViewPerson } from '@/server/story';
import { ageText, dateClause, describeCandidate, ofName, renderStory, routeOf } from './sentences';

/**
 * The words of a story: every one of them has to be defensible from the
 * record, in correct French.
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
  birth: { date: exact(1884, 3, 15, '15 mars 1884'), place: PARIS, sources: [] },
});
const PAUL = person({
  id: 'paul',
  name: 'Paul MOREAU',
  recordedSex: 'MALE',
  birth: { date: exact(1850, 3, 11, '11 mars 1850'), place: TOURS, sources: [REGISTER] },
  death: { date: exact(1912, 1, 2, '2 janvier 1912'), place: TOURS, sources: [] },
  occupations: [{ label: 'Tonnelier', date: exact(1866, 1, 1, '1866'), sources: [] }],
});

describe('French, done properly', () => {
  it('elides before a vowel, and only there', () => {
    expect(ofName('Émile MOREAU')).toBe('d’Émile MOREAU');
    expect(ofName('Adèle MOREAU')).toBe('d’Adèle MOREAU');
    expect(ofName('Paul MOREAU')).toBe('de Paul MOREAU');
  });

  it('puts the right words before each kind of date', () => {
    expect(dateClause('15 mars 1884')).toBe('le 15 mars 1884');
    expect(dateClause('1er mai 1702')).toBe('le 1er mai 1702');
    expect(dateClause('18 brumaire an VIII')).toBe('le 18 brumaire an VIII');
    expect(dateClause('1884')).toBe('en 1884');
    expect(dateClause('mars 1884')).toBe('en mars 1884');
    expect(dateClause('germinal an VII')).toBe('en germinal an VII');
    expect(dateClause('an VII')).toBe('en l’an VII');
    expect(dateClause('vers 1750')).toBe('vers 1750');
    expect(dateClause('entre 1840 et 1845')).toBe('entre 1840 et 1845');
  });

  it('says an age once when it is known, and as a range when it is not', () => {
    expect(ageText({ min: 34, max: 34 })).toBe('34 ans');
    expect(ageText({ min: 1, max: 1 })).toBe('1 an');
    expect(ageText({ min: 24, max: 35 })).toBe('entre 24 et 35 ans');
  });
});

describe('a climb, told', () => {
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
  const chapters = renderStory({ plan, people: { emile: EMILE, paul: PAUL }, history: {} });

  it('opens on the subject, with the year of their birth', () => {
    expect(chapters[0]).toMatchObject({ title: 'Émile MOREAU', marker: '1884', year: 1884 });
    expect(chapters[0]?.sentences[0]?.text).toBe('Naît le 15 mars 1884 à Paris.');
  });

  it('names each ancestor by their relation to the person below', () => {
    expect(chapters[1]?.eyebrow).toBe('Père d’Émile MOREAU · 1re génération');
    expect(chapters[1]?.sentences.map((sentence) => sentence.text)).toEqual([
      'Naît le 11 mars 1850 à Tours.',
      'Tonnelier (1866).',
      'Meurt le 2 janvier 1912 à Tours.',
      'Il a 34 ans à la naissance d’Émile MOREAU.',
    ]);
  });

  it('carries each fact’s sources, and marks the facts that have none', () => {
    const [birth, occupation] = chapters[1]?.sentences ?? [];
    expect(birth?.sources).toEqual([REGISTER]);
    expect(occupation).toMatchObject({ factual: true, sources: [] });
  });

  it('tells a move as an aside of the generation it belongs to', () => {
    const [move] = chapters[1]?.asides ?? [];
    expect(move?.title).toBe('De Tours à Paris');
    expect(move?.sentences[0]?.text).toBe(
      'La naissance de Paul MOREAU est enregistrée à Tours, celle de son fils Émile MOREAU à Paris : 205 km les séparent.',
    );
  });

  it('ends on what is missing, as the place research continues', () => {
    expect(chapters[2]?.sentences[0]?.text).toBe(
      'Le père de Paul MOREAU n’est pas connu : c’est là que la recherche continue.',
    );
  });

  it('only ever moves the clock back', () => {
    // The move is an aside, not a chapter: it does not repeat 1884 after 1850.
    const years = chapters.flatMap((chapter) => (chapter.year === null ? [] : [chapter.year]));
    expect(years).toEqual([1884, 1850]);
  });
});

describe('what the record says, and no more', () => {
  it('writes a baptism as a baptism, agreed with the person', () => {
    const baptised = person({
      id: 'r',
      name: 'Rosalie CHASSAGNE',
      recordedSex: 'FEMALE',
      birth: { date: exact(1827, 3, 2, '2 mars 1827'), place: null, sources: [] },
      birthRecordedAs: 'baptism',
    });
    const [scene] = renderStory({
      plan: {
        subjectId: 'r',
        line: 'paternal',
        generations: 0,
        scenes: [{ kind: 'person-focus', personId: 'r' }],
      },
      people: { r: baptised },
      history: {},
    });
    expect(scene?.sentences[0]?.text).toBe('Baptisée le 2 mars 1827.');
  });

  it('does not guess a pronoun the record does not give', () => {
    const unknown = person({
      id: 'u',
      name: 'Dominique CHASSAGNE',
      birth: { date: exact(1800, 1, 1, '1er janvier 1800'), place: null, sources: [] },
    });
    const [, step] = renderStory({
      plan: {
        subjectId: 'emile',
        line: 'oldest',
        generations: 1,
        scenes: [
          { kind: 'person-focus', personId: 'emile' },
          {
            kind: 'ancestor-step',
            childId: 'emile',
            parentId: 'u',
            relation: 'father',
            generation: 1,
            ageAtChildBirth: { min: 84, max: 84 },
          },
        ],
      },
      people: { emile: EMILE, u: unknown },
      history: {},
    });
    expect(step?.sentences.at(-1)?.text).toBe(
      'Dominique CHASSAGNE a 84 ans à la naissance d’Émile MOREAU.',
    );
  });

  it('keeps history apart from the family’s own record, and off the clock', () => {
    const [chapter] = renderStory({
      plan: {
        subjectId: 'paul',
        line: 'paternal',
        generations: 0,
        scenes: [
          { kind: 'person-focus', personId: 'paul' },
          {
            kind: 'historical-context',
            personId: 'paul',
            eventId: 'ww1',
            age: { min: 64, max: 64 },
          },
        ],
      },
      people: { paul: PAUL },
      history: {
        ww1: {
          id: 'ww1',
          title: 'Première Guerre mondiale',
          startJdn: gregorianToJdn(1914, 7, 28),
          endJdn: gregorianToJdn(1918, 11, 11),
          significance: 5,
          category: 'WAR',
        },
      },
    });
    // 1914 is shown beside the aside, but the chapter's clock stays at 1850.
    expect(chapter?.year).toBe(1850);
    const [context] = chapter?.asides ?? [];
    expect(context).toMatchObject({ eyebrow: 'Contexte historique', marker: '1914' });
    expect(context?.sentences[0]?.text).toBe(
      '« Première Guerre mondiale » commence en 1914 : Paul MOREAU a alors 64 ans.',
    );
    expect(context?.sentences.every((sentence) => !sentence.factual)).toBe(true);
  });

  it('tells a recorded migration as the record gives it, with its source', () => {
    const emigrant = person({
      id: 'g',
      name: 'Gustave CHASSAGNE',
      recordedSex: 'MALE',
      moves: [
        {
          kind: 'migration',
          date: exact(1891, 4, 2, '2 avril 1891'),
          place: { id: 'ba', name: 'Buenos Aires', latitude: -34.6, longitude: -58.38 },
          sources: [{ title: 'Registre des passagers, Le Havre', locator: null }],
        },
        {
          kind: 'naturalization',
          date: exact(1903, 1, 1, '1903'),
          place: null,
          sources: [],
        },
      ],
    });
    const [chapter] = renderStory({
      plan: {
        subjectId: 'g',
        line: 'paternal',
        generations: 0,
        scenes: [{ kind: 'person-focus', personId: 'g' }],
      },
      people: { g: emigrant },
      history: {},
    });
    expect(chapter?.sentences.map((sentence) => sentence.text)).toEqual([
      'Migration enregistrée le 2 avril 1891, Buenos Aires.',
      'Naturalisé en 1903.',
    ]);
    expect(chapter?.sentences[0]?.sources).toHaveLength(1);
  });

  it('marks an approximate year as approximate beside the scene', () => {
    const approximate = person({
      id: 'a',
      name: 'Mathurin CHASSAGNE',
      birth: {
        date: {
          label: 'vers 1702',
          earliestJdn: gregorianToJdn(1697, 1, 1),
          latestJdn: gregorianToJdn(1707, 12, 31),
        },
        place: null,
        sources: [],
      },
    });
    const [scene] = renderStory({
      plan: {
        subjectId: 'a',
        line: 'paternal',
        generations: 0,
        scenes: [{ kind: 'person-focus', personId: 'a' }],
      },
      people: { a: approximate },
      history: {},
    });
    expect(scene?.marker).toBe('v. 1702');
    expect(scene?.sentences[0]?.text).toBe('Naît vers 1702.');
  });

  it('ends before a living parent without naming them', () => {
    const [scene] = renderStory({
      plan: {
        subjectId: 'emile',
        line: 'maternal',
        generations: 0,
        scenes: [{ kind: 'end', personId: 'emile', reason: 'protected', missing: 'mother' }],
      },
      people: { emile: EMILE },
      history: {},
    });
    expect(scene?.sentences[0]?.text).toBe(
      'La mère d’Émile MOREAU est une personne protégée : rien n’est publié à son sujet, et le récit s’arrête avant.',
    );
  });
});

describe('a Director candidate, in words', () => {
  const people = new Map([
    ['gustave', person({ id: 'gustave', name: 'Gustave CHASSAGNE' })],
    ['emile', person({ id: 'emile', name: 'Émile MOREAU' })],
  ]);

  it('names a move by its two ends and its length', () => {
    expect(
      describeCandidate(
        {
          kind: 'migration',
          parentId: 'gustave',
          childId: 'emile',
          from: 'Tours',
          to: 'Buenos Aires',
          distanceKm: 10950,
        },
        'emile',
        people,
      ),
    ).toEqual({
      title: 'De Tours à Buenos Aires',
      reason: '10 950 km entre la naissance de Gustave CHASSAGNE et celle d’Émile MOREAU.',
    });
  });

  it('counts what it claims, with agreement', () => {
    expect(
      describeCandidate({ kind: 'well-documented', events: 3, cited: 1 }, 'emile', people).reason,
    ).toBe('Émile MOREAU : 1 événement sourcé sur 3.');
    expect(
      describeCandidate({ kind: 'deep-line', generations: 6, earliestYear: null }, 'emile', people)
        .reason,
    ).toBe('6 générations depuis Émile MOREAU.');
  });
});

describe('scenes with a photograph and a route', () => {
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
        ageAtChildBirth: null,
      },
      {
        kind: 'migration',
        childId: 'emile',
        parentId: 'paul',
        from: TOURS,
        to: PARIS,
        distanceKm: 205,
      },
    ],
  };
  const photo = { src: '/api/trees/t/media/m?variant=preview', title: 'Illustration — La noce' };
  const chapters = renderStory({
    plan,
    people: { emile: EMILE, paul: PAUL },
    history: {},
    photos: { paul: photo },
  });

  it('shows a person’s photograph with their chapter, and only theirs', () => {
    expect(chapters[0]?.photo).toBeNull();
    expect(chapters[1]?.photo).toEqual(photo);
  });

  it('draws a move between two located places', () => {
    expect(chapters[1]?.asides[0]?.route).toEqual({
      from: { name: 'Tours', latitude: 47.39, longitude: 0.68 },
      to: { name: 'Paris', latitude: 48.86, longitude: 2.35 },
    });
  });

  it('draws no route when a place has no coordinates', () => {
    expect(routeOf({ name: 'Ailleurs', latitude: null, longitude: null }, PARIS)).toBeNull();
  });
});
