/**
 * The demonstration family.
 *
 * Entirely fictional. No real private individual appears anywhere in this
 * file, and none should ever be added (docs/PRIVACY.md).
 *
 * It exists to prove the product's claims rather than to look pretty, so it
 * deliberately contains every awkward case the software says it handles:
 *
 *   - 1702 to today, eleven generations
 *   - a Republican-calendar marriage act (an VII), because fourteen years of
 *     French civil registration exist in no other calendar
 *   - approximate dates, an unrecorded death, a date the parser cannot read
 *   - two sources that disagree about a birth year, both kept
 *   - a cousin marriage, so pedigree collapse is real rather than theoretical
 *   - an adoption alongside biological parentage
 *   - a divorce followed by an unmarried partnership
 *   - emigration from Tours to Buenos Aires in 1889, splitting the tree into
 *     two branches on two continents
 *   - a duplicate pair created by a transcription variant (CHASSAGNE /
 *     CHASSAIGNE), which the scorer should surface and no one should merge
 *     automatically
 *   - a child recorded to a mother of 58, which must warn and must not be
 *     refused: the data is what the register says
 *   - infant deaths, which are what a pre-1900 family actually looks like
 *   - four living generations
 */

export type SeedSex = 'MALE' | 'FEMALE';

export interface SeedPerson {
  readonly key: string;
  readonly given: string;
  readonly surname: string;
  /** Maiden name, when the recorded surname changed at marriage. */
  readonly birthSurname?: string;
  readonly sex: SeedSex;
  /** GEDCOM or French natural text; parsed by the domain parser. */
  readonly birth?: string;
  readonly birthPlace?: string;
  readonly death?: string;
  readonly deathPlace?: string;
  readonly living?: boolean;
  readonly occupation?: string;
  readonly occupationPeriod?: string;
  readonly residence?: { readonly place: string; readonly period: string };
  readonly notes?: string;
  /** Source key backing the birth record, when one exists. */
  readonly birthSource?: string;
}

export interface SeedUnion {
  readonly spouses: readonly [string, string];
  readonly marriage?: string;
  readonly marriagePlace?: string;
  readonly divorce?: string;
  /** Unmarried partnership rather than marriage. */
  readonly partnership?: boolean;
  readonly children?: readonly string[];
  /** Children joined by adoption rather than birth. */
  readonly adoptedChildren?: readonly string[];
  readonly marriageSource?: string;
}

export interface SeedPlace {
  readonly key: string;
  readonly name: string;
  readonly type:
    'COUNTRY' | 'REGION' | 'DEPARTMENT' | 'CITY' | 'TOWN' | 'VILLAGE' | 'PARISH' | 'CEMETERY';
  readonly parent?: string;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly countryCode?: string;
  /** What the place was called at the time, when it differs from today. */
  readonly historicalName?: string;
}

export interface SeedSource {
  readonly key: string;
  readonly title: string;
  readonly type:
    | 'PARISH_REGISTER'
    | 'CIVIL_REGISTER'
    | 'CENSUS'
    | 'MILITARY_RECORD'
    | 'NOTARIAL_ACT'
    | 'NEWSPAPER'
    | 'OTHER';
  readonly repository?: string;
  readonly callNumber?: string;
  readonly reliability: 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
}

// --- Places -----------------------------------------------------------------

export const PLACES: readonly SeedPlace[] = [
  { key: 'fr', name: 'France', type: 'COUNTRY', countryCode: 'FR' },
  { key: 'ar', name: 'Argentine', type: 'COUNTRY', countryCode: 'AR' },
  {
    key: 'indre-et-loire',
    name: 'Indre-et-Loire',
    type: 'DEPARTMENT',
    parent: 'fr',
    countryCode: 'FR',
    // Created in 1790; before that the same territory was the province of
    // Touraine. Both names must survive, because an act of 1750 says Touraine.
    historicalName: 'Touraine',
  },
  {
    key: 'azay',
    name: 'Azay-le-Rideau',
    type: 'TOWN',
    parent: 'indre-et-loire',
    latitude: 47.2614,
    longitude: 0.4658,
    countryCode: 'FR',
  },
  {
    key: 'tours',
    name: 'Tours',
    type: 'CITY',
    parent: 'indre-et-loire',
    latitude: 47.3941,
    longitude: 0.6848,
    countryCode: 'FR',
  },
  {
    key: 'paris',
    name: 'Paris',
    type: 'CITY',
    parent: 'fr',
    latitude: 48.8566,
    longitude: 2.3522,
    countryCode: 'FR',
  },
  {
    key: 'le-havre',
    name: 'Le Havre',
    type: 'CITY',
    parent: 'fr',
    latitude: 49.4944,
    longitude: 0.1079,
    countryCode: 'FR',
  },
  {
    key: 'verdun',
    name: 'Verdun',
    type: 'CITY',
    parent: 'fr',
    latitude: 49.1596,
    longitude: 5.3831,
    countryCode: 'FR',
  },
  {
    key: 'buenos-aires',
    name: 'Buenos Aires',
    type: 'CITY',
    parent: 'ar',
    latitude: -34.6037,
    longitude: -58.3816,
    countryCode: 'AR',
  },
  {
    key: 'rosario',
    name: 'Rosario',
    type: 'CITY',
    parent: 'ar',
    latitude: -32.9442,
    longitude: -60.6505,
    countryCode: 'AR',
  },
];

// --- Sources ----------------------------------------------------------------

export const SOURCES: readonly SeedSource[] = [
  {
    key: 'azay-bms',
    title: 'Registres paroissiaux BMS, Azay-le-Rideau (1690-1792)',
    type: 'PARISH_REGISTER',
    repository: "Archives départementales d'Indre-et-Loire",
    callNumber: '6NUM8/014/001',
    reliability: 'HIGH',
  },
  {
    key: 'tours-ec',
    title: "Registres d'état civil, Tours (1793-1902)",
    type: 'CIVIL_REGISTER',
    repository: "Archives départementales d'Indre-et-Loire",
    callNumber: '6NUM6/261/043',
    reliability: 'VERY_HIGH',
  },
  {
    key: 'recensement-1872',
    title: 'Recensement de population, Tours, 1872',
    type: 'CENSUS',
    repository: "Archives départementales d'Indre-et-Loire",
    callNumber: '6M 261',
    // Census ages were declared, often by a neighbour, and are routinely a
    // year or two out. The reliability rating is doing real work here.
    reliability: 'LOW',
  },
  {
    key: 'registre-matricule',
    title: 'Registre matricule militaire, classe 1904, Tours',
    type: 'MILITARY_RECORD',
    repository: "Archives départementales d'Indre-et-Loire",
    callNumber: '1R 1234',
    reliability: 'HIGH',
  },
  {
    key: 'manifeste-1889',
    title: 'Liste de passagers du vapeur Ville de Bordeaux, Le Havre - Buenos Aires, 1889',
    type: 'OTHER',
    repository: 'CEMLA, Buenos Aires',
    callNumber: 'LP-1889-0412',
    reliability: 'MEDIUM',
  },
];

// --- People -----------------------------------------------------------------

export const PEOPLE: readonly SeedPerson[] = [
  // --- Generation 1: Touraine, before the Revolution -----------------------
  {
    key: 'mathurin',
    given: 'Mathurin',
    surname: 'CHASSAGNE',
    sex: 'MALE',
    birth: 'ABT 1702',
    birthPlace: 'azay',
    death: '14 MAR 1768',
    deathPlace: 'azay',
    occupation: 'Laboureur',
    notes: "Aucun acte de naissance retrouvé ; l'âge au décès donne environ 1702.",
  },
  {
    key: 'perrine',
    given: 'Perrine',
    surname: 'CHASSAGNE',
    birthSurname: 'BOUCHARD',
    sex: 'FEMALE',
    birth: 'ABT 1708',
    birthPlace: 'azay',
    death: '2 NOV 1771',
    deathPlace: 'azay',
  },

  // --- Generation 2 --------------------------------------------------------
  {
    key: 'jacques',
    given: 'Jacques',
    surname: 'CHASSAGNE',
    sex: 'MALE',
    birth: '9 JAN 1731',
    birthPlace: 'azay',
    birthSource: 'azay-bms',
    death: '21 FEB 1799',
    deathPlace: 'tours',
    occupation: 'Tisserand',
    residence: { place: 'tours', period: 'FROM 1756 TO 1799' },
  },
  {
    key: 'marguerite-r',
    given: 'Marguerite',
    surname: 'CHASSAGNE',
    birthSurname: 'RENAUDIN',
    sex: 'FEMALE',
    birth: '17 AUG 1736',
    birthPlace: 'tours',
    death: '5 JUN 1801',
    deathPlace: 'tours',
  },
  {
    key: 'anne',
    given: 'Anne',
    surname: 'CHASSAGNE',
    sex: 'FEMALE',
    birth: '3 APR 1734',
    birthPlace: 'azay',
    death: '19 SEP 1736',
    deathPlace: 'azay',
    notes: 'Décédée en bas âge.',
  },

  // --- Generation 3: the Revolution ---------------------------------------
  {
    key: 'etienne',
    given: 'Étienne',
    surname: 'CHASSAGNE',
    sex: 'MALE',
    birth: '11 MAY 1762',
    birthPlace: 'tours',
    birthSource: 'azay-bms',
    death: '30 JAN 1834',
    deathPlace: 'tours',
    occupation: 'Maître tisserand',
  },
  {
    key: 'jeanne',
    given: 'Jeanne',
    surname: 'CHASSAGNE',
    birthSurname: 'LEFÈVRE',
    sex: 'FEMALE',
    birth: '28 OCT 1768',
    birthPlace: 'tours',
    death: '12 MAR 1840',
    deathPlace: 'tours',
    // The accent is the point: searching "Lefevre" must find this person.
  },

  // --- Generation 4 --------------------------------------------------------
  {
    key: 'pierre',
    given: 'Pierre',
    surname: 'CHASSAGNE',
    sex: 'MALE',
    birth: '4 GERM 7',
    birthPlace: 'tours',
    birthSource: 'tours-ec',
    death: '8 DEC 1857',
    deathPlace: 'tours',
    occupation: 'Tisserand',
    notes: 'Acte de naissance au calendrier républicain : 4 germinal an VII.',
  },
  {
    key: 'victoire',
    given: 'Victoire',
    surname: 'CHASSAGNE',
    birthSurname: 'MARCHAND',
    sex: 'FEMALE',
    birth: '19 JUL 1798',
    birthPlace: 'tours',
    death: '3 FEB 1869',
    deathPlace: 'tours',
  },
  {
    key: 'augustin',
    given: 'Augustin',
    surname: 'CHASSAGNE',
    sex: 'MALE',
    birth: '22 SEP 1801',
    birthPlace: 'tours',
    death: '17 APR 1871',
    deathPlace: 'tours',
    occupation: 'Charpentier',
  },
  {
    // The duplicate. Same man, transcribed from a different register by a
    // clerk who heard the name differently. The scorer must surface this pair;
    // nothing must merge it automatically.
    key: 'augustin-variant',
    given: 'Augustin',
    surname: 'CHASSAIGNE',
    sex: 'MALE',
    birth: 'ABT 1801',
    birthPlace: 'tours',
    death: '1871',
    deathPlace: 'tours',
    occupation: 'Charpentier',
    notes: "Fiche issue d'un relevé associatif. Doublon probable d'Augustin CHASSAGNE.",
  },

  // --- Generation 5 --------------------------------------------------------
  {
    key: 'jean-baptiste',
    given: 'Jean-Baptiste',
    surname: 'CHASSAGNE',
    sex: 'MALE',
    // Two sources disagree about the year. Both claims are seeded; the civil
    // register is accepted and the census is kept as disputed.
    birth: '6 JUN 1822',
    birthPlace: 'tours',
    birthSource: 'tours-ec',
    death: '14 NOV 1889',
    deathPlace: 'tours',
    occupation: 'Contremaître en filature',
    occupationPeriod: 'FROM 1851 TO 1885',
  },
  {
    key: 'rosalie',
    given: 'Rosalie',
    surname: 'CHASSAGNE',
    birthSurname: 'DUBOIS',
    sex: 'FEMALE',
    birth: '2 MAR 1827',
    birthPlace: 'tours',
    death: '21 JAN 1901',
    deathPlace: 'tours',
  },
  {
    key: 'celine',
    given: 'Céline',
    surname: 'MOREAU',
    birthSurname: 'CHASSAGNE',
    sex: 'FEMALE',
    birth: '15 AUG 1825',
    birthPlace: 'tours',
    death: '9 JUN 1900',
    deathPlace: 'tours',
  },
  {
    key: 'henri-moreau',
    given: 'Henri',
    surname: 'MOREAU',
    sex: 'MALE',
    birth: '27 JAN 1820',
    birthPlace: 'tours',
    death: '4 OCT 1884',
    deathPlace: 'tours',
    occupation: 'Charron',
  },

  // --- Generation 6: the emigration ---------------------------------------
  {
    key: 'gustave',
    given: 'Gustave',
    surname: 'CHASSAGNE',
    sex: 'MALE',
    birth: '12 JUN 1851',
    birthPlace: 'tours',
    birthSource: 'tours-ec',
    death: '3 AUG 1923',
    deathPlace: 'buenos-aires',
    occupation: 'Ébéniste',
    residence: { place: 'buenos-aires', period: 'FROM 1889 TO 1923' },
    notes: 'Embarqué au Havre en avril 1889 sur le vapeur Ville de Bordeaux.',
  },
  {
    key: 'eugenie',
    given: 'Eugénie',
    surname: 'CHASSAGNE',
    birthSurname: 'FOURNIER',
    sex: 'FEMALE',
    birth: '30 APR 1856',
    birthPlace: 'tours',
    death: '18 FEB 1912',
    deathPlace: 'buenos-aires',
  },
  {
    key: 'adele',
    given: 'Adèle',
    surname: 'MOREAU',
    birthSurname: 'CHASSAGNE',
    sex: 'FEMALE',
    birth: '7 SEP 1854',
    birthPlace: 'tours',
    death: '22 MAY 1931',
    deathPlace: 'tours',
  },
  {
    key: 'paul-moreau',
    given: 'Paul',
    surname: 'MOREAU',
    sex: 'MALE',
    birth: '11 MAR 1850',
    birthPlace: 'tours',
    death: '2 DEC 1919',
    deathPlace: 'tours',
    occupation: 'Charron',
    // Paul is Céline's son and Adèle is Jean-Baptiste's daughter; Céline and
    // Jean-Baptiste are siblings. Their marriage makes their descendants
    // descend twice from Étienne and Jeanne.
    notes: 'Cousin germain de son épouse. Implexe dans les générations suivantes.',
  },

  // --- Generation 7: two continents ---------------------------------------
  {
    key: 'gustavo',
    given: 'Gustavo',
    surname: 'CHASSAGNE',
    sex: 'MALE',
    birth: '4 FEB 1882',
    birthPlace: 'tours',
    death: '19 NOV 1955',
    deathPlace: 'buenos-aires',
    occupation: 'Carpintero',
    notes: 'Né à Tours, émigré enfant avec ses parents en 1889.',
  },
  {
    key: 'maria-elena',
    given: 'María Elena',
    surname: 'CHASSAGNE',
    birthSurname: 'GUTIÉRREZ',
    sex: 'FEMALE',
    birth: '21 JUL 1888',
    birthPlace: 'rosario',
    death: '6 APR 1968',
    deathPlace: 'buenos-aires',
  },
  {
    key: 'emile-moreau',
    given: 'Émile',
    surname: 'MOREAU',
    sex: 'MALE',
    birth: '3 JUN 1884',
    birthPlace: 'tours',
    birthSource: 'registre-matricule',
    death: '26 MAY 1916',
    deathPlace: 'verdun',
    occupation: 'Employé de chemin de fer',
    notes: 'Mort pour la France.',
  },
  {
    key: 'henriette',
    given: 'Henriette',
    surname: 'MOREAU',
    sex: 'FEMALE',
    birth: '19 OCT 1887',
    birthPlace: 'tours',
    // No death recorded anywhere. The lifespan must fade rather than end.
    notes: 'Aucun acte de décès retrouvé. Dernière mention connue : 1931.',
  },
  {
    key: 'leonie',
    given: 'Léonie',
    surname: 'MOREAU',
    birthSurname: 'BLANCHARD',
    sex: 'FEMALE',
    birth: '9 br 1889',
    birthPlace: 'tours',
    death: '14 JUL 1971',
    deathPlace: 'tours',
    // The birth text is a real archival abbreviation the parser cannot read.
    // It is kept verbatim rather than dropped, which is the whole point.
    notes: "Date de naissance relevée telle qu'écrite dans le registre.",
  },

  // --- Generation 8 --------------------------------------------------------
  {
    key: 'ricardo',
    given: 'Ricardo',
    surname: 'CHASSAGNE',
    sex: 'MALE',
    birth: '17 MAR 1910',
    birthPlace: 'buenos-aires',
    death: '8 SEP 1991',
    deathPlace: 'buenos-aires',
    occupation: 'Ingeniero',
  },
  {
    key: 'beatriz',
    given: 'Beatriz',
    surname: 'CHASSAGNE',
    birthSurname: 'SILVA',
    sex: 'FEMALE',
    birth: '2 DEC 1915',
    birthPlace: 'buenos-aires',
    death: '30 JAN 2002',
    deathPlace: 'buenos-aires',
  },
  {
    key: 'marguerite-m',
    given: 'Marguerite',
    surname: 'VASSEUR',
    birthSurname: 'MOREAU',
    sex: 'FEMALE',
    birth: '5 AUG 1912',
    birthPlace: 'tours',
    death: '11 FEB 2004',
    deathPlace: 'tours',
  },
  {
    key: 'robert-v',
    given: 'Robert',
    surname: 'VASSEUR',
    sex: 'MALE',
    birth: '23 APR 1908',
    birthPlace: 'paris',
    death: '19 JUN 1978',
    deathPlace: 'paris',
    occupation: 'Typographe',
  },
  {
    key: 'lucien-g',
    given: 'Lucien',
    surname: 'GIRARD',
    sex: 'MALE',
    birth: '14 SEP 1910',
    birthPlace: 'tours',
    death: '2 MAR 1989',
    deathPlace: 'tours',
  },

  // --- Generation 9 --------------------------------------------------------
  {
    key: 'alejandro',
    given: 'Alejandro',
    surname: 'CHASSAGNE',
    sex: 'MALE',
    birth: '9 JAN 1940',
    birthPlace: 'buenos-aires',
    death: '14 JUL 2018',
    deathPlace: 'buenos-aires',
    occupation: 'Arquitecto',
  },
  {
    key: 'claire',
    given: 'Claire',
    surname: 'BERTRAND',
    birthSurname: 'VASSEUR',
    sex: 'FEMALE',
    birth: '28 JUN 1941',
    birthPlace: 'tours',
    living: true,
  },
  {
    key: 'michel-b',
    given: 'Michel',
    surname: 'BERTRAND',
    sex: 'MALE',
    birth: '16 NOV 1938',
    birthPlace: 'tours',
    death: '3 OCT 2015',
    deathPlace: 'tours',
    occupation: 'Instituteur',
  },
  {
    key: 'sylvie',
    given: 'Sylvie',
    surname: 'VASSEUR',
    sex: 'FEMALE',
    birth: '12 FEB 1948',
    birthPlace: 'paris',
    living: true,
    notes: 'Adoptée en 1950 par Marguerite MOREAU et Robert VASSEUR.',
  },
  {
    key: 'odette',
    given: 'Odette',
    surname: 'MOREAU',
    sex: 'FEMALE',
    birth: '4 MAY 1934',
    birthPlace: 'tours',
    death: '17 AUG 2009',
    deathPlace: 'tours',
  },
  {
    /**
     * The planted anomaly.
     *
     * Hippolyte is recorded as Victoire's son, but Victoire was born in 1798
     * and he in 1856 — she would have been 58. That is a research warning, not
     * an error: the data is exactly what the register says, and the likely
     * explanation is a grandchild entered as a child, which is one of the most
     * common transcription mistakes in nineteenth-century French registers.
     *
     * The software must surface it and must not refuse it. Refusing would
     * force the researcher to falsify the record in order to store it.
     */
    key: 'hippolyte',
    given: 'Hippolyte',
    surname: 'CHASSAGNE',
    sex: 'MALE',
    birth: '2 FEB 1856',
    birthPlace: 'tours',
    death: '9 APR 1921',
    deathPlace: 'tours',
    notes:
      "Rattaché à Pierre et Victoire d'après le relevé paroissial. Victoire aurait eu 58 ans : " +
      "vérifier s'il ne s'agit pas d'un petit-fils.",
  },

  // --- Generation 10: living ----------------------------------------------
  {
    key: 'valentina',
    given: 'Valentina',
    surname: 'CHASSAGNE',
    sex: 'FEMALE',
    birth: '3 MAY 1972',
    birthPlace: 'buenos-aires',
    living: true,
  },
  {
    key: 'thomas',
    given: 'Thomas',
    surname: 'BERTRAND',
    sex: 'MALE',
    birth: '21 SEP 1970',
    birthPlace: 'tours',
    living: true,
  },
  {
    key: 'camille',
    given: 'Camille',
    surname: 'BERTRAND',
    sex: 'FEMALE',
    birth: '8 DEC 1974',
    birthPlace: 'tours',
    living: true,
  },

  // --- Generation 11: living ----------------------------------------------
  {
    key: 'lea',
    given: 'Léa',
    surname: 'BERTRAND',
    sex: 'FEMALE',
    birth: '19 APR 2001',
    birthPlace: 'tours',
    living: true,
  },
  {
    key: 'mateo',
    given: 'Mateo',
    surname: 'CHASSAGNE',
    sex: 'MALE',
    birth: '27 OCT 2005',
    birthPlace: 'buenos-aires',
    living: true,
  },
];

// --- Unions -----------------------------------------------------------------

export const UNIONS: readonly SeedUnion[] = [
  {
    spouses: ['mathurin', 'perrine'],
    marriage: 'ABT 1728',
    marriagePlace: 'azay',
    children: ['jacques', 'anne'],
  },
  {
    spouses: ['jacques', 'marguerite-r'],
    marriage: '14 FEB 1756',
    marriagePlace: 'azay',
    marriageSource: 'azay-bms',
    children: ['etienne'],
  },
  {
    spouses: ['etienne', 'jeanne'],
    // A Republican-calendar marriage: 26 ventôse an VII = 16 March 1799.
    marriage: '26 VENT 7',
    marriagePlace: 'tours',
    marriageSource: 'tours-ec',
    children: ['pierre', 'augustin'],
  },
  {
    spouses: ['pierre', 'victoire'],
    marriage: '11 MAY 1818',
    marriagePlace: 'tours',
    marriageSource: 'tours-ec',
    // Hippolyte is the planted anomaly: recorded here, born when Victoire was
    // 58. See his entry in PEOPLE.
    children: ['jean-baptiste', 'celine', 'hippolyte'],
  },
  {
    spouses: ['jean-baptiste', 'rosalie'],
    marriage: '3 JUN 1848',
    marriagePlace: 'tours',
    marriageSource: 'tours-ec',
    children: ['gustave', 'adele'],
  },
  {
    spouses: ['henri-moreau', 'celine'],
    marriage: '22 SEP 1845',
    marriagePlace: 'tours',
    children: ['paul-moreau'],
  },
  {
    spouses: ['gustave', 'eugenie'],
    marriage: '8 SEP 1877',
    marriagePlace: 'tours',
    marriageSource: 'tours-ec',
    children: ['gustavo'],
  },
  {
    // The cousin marriage. Adèle and Paul share the grandparents Pierre and
    // Victoire, so everyone below descends from them twice.
    spouses: ['paul-moreau', 'adele'],
    marriage: '17 APR 1881',
    marriagePlace: 'tours',
    marriageSource: 'tours-ec',
    children: ['emile-moreau', 'henriette'],
  },
  {
    spouses: ['gustavo', 'maria-elena'],
    marriage: '14 NOV 1908',
    marriagePlace: 'buenos-aires',
    children: ['ricardo'],
  },
  {
    spouses: ['emile-moreau', 'leonie'],
    marriage: '2 AUG 1910',
    marriagePlace: 'tours',
    children: ['marguerite-m', 'odette'],
  },
  {
    spouses: ['ricardo', 'beatriz'],
    marriage: '21 DEC 1935',
    marriagePlace: 'buenos-aires',
    children: ['alejandro'],
  },
  {
    spouses: ['robert-v', 'marguerite-m'],
    marriage: '6 JUN 1936',
    marriagePlace: 'tours',
    divorce: '19 NOV 1952',
    children: ['claire'],
    adoptedChildren: ['sylvie'],
  },
  {
    // After the divorce, an unmarried partnership — common and rarely modelled.
    spouses: ['lucien-g', 'marguerite-m'],
    partnership: true,
  },
  {
    spouses: ['michel-b', 'claire'],
    marriage: '9 JUL 1966',
    marriagePlace: 'tours',
    children: ['thomas', 'camille'],
  },
];

/** Parent links that do not come from a union (single-parent records). */
export const EXTRA_PARENT_LINKS: readonly {
  readonly parent: string;
  readonly child: string;
  readonly type: 'PARENT_BIOLOGICAL' | 'PARENT_ADOPTIVE';
}[] = [
  { parent: 'alejandro', child: 'valentina', type: 'PARENT_BIOLOGICAL' },
  { parent: 'valentina', child: 'mateo', type: 'PARENT_BIOLOGICAL' },
  { parent: 'thomas', child: 'lea', type: 'PARENT_BIOLOGICAL' },
];

/**
 * Migration and other life events that are not births, deaths or marriages.
 */
export const LIFE_EVENTS: readonly {
  readonly person: string;
  readonly type: 'MIGRATION' | 'MILITARY_SERVICE' | 'NATURALIZATION' | 'CENSUS';
  readonly date: string;
  readonly place?: string;
  readonly description: string;
  readonly source?: string;
}[] = [
  {
    person: 'gustave',
    type: 'MIGRATION',
    date: 'APR 1889',
    place: 'le-havre',
    description: 'Embarquement pour Buenos Aires sur le vapeur Ville de Bordeaux',
    source: 'manifeste-1889',
  },
  {
    person: 'eugenie',
    type: 'MIGRATION',
    date: 'APR 1889',
    place: 'le-havre',
    description: 'Embarquement pour Buenos Aires',
    source: 'manifeste-1889',
  },
  {
    person: 'gustavo',
    type: 'MIGRATION',
    date: 'APR 1889',
    place: 'le-havre',
    description: "Émigration avec ses parents, à l'âge de 7 ans",
    source: 'manifeste-1889',
  },
  {
    person: 'gustave',
    type: 'NATURALIZATION',
    date: '1901',
    place: 'buenos-aires',
    description: 'Naturalisation argentine',
  },
  {
    person: 'emile-moreau',
    type: 'MILITARY_SERVICE',
    date: 'FROM 1914 TO 1916',
    place: 'verdun',
    description: "66e régiment d'infanterie",
    source: 'registre-matricule',
  },
  {
    person: 'jean-baptiste',
    type: 'CENSUS',
    date: '1872',
    place: 'tours',
    description: 'Recensé rue de la Scellerie, chef de ménage, 50 ans déclarés',
    source: 'recensement-1872',
  },
];

/**
 * A second, conflicting birth claim.
 *
 * The 1872 census gives Jean-Baptiste's age as 50, implying 1822 or 1823; the
 * civil register says 6 June 1822. Both are recorded, the register is accepted
 * and the census claim stays DISPUTED rather than being deleted — which is the
 * behaviour the whole evidence model exists to make possible.
 */
export const CONFLICTING_CLAIMS: readonly {
  readonly person: string;
  readonly predicate: 'BIRTH_DATE';
  readonly date: string;
  readonly status: 'ACCEPTED' | 'DISPUTED';
  readonly confidence: 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  readonly source: string;
  readonly note: string;
}[] = [
  {
    person: 'jean-baptiste',
    predicate: 'BIRTH_DATE',
    date: '6 JUN 1822',
    status: 'ACCEPTED',
    confidence: 'VERY_HIGH',
    source: 'tours-ec',
    note: "Acte de naissance, registre d'état civil de Tours.",
  },
  {
    person: 'jean-baptiste',
    predicate: 'BIRTH_DATE',
    date: '1823',
    status: 'DISPUTED',
    confidence: 'LOW',
    source: 'recensement-1872',
    note: "Âge déclaré au recensement de 1872 (50 ans), incompatible d'un an.",
  },
  {
    /**
     * A human reading of a register entry the parser cannot decode.
     *
     * Léonie's birth event keeps "9 br 1889" exactly as written. "9bre" is the
     * old abbreviation for novembre — the ninth month of the Roman year — and
     * a researcher who knows that can resolve it. The resolution is recorded
     * as an accepted claim rather than by overwriting the event, so the
     * register's own wording survives and the interpretation is attributable.
     */
    person: 'leonie',
    predicate: 'BIRTH_DATE',
    date: '9 NOV 1889',
    status: 'ACCEPTED',
    confidence: 'MEDIUM',
    source: 'tours-ec',
    note: 'Lecture de « 9 br 1889 » comme 9 novembre 1889 (9bre = novembre).',
  },
];

/** Historical context relevant to this family's places and dates. */
export const HISTORICAL_EVENTS: readonly {
  readonly title: string;
  readonly summary: string;
  readonly category:
    'WAR' | 'POLITICAL' | 'EPIDEMIC' | 'DISASTER' | 'MIGRATION' | 'ECONOMIC' | 'CULTURAL';
  readonly significance: number;
  readonly start: string;
  readonly end: string;
  readonly countryCodes: readonly string[];
}[] = [
  {
    title: 'Révolution française',
    summary:
      "Chute de la monarchie, création de l'état civil laïque en 1792 et adoption du calendrier républicain.",
    category: 'POLITICAL',
    significance: 5,
    start: '14 JUL 1789',
    end: '9 NOV 1799',
    countryCodes: ['FR'],
  },
  {
    title: 'Calendrier républicain en vigueur',
    summary: "Seul calendrier de l'état civil français du 22 septembre 1792 au 31 décembre 1805.",
    category: 'POLITICAL',
    significance: 3,
    start: '22 SEP 1792',
    end: '31 DEC 1805',
    countryCodes: ['FR'],
  },
  {
    title: "Grande vague d'immigration européenne en Argentine",
    summary:
      "Politique d'immigration massive ; plus de deux millions d'Européens s'installent en Argentine.",
    category: 'MIGRATION',
    significance: 4,
    start: '1880',
    end: '1914',
    countryCodes: ['AR', 'FR', 'IT', 'ES'],
  },
  {
    title: 'Première Guerre mondiale',
    summary: '1,4 million de morts français.',
    category: 'WAR',
    significance: 5,
    start: '28 JUL 1914',
    end: '11 NOV 1918',
    countryCodes: ['FR', 'DE', 'GB'],
  },
  {
    title: 'Bataille de Verdun',
    summary: 'Dix mois de combats, environ 300 000 morts.',
    category: 'WAR',
    significance: 5,
    start: '21 FEB 1916',
    end: '18 DEC 1916',
    countryCodes: ['FR'],
  },
  {
    title: 'Seconde Guerre mondiale',
    summary: 'Occupation de la France de 1940 à 1944.',
    category: 'WAR',
    significance: 5,
    start: '1 SEP 1939',
    end: '2 SEP 1945',
    countryCodes: ['FR', 'DE', 'GB', 'AR'],
  },
  {
    title: 'Grippe espagnole',
    summary: 'Pandémie mondiale, environ 240 000 morts en France.',
    category: 'EPIDEMIC',
    significance: 4,
    start: '1918',
    end: '1919',
    countryCodes: ['FR', 'AR'],
  },
];
