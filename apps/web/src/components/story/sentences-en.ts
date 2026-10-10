import { jdnToGregorian } from '@chronolignee/domain';
import type { AgeRange, StoryCandidateFacts, StoryDate, StoryScene } from '@chronolignee/engine';
import type { StoryViewPerson } from '@/server/story';
import {
  routeOf,
  type RenderedAside,
  type RenderedChapter,
  type StoryInput,
  type StorySentence,
} from './sentences';

/**
 * A story plan, told in English.
 *
 * The same scenes as the French telling, built from the same facts and
 * carrying the same sources: a translation of the sentences, not a second
 * narrator. Nothing is added that the record does not hold. Historical
 * events keep the catalogue's French titles — the catalogue is written in
 * French, and a title is quoted rather than paraphrased.
 */

/** "on 15 March 1884", "in 1884", "in March 1884"; "about 1750" carries its own. */
export function dateClauseEn(label: string): string {
  if (/^\d{1,2} /.test(label)) return `on ${label}`;
  if (/^\d{3,4}$/.test(label) || /^[A-Z][a-z]+ \d{3,4}$/.test(label)) return `in ${label}`;
  return label;
}

export function ageTextEn(age: AgeRange): string {
  if (age.min === age.max) return age.min === 1 ? '1 year old' : `${age.min} years old`;
  return `between ${age.min} and ${age.max} years old`;
}

/** "Jean’s", "Thomas’" — the possessive, as English writes it. */
export function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}’` : `${name}’s`;
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

function yearOf(date: StoryDate | null | undefined): {
  marker: string | null;
  year: number | null;
} {
  if (!date) return { marker: null, year: null };
  const { earliestJdn, latestJdn } = date;
  if (earliestJdn !== null && latestJdn !== null) {
    const first = jdnToGregorian(earliestJdn).year;
    const last = jdnToGregorian(latestJdn).year;
    const middle = jdnToGregorian(Math.round((earliestJdn + latestJdn) / 2)).year;
    return { marker: first === last ? String(first) : `c. ${middle}`, year: middle };
  }
  if (latestJdn !== null) {
    const year = jdnToGregorian(latestJdn).year;
    return { marker: `bef. ${year}`, year };
  }
  if (earliestJdn !== null) {
    const year = jdnToGregorian(earliestJdn).year;
    return { marker: `aft. ${year}`, year };
  }
  return { marker: null, year: null };
}

function lifeSentences(person: StoryViewPerson): StorySentence[] {
  const sentences: StorySentence[] = [];
  const at = (place: { name: string } | null) => (place ? ` in ${place.name}` : '');

  if (person.birth) {
    const { date, place, sources } = person.birth;
    const when = date ? ` ${dateClauseEn(date.label)}` : '';
    const where = at(place);
    const text =
      person.birthRecordedAs === 'baptism'
        ? `Baptised${when}${where}.`
        : date
          ? `Born${when}${where}.`
          : `Born${where}, on a date the register does not give.`;
    sentences.push({ text, sources, factual: true });
  }

  for (const occupation of person.occupations) {
    const when = occupation.date ? ` (${occupation.date.label})` : '';
    sentences.push({
      text: `${occupation.label}${when}.`,
      sources: occupation.sources,
      factual: true,
    });
  }

  for (const move of person.moves) {
    const when = move.date ? ` ${dateClauseEn(move.date.label)}` : '';
    const where = move.place ? `, ${move.place.name}` : '';
    const text =
      move.kind === 'naturalization'
        ? `Naturalised${when}${where}.`
        : `Migration recorded${when}${where}.`;
    sentences.push({ text, sources: move.sources, factual: true });
  }

  if (person.death) {
    const { date, place, sources } = person.death;
    const when = date ? ` ${dateClauseEn(date.label)}` : '';
    const where = at(place);
    const text =
      person.deathRecordedAs === 'burial' ? `Buried${when}${where}.` : `Died${when}${where}.`;
    sentences.push({ text, sources, factual: true });
  }

  return sentences;
}

function subjectPronoun(person: StoryViewPerson): string {
  if (person.recordedSex === 'MALE') return 'He';
  if (person.recordedSex === 'FEMALE') return 'She';
  return person.name;
}

function childNoun(parent: StoryViewPerson, child: StoryViewPerson): string {
  const their =
    parent.recordedSex === 'MALE' ? 'his' : parent.recordedSex === 'FEMALE' ? 'her' : 'their';
  if (child.recordedSex === 'MALE') return `${their} son`;
  if (child.recordedSex === 'FEMALE') return `${their} daughter`;
  return `${their} child`;
}

type Rendered = { readonly chapter: RenderedChapter } | { readonly aside: RenderedAside } | null;

export function renderSceneEn(scene: StoryScene, index: number, input: StoryInput): Rendered {
  const key = `${index}-${scene.kind}`;
  const person = (id: string) => input.people[id];

  switch (scene.kind) {
    case 'person-focus': {
      const subject = person(scene.personId);
      if (!subject) return null;
      return {
        chapter: {
          key,
          kind: 'person',
          ...yearOf(subject.birth?.date),
          eyebrow: 'Starting point',
          title: subject.name,
          sentences: lifeSentences(subject),
          asides: [],
          personId: subject.id,
          photo: input.photos?.[subject.id] ?? null,
        },
      };
    }

    case 'ancestor-step': {
      const child = person(scene.childId);
      const parent = person(scene.parentId);
      if (!child || !parent) return null;
      const relation = scene.relation === 'father' ? 'Father' : 'Mother';
      const sentences = lifeSentences(parent);
      if (scene.ageAtChildBirth) {
        sentences.push({
          text: `${subjectPronoun(parent)} was ${ageTextEn(scene.ageAtChildBirth)} when ${child.name} was born.`,
          sources: [],
          factual: false,
        });
      }
      return {
        chapter: {
          key,
          kind: 'person',
          ...yearOf(parent.birth?.date),
          eyebrow: `${relation} of ${child.name} · ${ordinal(scene.generation)} generation`,
          title: parent.name,
          sentences,
          asides: [],
          personId: parent.id,
          photo: input.photos?.[parent.id] ?? null,
        },
      };
    }

    case 'migration': {
      const child = person(scene.childId);
      const parent = person(scene.parentId);
      if (!child || !parent) return null;
      const distance = new Intl.NumberFormat('en-GB').format(scene.distanceKm);
      return {
        aside: {
          key,
          kind: 'migration',
          marker: null,
          eyebrow: 'A move',
          title: `From ${scene.from.name} to ${scene.to.name}`,
          route: routeOf(scene.from, scene.to),
          sentences: [
            {
              text: `${possessive(parent.name)} birth is recorded in ${scene.from.name}, that of ${childNoun(parent, child)} ${child.name} in ${scene.to.name}: ${distance} km apart.`,
              sources: [...(parent.birth?.sources ?? []), ...(child.birth?.sources ?? [])],
              factual: true,
            },
          ],
        },
      };
    }

    case 'historical-context': {
      const subject = person(scene.personId);
      const event = input.history[scene.eventId];
      if (!subject || !event) return null;
      const start = jdnToGregorian(event.startJdn).year;
      return {
        aside: {
          key,
          kind: 'historical-context',
          marker: String(start),
          eyebrow: 'Historical context',
          title: event.title,
          sentences: [
            {
              text: `“${event.title}” began in ${start}: ${subject.name} was then ${ageTextEn(scene.age)}.`,
              sources: [],
              factual: false,
            },
            {
              text: 'A landmark of general history, not a fact from the family’s own archives.',
              sources: [],
              factual: false,
            },
          ],
        },
      };
    }

    case 'end': {
      const last = person(scene.personId);
      if (!last) return null;
      const who = possessive(last.name);
      const text =
        scene.reason === 'protected'
          ? `${who} ${scene.missing === 'mother' ? 'mother' : 'father'} is a protected person: nothing is published about them, and the story stops short of them.`
          : scene.reason === 'limit'
            ? 'The story stops here; the line goes on beyond it in the tree.'
            : scene.missing === 'father'
              ? `${who} father is not known: that is where the research goes on.`
              : scene.missing === 'mother'
                ? `${who} mother is not known: that is where the research goes on.`
                : `${who} parents are not known: that is where the research goes on.`;
      return {
        chapter: {
          key,
          kind: 'end',
          marker: null,
          year: null,
          eyebrow: 'End of the known line',
          title: scene.reason === 'protected' ? 'A protected person' : 'For now',
          sentences: [{ text, sources: [], factual: false }],
          asides: [],
          personId: null,
        },
      };
    }
  }
}

export function describeCandidateEn(
  facts: StoryCandidateFacts,
  subjectId: string,
  people: ReadonlyMap<string, StoryViewPerson>,
): { title: string; reason: string } {
  const name = (id: string) => people.get(id)?.name ?? '';
  switch (facts.kind) {
    case 'migration': {
      const distance = new Intl.NumberFormat('en-GB').format(facts.distanceKm);
      return {
        title: `From ${facts.from} to ${facts.to}`,
        reason: `${distance} km between the births of ${name(facts.parentId)} and ${name(facts.childId)}.`,
      };
    }
    case 'deep-line':
      return {
        title: 'The oldest line',
        reason: `${facts.generations} generations from ${name(subjectId)}${
          facts.earliestYear === null ? '' : `, back to ${facts.earliestYear}`
        }.`,
      };
    case 'well-documented':
      return {
        title: 'A well-documented life',
        reason: `${name(subjectId)}: ${facts.cited} of ${facts.events} event${
          facts.events > 1 ? 's' : ''
        } sourced.`,
      };
    case 'four-generations': {
      const [a, b, c, d] = facts.personIds.map(name);
      return {
        title: 'Four generations at once',
        reason: `From ${facts.fromYear} to ${facts.toYear}, ${a}, ${b}, ${c} and ${d} are all alive.`,
      };
    }
  }
}
