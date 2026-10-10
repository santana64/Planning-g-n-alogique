import { jdnToGregorian } from '@chronolignee/domain';
import type {
  AgeRange,
  StoryCandidateFacts,
  StoryDate,
  StoryHistoricalEvent,
  StoryPlan,
  StoryScene,
  StorySource,
} from '@chronolignee/engine';
import { ofName } from '../../lib/french';
import type { StoryViewPerson } from '@/server/story';
import { describeCandidateEn, renderSceneEn } from './sentences-en';

/**
 * A story plan, told in French.
 *
 * Every sentence is assembled from a fact in the record and carries that
 * fact's sources, so the narrative is cited line by line and a sentence
 * without a source says so. There is no free text here — no adjective, no
 * guess at feelings or motives. A reader who distrusts a line can follow its
 * note to the register it came from.
 *
 * Scenes are gathered into chapters, one per generation: the person, then
 * what happened around them — a move between two births, a historical
 * marker — as asides. Told as separate scenes, those asides sent the clock
 * forward in the middle of a climb into the past (1884, 1914, 1850, 1916…);
 * gathered under their generation, the years only ever go back.
 */

export interface StorySentence {
  readonly text: string;
  readonly sources: readonly StorySource[];
  /** A fact of the family's own record, which could have had a source. */
  readonly factual: boolean;
}

/** A photograph shown with a chapter: the person, or an event of their life. */
export interface ChapterPhoto {
  readonly src: string;
  readonly title: string;
}

/** The two ends of a move, for the route drawn beside it. */
export interface AsideRoute {
  readonly from: { readonly name: string; readonly latitude: number; readonly longitude: number };
  readonly to: { readonly name: string; readonly latitude: number; readonly longitude: number };
}

export interface RenderedAside {
  readonly key: string;
  readonly kind: 'migration' | 'historical-context';
  /** A move between two located places. */
  readonly route?: AsideRoute | null;
  /** Its own year, shown small: an aside never moves the clock. */
  readonly marker: string | null;
  readonly eyebrow: string;
  readonly title: string;
  readonly sentences: readonly StorySentence[];
}

export interface RenderedChapter {
  readonly key: string;
  readonly kind: 'person' | 'end';
  /** The year shown beside the chapter: "1884", "v. 1790", or none. */
  readonly marker: string | null;
  /** A single year for moving the clock between chapters. */
  readonly year: number | null;
  readonly eyebrow: string;
  readonly title: string;
  readonly sentences: readonly StorySentence[];
  readonly asides: readonly RenderedAside[];
  /** The person the chapter is about, for a link to their record. */
  readonly personId: string | null;
  /** A photograph of them, when the archive holds one this reader may see. */
  readonly photo?: ChapterPhoto | null;
}

export interface StoryInput {
  readonly plan: StoryPlan;
  readonly people: Readonly<Record<string, StoryViewPerson>>;
  readonly history: Readonly<Record<string, StoryHistoricalEvent>>;
  /** The reader's language; French unless said otherwise. */
  readonly locale?: string;
  /** One photograph per person, by person, already checked for this reader. */
  readonly photos?: Readonly<Record<string, ChapterPhoto>>;
}

/** A move's route, when both of its places have coordinates. */
export function routeOf(from: StoryScenePlace, to: StoryScenePlace): AsideRoute | null {
  if (
    from.latitude === null ||
    from.longitude === null ||
    to.latitude === null ||
    to.longitude === null
  ) {
    return null;
  }
  return {
    from: { name: from.name, latitude: from.latitude, longitude: from.longitude },
    to: { name: to.name, latitude: to.latitude, longitude: to.longitude },
  };
}

type StoryScenePlace = {
  readonly name: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
};

export { ofName };

/** Gregorian and republican months: "mars 1884", "germinal an VII". */
const MONTH_FIRST =
  /^(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre|vendémiaire|brumaire|frimaire|nivôse|pluviôse|ventôse|germinal|floréal|prairial|messidor|thermidor|fructidor|jours complémentaires) /i;

/**
 * The words before a date: "le 15 mars 1884", "en 1884", "en mars 1884", and
 * nothing before "vers 1750" or "entre 1840 et 1845", which carry their own.
 */
export function dateClause(label: string): string {
  if (/^\d{1,2}(er)? /.test(label)) return `le ${label}`;
  if (/^\d{3,4}$/.test(label) || MONTH_FIRST.test(label)) return `en ${label}`;
  if (/^an [IVXL]+$/.test(label)) return `en l’${label}`;
  return label;
}

export function ageText(age: AgeRange): string {
  if (age.min === age.max) return age.min <= 1 ? `${age.min} an` : `${age.min} ans`;
  return `entre ${age.min} et ${age.max} ans`;
}

function ordinal(n: number): string {
  return n === 1 ? '1re' : `${n}e`;
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
    return { marker: first === last ? String(first) : `v. ${middle}`, year: middle };
  }
  if (latestJdn !== null) {
    const year = jdnToGregorian(latestJdn).year;
    return { marker: `av. ${year}`, year };
  }
  if (earliestJdn !== null) {
    const year = jdnToGregorian(earliestJdn).year;
    return { marker: `ap. ${year}`, year };
  }
  return { marker: null, year: null };
}

function agreed(person: StoryViewPerson, masculine: string, feminine: string): string {
  return person.recordedSex === 'FEMALE' ? feminine : masculine;
}

function knownSex(person: StoryViewPerson): boolean {
  return person.recordedSex === 'MALE' || person.recordedSex === 'FEMALE';
}

function lifeSentences(person: StoryViewPerson): StorySentence[] {
  const sentences: StorySentence[] = [];
  const at = (place: { name: string } | null) => (place ? ` à ${place.name}` : '');

  if (person.birth) {
    const { date, place, sources } = person.birth;
    const when = date ? ` ${dateClause(date.label)}` : '';
    const where = at(place);
    const text =
      person.birthRecordedAs === 'baptism'
        ? knownSex(person)
          ? `${agreed(person, 'Baptisé', 'Baptisée')}${when}${where}.`
          : `Baptême${when}${where}.`
        : date
          ? `Naît${when}${where}.`
          : `Naît${where}, à une date que le registre ne donne pas.`;
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
    const when = move.date ? ` ${dateClause(move.date.label)}` : '';
    const where = move.place ? `, ${move.place.name}` : '';
    const text =
      move.kind === 'naturalization'
        ? knownSex(person)
          ? `${agreed(person, 'Naturalisé', 'Naturalisée')}${when}${where}.`
          : `Naturalisation${when}${where}.`
        : `Migration enregistrée${when}${where}.`;
    sentences.push({ text, sources: move.sources, factual: true });
  }

  if (person.death) {
    const { date, place, sources } = person.death;
    const when = date ? ` ${dateClause(date.label)}` : '';
    const where = at(place);
    const text =
      person.deathRecordedAs === 'burial'
        ? knownSex(person)
          ? `${agreed(person, 'Inhumé', 'Inhumée')}${when}${where}.`
          : `Inhumation${when}${where}.`
        : `Meurt${when}${where}.`;
    sentences.push({ text, sources, factual: true });
  }

  return sentences;
}

function subjectPronoun(person: StoryViewPerson): string {
  if (person.recordedSex === 'MALE') return 'Il';
  if (person.recordedSex === 'FEMALE') return 'Elle';
  return person.name;
}

function childNoun(child: StoryViewPerson): string {
  if (child.recordedSex === 'MALE') return 'son fils';
  if (child.recordedSex === 'FEMALE') return 'sa fille';
  return 'son enfant';
}

type Rendered = { readonly chapter: RenderedChapter } | { readonly aside: RenderedAside } | null;

function renderScene(scene: StoryScene, index: number, input: StoryInput): Rendered {
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
          eyebrow: 'Point de départ',
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
      const relation = scene.relation === 'father' ? 'Père' : 'Mère';
      const sentences = lifeSentences(parent);
      if (scene.ageAtChildBirth) {
        sentences.push({
          text: `${subjectPronoun(parent)} a ${ageText(scene.ageAtChildBirth)} à la naissance ${ofName(child.name)}.`,
          sources: [],
          // Computed from two dated births, each cited in its own sentence.
          factual: false,
        });
      }
      return {
        chapter: {
          key,
          kind: 'person',
          ...yearOf(parent.birth?.date),
          eyebrow: `${relation} ${ofName(child.name)} · ${ordinal(scene.generation)} génération`,
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
      const distance = new Intl.NumberFormat('fr-FR').format(scene.distanceKm);
      return {
        aside: {
          key,
          kind: 'migration',
          marker: null,
          eyebrow: 'Un déplacement',
          title: `De ${scene.from.name} à ${scene.to.name}`,
          route: routeOf(scene.from, scene.to),
          sentences: [
            {
              text: `La naissance ${ofName(parent.name)} est enregistrée à ${scene.from.name}, celle de ${childNoun(child)} ${child.name} à ${scene.to.name} : ${distance} km les séparent.`,
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
          eyebrow: 'Contexte historique',
          title: event.title,
          sentences: [
            {
              text: `« ${event.title} » commence en ${start} : ${subject.name} a alors ${ageText(scene.age)}.`,
              sources: [],
              factual: false,
            },
            {
              text: 'Un repère de l’histoire générale, pas un fait tiré des archives de la famille.',
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
      const who = ofName(last.name);
      const text =
        scene.reason === 'protected'
          ? `${scene.missing === 'mother' ? 'La mère' : 'Le père'} ${who} est une personne protégée : rien n’est publié à son sujet, et le récit s’arrête avant.`
          : scene.reason === 'limit'
            ? 'Le récit s’arrête ici ; la lignée continue au-delà dans l’arbre.'
            : scene.missing === 'father'
              ? `Le père ${who} n’est pas connu : c’est là que la recherche continue.`
              : scene.missing === 'mother'
                ? `La mère ${who} n’est pas connue : c’est là que la recherche continue.`
                : `Les parents ${who} ne sont pas connus : c’est là que la recherche continue.`;
      return {
        chapter: {
          key,
          kind: 'end',
          marker: null,
          year: null,
          eyebrow: 'Fin de la lignée connue',
          title: scene.reason === 'protected' ? 'Une personne protégée' : 'Pour l’instant',
          sentences: [{ text, sources: [], factual: false }],
          asides: [],
          personId: null,
        },
      };
    }
  }
}

export function renderStory(input: StoryInput): RenderedChapter[] {
  const chapters: RenderedChapter[] = [];
  const render = input.locale === 'en' ? renderSceneEn : renderScene;
  input.plan.scenes.forEach((scene, index) => {
    const rendered = render(scene, index, input);
    if (!rendered) return;
    if ('chapter' in rendered) {
      chapters.push(rendered.chapter);
      return;
    }
    const current = chapters.at(-1);
    if (current) {
      chapters[chapters.length - 1] = { ...current, asides: [...current.asides, rendered.aside] };
    }
  });
  return chapters;
}

/**
 * A Director candidate, in words: a title and one sentence of reason, built
 * from the facts the pattern was found on and nothing else.
 */
export function describeCandidate(
  facts: StoryCandidateFacts,
  subjectId: string,
  people: ReadonlyMap<string, StoryViewPerson>,
  locale = 'fr',
): { title: string; reason: string } {
  if (locale === 'en') return describeCandidateEn(facts, subjectId, people);
  const name = (id: string) => people.get(id)?.name ?? '';
  switch (facts.kind) {
    case 'migration': {
      const distance = new Intl.NumberFormat('fr-FR').format(facts.distanceKm);
      return {
        title: `De ${facts.from} à ${facts.to}`,
        reason: `${distance} km entre la naissance ${ofName(name(facts.parentId))} et celle ${ofName(name(facts.childId))}.`,
      };
    }
    case 'deep-line':
      return {
        title: 'La lignée la plus ancienne',
        reason: `${facts.generations} générations depuis ${name(subjectId)}${
          facts.earliestYear === null ? '' : `, jusqu’en ${facts.earliestYear}`
        }.`,
      };
    case 'well-documented': {
      const plural = facts.cited > 1 ? 's' : '';
      return {
        title: 'Une vie bien documentée',
        reason: `${name(subjectId)} : ${facts.cited} événement${plural} sourcé${plural} sur ${facts.events}.`,
      };
    }
    case 'four-generations': {
      const [a, b, c, d] = facts.personIds.map(name);
      return {
        title: 'Quatre générations en même temps',
        reason: `De ${facts.fromYear} à ${facts.toYear}, ${a}, ${b}, ${c} et ${d} sont tous en vie.`,
      };
    }
  }
}

export function sourceText(source: StorySource): string {
  return source.locator ? `${source.title}, ${source.locator}` : source.title;
}

/** The sources a chapter cites, asides included, numbered as they first appear. */
export function collectNotes(chapter: RenderedChapter): string[] {
  const notes: string[] = [];
  const sentences = [...chapter.sentences, ...chapter.asides.flatMap((aside) => aside.sentences)];
  for (const sentence of sentences) {
    for (const source of sentence.sources) {
      const text = sourceText(source);
      if (!notes.includes(text)) notes.push(text);
    }
  }
  return notes;
}
