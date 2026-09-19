/**
 * Synthetic genealogies, for benchmarks.
 *
 * Deterministic from a seed, so two runs measure the same tree and a change
 * in timing is a change in the code. Shaped like the archives this product is
 * for rather than like a random graph: founders around 1700, a generation
 * every twenty-eight years or so, families of a handful of children, half the
 * marriages between families of the tree and half with someone from outside,
 * and dates recorded the way registers record
 * them — to the day, to the month, "vers", "entre", a bare year, or not at
 * all. The share of each is set below and is what the numbers in
 * docs/PERFORMANCE.md were measured against.
 *
 * Not exported from the package root: nothing in the product depends on it.
 */

export interface SyntheticPerson {
  readonly id: string;
  readonly given: string;
  readonly surname: string;
  readonly recordedSex: 'MALE' | 'FEMALE';
  /** As a register would write it, GEDCOM-style; null when undated. */
  readonly birthText: string | null;
  readonly deathText: string | null;
  readonly living: boolean;
  readonly birthPlace: number;
  readonly generation: number;
}

export interface SyntheticLink {
  /** For PARENT_BIOLOGICAL, the parent. */
  readonly sourceId: string;
  /** For PARENT_BIOLOGICAL, the child. */
  readonly targetId: string;
  readonly type: 'PARENT_BIOLOGICAL' | 'SPOUSE';
}

export interface SyntheticPlace {
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly countryCode: string;
}

export interface SyntheticFamily {
  readonly people: readonly SyntheticPerson[];
  readonly links: readonly SyntheticLink[];
  readonly places: readonly SyntheticPlace[];
}

export interface SyntheticOptions {
  readonly size: number;
  readonly seed?: number;
  /** The present, for deciding who can still be alive. */
  readonly currentYear?: number;
}

const PLACES: readonly SyntheticPlace[] = [
  { name: 'Tours', latitude: 47.3941, longitude: 0.6848, countryCode: 'FR' },
  { name: 'Paris', latitude: 48.8566, longitude: 2.3522, countryCode: 'FR' },
  { name: 'Lyon', latitude: 45.764, longitude: 4.8357, countryCode: 'FR' },
  { name: 'Nantes', latitude: 47.2184, longitude: -1.5536, countryCode: 'FR' },
  { name: 'Bordeaux', latitude: 44.8378, longitude: -0.5792, countryCode: 'FR' },
  { name: 'Lille', latitude: 50.6292, longitude: 3.0573, countryCode: 'FR' },
  { name: 'Rennes', latitude: 48.1173, longitude: -1.6778, countryCode: 'FR' },
  { name: 'Limoges', latitude: 45.8336, longitude: 1.2611, countryCode: 'FR' },
  { name: 'Orléans', latitude: 47.9029, longitude: 1.9093, countryCode: 'FR' },
  { name: 'Blois', latitude: 47.5861, longitude: 1.3359, countryCode: 'FR' },
  { name: 'Chinon', latitude: 47.1667, longitude: 0.2425, countryCode: 'FR' },
  { name: 'Amboise', latitude: 47.4133, longitude: 0.9826, countryCode: 'FR' },
  { name: 'Poitiers', latitude: 46.5802, longitude: 0.3404, countryCode: 'FR' },
  { name: 'Angers', latitude: 47.4784, longitude: -0.5632, countryCode: 'FR' },
  { name: 'Le Mans', latitude: 48.0061, longitude: 0.1996, countryCode: 'FR' },
  { name: 'Marseille', latitude: 43.2965, longitude: 5.3698, countryCode: 'FR' },
  { name: 'Toulouse', latitude: 43.6047, longitude: 1.4442, countryCode: 'FR' },
  { name: 'Strasbourg', latitude: 48.5734, longitude: 7.7521, countryCode: 'FR' },
  { name: 'Genève', latitude: 46.2044, longitude: 6.1432, countryCode: 'CH' },
  { name: 'Bruxelles', latitude: 50.8503, longitude: 4.3517, countryCode: 'BE' },
  { name: 'Montréal', latitude: 45.5019, longitude: -73.5674, countryCode: 'CA' },
  { name: 'Buenos Aires', latitude: -34.6037, longitude: -58.3816, countryCode: 'AR' },
  { name: 'Alger', latitude: 36.7538, longitude: 3.0588, countryCode: 'DZ' },
  { name: 'New York', latitude: 40.7128, longitude: -74.006, countryCode: 'US' },
];

const MALE_NAMES = [
  'Jean',
  'Pierre',
  'Louis',
  'François',
  'Jacques',
  'Antoine',
  'Joseph',
  'Étienne',
  'Charles',
  'Henri',
  'Paul',
  'Auguste',
  'Émile',
  'Victor',
  'Marcel',
  'André',
];
const FEMALE_NAMES = [
  'Marie',
  'Jeanne',
  'Anne',
  'Catherine',
  'Madeleine',
  'Louise',
  'Françoise',
  'Marguerite',
  'Rose',
  'Julie',
  'Adèle',
  'Victorine',
  'Berthe',
  'Germaine',
  'Hélène',
  'Lucie',
];
const SURNAMES = [
  'Chassagne',
  'Moreau',
  'Lefèvre',
  'Martin',
  'Bernard',
  'Dubois',
  'Durand',
  'Leroy',
  'Roux',
  'Fournier',
  'Girard',
  'Bonnet',
  'Mercier',
  'Blanchard',
  'Vasseur',
  'Brun',
  'Garnier',
  'Faure',
  'André',
  'Rousseau',
  'Chevalier',
  'Perrin',
  'Morin',
  'Lambert',
];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** mulberry32: small, fast, and the same numbers on every machine. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function syntheticFamily(options: SyntheticOptions): SyntheticFamily {
  const next = random(options.seed ?? 1877);
  const currentYear = options.currentYear ?? 2026;
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
  const between = (low: number, high: number) => low + Math.floor(next() * (high - low + 1));

  const people: SyntheticPerson[] = [];
  const links: SyntheticLink[] = [];
  let counter = 0;

  /**
   * How registers record a date. The mix is the point: a benchmark on exact
   * dates alone would measure a product nobody uses.
   */
  const dateText = (year: number): string | null => {
    const roll = next();
    if (roll < 0.55) return `${between(1, 28)} ${pick(MONTHS)} ${year}`;
    if (roll < 0.7) return `${pick(MONTHS)} ${year}`;
    if (roll < 0.85) return `ABT ${year}`;
    if (roll < 0.92) return `BET ${year - between(1, 3)} AND ${year + between(0, 2)}`;
    if (roll < 0.97) return String(year);
    return null;
  };

  const person = (
    surname: string,
    sex: 'MALE' | 'FEMALE',
    birthYear: number,
    generation: number,
  ): SyntheticPerson => {
    counter += 1;
    // Anyone born within a long lifetime of the present may still be alive,
    // and most of the recent generations are.
    const mayBeAlive = birthYear > currentYear - 95;
    const living = mayBeAlive && next() < 0.75;
    const deathYear = birthYear + between(0, 92);
    const recordedDeath = !living && deathYear < currentYear && next() < 0.9;
    const created: SyntheticPerson = {
      id: `p${String(counter).padStart(6, '0')}`,
      given: pick(sex === 'MALE' ? MALE_NAMES : FEMALE_NAMES),
      surname,
      recordedSex: sex,
      birthText: dateText(birthYear),
      deathText: recordedDeath ? dateText(deathYear) : null,
      living,
      birthPlace: between(0, PLACES.length - 1),
      generation,
    };
    people.push(created);
    return created;
  };

  interface Couple {
    readonly a: SyntheticPerson;
    readonly b: SyntheticPerson;
    readonly year: number;
    readonly generation: number;
  }

  // Founders: a few couples, married around 1700. Each family roughly doubles
  // a generation, so one couple for every 1,500 people wanted gives about ten
  // generations down to the present — the depth of a researcher's tree, where
  // too many founders would give a wide, shallow one reaching 20,000 people
  // by the fourth generation.
  let couples: Couple[] = [];
  const founders = Math.max(1, Math.round(options.size / 1_500));
  for (let index = 0; index < founders && people.length < options.size; index += 1) {
    const year = between(1690, 1720);
    const husband = person(pick(SURNAMES), 'MALE', year - between(20, 32), 0);
    const wife = person(pick(SURNAMES), 'FEMALE', year - between(17, 28), 0);
    links.push({ sourceId: husband.id, targetId: wife.id, type: 'SPOUSE' });
    couples.push({ a: husband, b: wife, year, generation: 0 });
  }

  // Unmarried people born in the tree, by generation and sex, with the couple
  // they were born to: half of all marriages join two families of the tree,
  // which is what gives a researcher's tree its full pedigrees — and, cousins
  // being cousins, its pedigree collapse.
  const singles = new Map<string, { person: SyntheticPerson; family: Couple }[]>();
  const poolOf = (generation: number, sex: 'MALE' | 'FEMALE') => {
    const key = `${generation}:${sex}`;
    let pool = singles.get(key);
    if (!pool) {
      pool = [];
      singles.set(key, pool);
    }
    return pool;
  };

  while (people.length < options.size && couples.length > 0) {
    const nextCouples: Couple[] = [];
    for (const couple of couples) {
      if (people.length >= options.size) break;
      const children = between(0, 5) + (next() < 0.3 ? between(0, 3) : 0);
      for (let child = 0; child < children && people.length < options.size; child += 1) {
        const birthYear = couple.year + between(1, 20);
        if (birthYear > currentYear - 1) continue;
        const sex = next() < 0.5 ? 'MALE' : 'FEMALE';
        const born = person(couple.a.surname, sex, birthYear, couple.generation + 1);
        links.push({ sourceId: couple.a.id, targetId: born.id, type: 'PARENT_BIOLOGICAL' });
        links.push({ sourceId: couple.b.id, targetId: born.id, type: 'PARENT_BIOLOGICAL' });

        // Most children marry: half the time someone already in the tree,
        // from another family of the same generation; otherwise someone from
        // outside it.
        const marriageYear = birthYear + between(19, 32);
        const otherSex = sex === 'MALE' ? 'FEMALE' : 'MALE';
        const pool = poolOf(couple.generation + 1, otherSex);
        const candidateIndex = pool.findIndex((single) => single.family !== couple);
        if (next() < 0.7 && marriageYear < currentYear) {
          let spouse: SyntheticPerson | undefined;
          if (candidateIndex >= 0 && next() < 0.5) {
            spouse = pool[candidateIndex]?.person;
            pool.splice(candidateIndex, 1);
          } else if (people.length < options.size) {
            spouse = person(
              pick(SURNAMES),
              otherSex,
              birthYear + between(-6, 6),
              couple.generation + 1,
            );
          }
          if (spouse) {
            links.push({ sourceId: born.id, targetId: spouse.id, type: 'SPOUSE' });
            const [a, b] = sex === 'MALE' ? [born, spouse] : [spouse, born];
            nextCouples.push({ a, b, year: marriageYear, generation: couple.generation + 1 });
            continue;
          }
        }
        poolOf(couple.generation + 1, sex).push({ person: born, family: couple });
      }
    }
    // A generation with no couple left ends the tree; top it up with new
    // founders so the size asked for is reached.
    if (nextCouples.length === 0 && people.length < options.size) {
      const year = between(1850, 1950);
      const husband = person(pick(SURNAMES), 'MALE', year - 25, 0);
      const wife = person(pick(SURNAMES), 'FEMALE', year - 22, 0);
      links.push({ sourceId: husband.id, targetId: wife.id, type: 'SPOUSE' });
      nextCouples.push({ a: husband, b: wife, year, generation: 0 });
    }
    couples = nextCouples;
  }

  return { people, links, places: PLACES };
}
