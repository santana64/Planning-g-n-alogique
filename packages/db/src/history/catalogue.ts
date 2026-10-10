/**
 * The shared historical catalogue: what was happening in the world while the
 * family lived.
 *
 * Kept strictly apart from family facts (docs/DATA_MODEL.md): nothing here
 * is a claim about anyone, and a person is never placed "at" an event — the
 * screens say only that a life overlapped it, and how old the person was.
 *
 * Dates are given as genealogists write them and parsed by the domain like
 * any other. Where the exact day of an event is not a matter of record (a
 * crisis, a wave of migration, a long epidemic) the entry gives a year or an
 * "about", so the catalogue never claims more precision than history does.
 * Every entry here is a dated, documented event of general history; none is
 * invented for the demonstration.
 *
 * Scope: France (with the Val de Loire / Touraine, where the demonstration
 * family lived), Argentina (where one branch emigrated), and the few world
 * events that touched both. Installed by a migration, so every tree — not
 * only the demonstration — has its historical context.
 */

export type HistoricalCategory =
  | 'WAR'
  | 'POLITICAL'
  | 'EPIDEMIC'
  | 'DISASTER'
  | 'MIGRATION'
  | 'ECONOMIC'
  | 'CULTURAL'
  | 'RELIGIOUS'
  | 'LEGAL';

export interface CatalogueEntry {
  readonly title: string;
  readonly summary: string;
  readonly category: HistoricalCategory;
  /** 1–5: how far out the timeline still shows it. */
  readonly significance: number;
  readonly start: string;
  readonly end: string;
  /** Empty means the whole world. */
  readonly countryCodes: readonly string[];
  readonly regionLabels?: readonly string[];
}

export const HISTORICAL_CATALOGUE: readonly CatalogueEntry[] = [
  // --- Ancien Régime -------------------------------------------------------
  {
    title: 'Guerre de Succession d’Espagne',
    summary:
      'La France de Louis XIV contre une coalition européenne ; levées d’hommes et impôts lourds dans les campagnes.',
    category: 'WAR',
    significance: 3,
    start: '1701',
    end: '1714',
    countryCodes: ['FR'],
  },
  {
    title: 'Grand Hiver de 1709',
    summary:
      'Gel extrême à partir du 6 janvier 1709 : vignes et blés détruits, famine et forte mortalité dans tout le royaume.',
    category: 'DISASTER',
    significance: 4,
    start: '6 JAN 1709',
    end: 'MAR 1709',
    countryCodes: ['FR'],
  },
  {
    title: 'Mort de Louis XIV',
    summary: 'Fin d’un règne de soixante-douze ans ; Louis XV a cinq ans, la Régence commence.',
    category: 'POLITICAL',
    significance: 3,
    start: '1 SEP 1715',
    end: '1 SEP 1715',
    countryCodes: ['FR'],
  },
  {
    title: 'Règne de Louis XV',
    summary:
      'De la Régence à 1774 ; la population du royaume croît, les registres paroissiaux se généralisent et s’améliorent.',
    category: 'POLITICAL',
    significance: 2,
    start: '1 SEP 1715',
    end: '10 MAY 1774',
    countryCodes: ['FR'],
  },
  {
    title: 'Guerre de Sept Ans',
    summary:
      'Conflit mondial ; la France perd le Canada et l’essentiel de l’Inde au traité de Paris (1763).',
    category: 'WAR',
    significance: 3,
    start: '1756',
    end: '10 FEB 1763',
    countryCodes: ['FR'],
  },
  {
    title: 'Règne de Louis XVI',
    summary: 'Crise financière, mauvaises récoltes de 1788, convocation des États généraux.',
    category: 'POLITICAL',
    significance: 2,
    start: '10 MAY 1774',
    end: '21 SEP 1792',
    countryCodes: ['FR'],
  },

  // --- Révolution et Empire ---------------------------------------------------
  {
    title: 'Révolution française',
    summary:
      'Chute de la monarchie, création de l’état civil laïque en 1792 et adoption du calendrier républicain.',
    category: 'POLITICAL',
    significance: 5,
    start: '14 JUL 1789',
    end: '9 NOV 1799',
    countryCodes: ['FR'],
  },
  {
    title: 'Prise de la Bastille',
    summary: 'Le 14 juillet 1789, le peuple de Paris prend la forteresse royale.',
    category: 'POLITICAL',
    significance: 4,
    start: '14 JUL 1789',
    end: '14 JUL 1789',
    countryCodes: ['FR'],
    regionLabels: ['Paris'],
  },
  {
    title: 'Création de l’état civil',
    summary:
      'La loi du 20 septembre 1792 confie aux communes la tenue des naissances, mariages et décès : les registres paroissiaux cèdent la place à l’état civil.',
    category: 'LEGAL',
    significance: 4,
    start: '20 SEP 1792',
    end: '20 SEP 1792',
    countryCodes: ['FR'],
  },
  {
    title: 'Calendrier républicain en vigueur',
    summary: 'Seul calendrier de l’état civil français du 22 septembre 1792 au 31 décembre 1805.',
    category: 'POLITICAL',
    significance: 3,
    start: '22 SEP 1792',
    end: '31 DEC 1805',
    countryCodes: ['FR'],
  },
  {
    title: 'Guerres de Vendée',
    summary:
      'Insurrection de l’Ouest contre la République et répression ; la Touraine voisine voit passer armées et réfugiés.',
    category: 'WAR',
    significance: 3,
    start: 'MAR 1793',
    end: '1796',
    countryCodes: ['FR'],
    regionLabels: ['Vendée', 'Anjou', 'Poitou'],
  },
  {
    title: 'La Terreur',
    summary:
      'Gouvernement révolutionnaire d’exception, jusqu’à la chute de Robespierre le 9 thermidor an II.',
    category: 'POLITICAL',
    significance: 3,
    start: '5 SEP 1793',
    end: '27 JUL 1794',
    countryCodes: ['FR'],
  },
  {
    title: 'Conscription (loi Jourdan)',
    summary: 'Le service militaire devient obligatoire pour les hommes de vingt à vingt-cinq ans.',
    category: 'LEGAL',
    significance: 3,
    start: '5 SEP 1798',
    end: '5 SEP 1798',
    countryCodes: ['FR'],
  },
  {
    title: 'Code civil',
    summary:
      'Promulgué le 21 mars 1804 : mariage, filiation, successions — le droit de la famille pour un siècle et demi.',
    category: 'LEGAL',
    significance: 4,
    start: '21 MAR 1804',
    end: '21 MAR 1804',
    countryCodes: ['FR'],
  },
  {
    title: 'Premier Empire',
    summary: 'Napoléon Ier empereur, jusqu’à sa première abdication.',
    category: 'POLITICAL',
    significance: 4,
    start: '18 MAY 1804',
    end: '6 APR 1814',
    countryCodes: ['FR'],
  },
  {
    title: 'Guerres napoléoniennes',
    summary:
      'Douze ans de guerres en Europe ; des centaines de milliers de conscrits ne reviennent pas.',
    category: 'WAR',
    significance: 4,
    start: 'MAY 1803',
    end: '18 JUN 1815',
    countryCodes: ['FR'],
  },

  // --- Le XIXe siècle français ---------------------------------------------
  {
    title: 'Restauration',
    summary: 'Retour des Bourbons, Louis XVIII puis Charles X.',
    category: 'POLITICAL',
    significance: 2,
    start: '6 APR 1814',
    end: '29 JUL 1830',
    countryCodes: ['FR'],
  },
  {
    title: 'Monarchie de Juillet',
    summary: 'Louis-Philippe roi des Français, après les Trois Glorieuses de juillet 1830.',
    category: 'POLITICAL',
    significance: 2,
    start: '9 AUG 1830',
    end: '24 FEB 1848',
    countryCodes: ['FR'],
  },
  {
    title: 'Épidémie de choléra de 1832',
    summary:
      'Première grande épidémie de choléra en France : plus de cent mille morts, dont près de vingt mille à Paris.',
    category: 'EPIDEMIC',
    significance: 4,
    start: 'MAR 1832',
    end: 'OCT 1832',
    countryCodes: ['FR'],
  },
  {
    title: 'Loi Guizot sur l’instruction primaire',
    summary: 'Chaque commune doit entretenir une école de garçons (28 juin 1833).',
    category: 'CULTURAL',
    significance: 2,
    start: '28 JUN 1833',
    end: '28 JUN 1833',
    countryCodes: ['FR'],
  },
  {
    title: 'Premier recensement nominatif',
    summary:
      'À partir de 1836, la population est recensée tous les cinq ans, maison par maison et nom par nom.',
    category: 'LEGAL',
    significance: 2,
    start: '1836',
    end: '1836',
    countryCodes: ['FR'],
  },
  {
    title: 'Crue de la Loire de 1846',
    summary:
      'Première des trois grandes crues du siècle : levées rompues, vallée inondée de l’Orléanais à l’Anjou.',
    category: 'DISASTER',
    significance: 3,
    start: '17 OCT 1846',
    end: '23 OCT 1846',
    countryCodes: ['FR'],
    regionLabels: ['Val de Loire', 'Touraine'],
  },
  {
    title: 'Révolution de 1848 et Deuxième République',
    summary: 'Chute de Louis-Philippe ; suffrage universel masculin et abolition de l’esclavage.',
    category: 'POLITICAL',
    significance: 3,
    start: '24 FEB 1848',
    end: '2 DEC 1852',
    countryCodes: ['FR'],
  },
  {
    title: 'Suffrage universel masculin',
    summary: 'Décret du 5 mars 1848 : tous les hommes de vingt et un ans votent.',
    category: 'LEGAL',
    significance: 4,
    start: '5 MAR 1848',
    end: '5 MAR 1848',
    countryCodes: ['FR'],
  },
  {
    title: 'Abolition de l’esclavage',
    summary: 'Décret du 27 avril 1848, préparé par Victor Schœlcher.',
    category: 'LEGAL',
    significance: 4,
    start: '27 APR 1848',
    end: '27 APR 1848',
    countryCodes: ['FR'],
  },
  {
    title: 'Épidémie de choléra de 1849',
    summary: 'Nouvelle vague de choléra, de nouveau meurtrière à Paris et dans les villes.',
    category: 'EPIDEMIC',
    significance: 3,
    start: 'MAR 1849',
    end: 'OCT 1849',
    countryCodes: ['FR'],
  },
  {
    title: 'Second Empire',
    summary: 'Napoléon III ; chemins de fer, grands travaux, essor industriel.',
    category: 'POLITICAL',
    significance: 3,
    start: '2 DEC 1852',
    end: '4 SEP 1870',
    countryCodes: ['FR'],
  },
  {
    title: 'Crue de la Loire de 1856',
    summary: 'La plus forte crue connue sur la Loire moyenne : Tours inondée début juin.',
    category: 'DISASTER',
    significance: 3,
    start: '31 MAY 1856',
    end: '6 JUN 1856',
    countryCodes: ['FR'],
    regionLabels: ['Val de Loire', 'Touraine'],
  },
  {
    title: 'Crise du phylloxéra',
    summary:
      'Un puceron venu d’Amérique détruit le vignoble français ; ruine et exode de nombreux vignerons, en Touraine dans les années 1880.',
    category: 'ECONOMIC',
    significance: 3,
    start: '1863',
    end: '1900',
    countryCodes: ['FR'],
  },
  {
    title: 'Crue de la Loire de 1866',
    summary: 'Troisième grande crue du siècle, fin septembre.',
    category: 'DISASTER',
    significance: 2,
    start: '23 SEP 1866',
    end: '30 SEP 1866',
    countryCodes: ['FR'],
    regionLabels: ['Val de Loire', 'Touraine'],
  },
  {
    title: 'Guerre franco-prussienne',
    summary:
      'Défaite de Sedan, chute de l’Empire, perte de l’Alsace et de la Moselle au traité de Francfort.',
    category: 'WAR',
    significance: 4,
    start: '19 JUL 1870',
    end: '10 MAY 1871',
    countryCodes: ['FR'],
  },
  {
    title: 'Délégation du gouvernement à Tours',
    summary:
      'Paris assiégé, le gouvernement de la Défense nationale s’installe à Tours avant de gagner Bordeaux en décembre.',
    category: 'POLITICAL',
    significance: 3,
    start: '13 SEP 1870',
    end: '10 DEC 1870',
    countryCodes: ['FR'],
    regionLabels: ['Touraine'],
  },
  {
    title: 'Commune de Paris',
    summary: 'Insurrection parisienne écrasée lors de la Semaine sanglante.',
    category: 'POLITICAL',
    significance: 3,
    start: '18 MAR 1871',
    end: '28 MAY 1871',
    countryCodes: ['FR'],
    regionLabels: ['Paris'],
  },
  {
    title: 'Troisième République',
    summary: 'De la chute de l’Empire au vote des pleins pouvoirs de 1940.',
    category: 'POLITICAL',
    significance: 3,
    start: '4 SEP 1870',
    end: '10 JUL 1940',
    countryCodes: ['FR'],
  },
  {
    title: 'Lois Jules Ferry',
    summary: 'L’école primaire devient gratuite (1881), puis obligatoire et laïque (1882).',
    category: 'CULTURAL',
    significance: 4,
    start: '16 JUN 1881',
    end: '28 MAR 1882',
    countryCodes: ['FR'],
  },
  {
    title: 'Rétablissement du divorce (loi Naquet)',
    summary: 'Le divorce, aboli en 1816, est de nouveau possible à partir du 27 juillet 1884.',
    category: 'LEGAL',
    significance: 3,
    start: '27 JUL 1884',
    end: '27 JUL 1884',
    countryCodes: ['FR'],
  },
  {
    title: 'Pandémie de grippe de 1889',
    summary: 'Dite « grippe russe », elle fait le tour du monde en quelques mois.',
    category: 'EPIDEMIC',
    significance: 2,
    start: 'NOV 1889',
    end: 'MAR 1890',
    countryCodes: [],
  },
  {
    title: 'Séparation des Églises et de l’État',
    summary: 'Loi du 9 décembre 1905 : la République ne reconnaît ni ne salarie aucun culte.',
    category: 'RELIGIOUS',
    significance: 4,
    start: '9 DEC 1905',
    end: '9 DEC 1905',
    countryCodes: ['FR'],
  },

  // --- Le XXe siècle -------------------------------------------------------
  {
    title: 'Mobilisation générale',
    summary: 'Le 2 août 1914, les hommes de vingt à quarante-huit ans rejoignent leurs régiments.',
    category: 'WAR',
    significance: 4,
    start: '2 AUG 1914',
    end: '2 AUG 1914',
    countryCodes: ['FR'],
  },
  {
    title: 'Première Guerre mondiale',
    summary:
      'Près de 1,4 million de soldats français tués ; pas une commune sans monument aux morts.',
    category: 'WAR',
    significance: 5,
    start: '28 JUL 1914',
    end: '11 NOV 1918',
    // The belligerents, not the world: Argentina stayed neutral, and a life
    // lived in Buenos Aires did not run through it.
    countryCodes: ['FR', 'BE', 'GB', 'DE', 'AT', 'IT', 'RU', 'RS', 'US'],
  },
  {
    title: 'Bataille de Verdun',
    summary: 'Dix mois de combats ; plus de trois cent mille morts français et allemands.',
    category: 'WAR',
    significance: 5,
    start: '21 FEB 1916',
    end: '18 DEC 1916',
    countryCodes: ['FR'],
  },
  {
    title: 'Grippe espagnole',
    summary: 'Pandémie mondiale ; plus de deux cent mille morts en France.',
    category: 'EPIDEMIC',
    significance: 4,
    start: 'MAR 1918',
    end: '1919',
    countryCodes: [],
  },
  {
    title: 'Grande Dépression',
    summary:
      'Du krach de Wall Street (24 octobre 1929) à la fin des années trente, chômage et effondrement des prix agricoles.',
    category: 'ECONOMIC',
    significance: 4,
    start: '24 OCT 1929',
    end: '1939',
    countryCodes: [],
  },
  {
    title: 'Front populaire',
    summary: 'Gouvernement Léon Blum ; congés payés et semaine de quarante heures.',
    category: 'POLITICAL',
    significance: 3,
    start: '4 JUN 1936',
    end: '21 JUN 1937',
    countryCodes: ['FR'],
  },
  {
    title: 'Seconde Guerre mondiale',
    summary: 'De l’invasion de la Pologne à la capitulation du Japon.',
    category: 'WAR',
    significance: 5,
    start: '1 SEP 1939',
    end: '2 SEP 1945',
    countryCodes: [],
  },
  {
    title: 'Exode de 1940',
    summary:
      'Devant l’avance allemande, huit à dix millions de personnes fuient vers le sud ; la Loire est franchie en juin.',
    category: 'MIGRATION',
    significance: 3,
    start: '10 MAY 1940',
    end: '25 JUN 1940',
    countryCodes: ['FR'],
  },
  {
    title: 'Occupation de la France',
    summary:
      'De l’armistice du 22 juin 1940 à la Libération ; Tours est libérée le 1er septembre 1944, les dernières poches en mai 1945.',
    category: 'WAR',
    significance: 4,
    start: '22 JUN 1940',
    end: '8 MAY 1945',
    countryCodes: ['FR'],
  },
  {
    title: 'Droit de vote des femmes',
    summary:
      'Ordonnance du 21 avril 1944 ; les Françaises votent pour la première fois le 29 avril 1945.',
    category: 'LEGAL',
    significance: 4,
    start: '21 APR 1944',
    end: '29 APR 1945',
    countryCodes: ['FR'],
  },
  {
    title: 'Création de la Sécurité sociale',
    summary: 'Ordonnances d’octobre 1945.',
    category: 'LEGAL',
    significance: 3,
    start: '4 OCT 1945',
    end: '4 OCT 1945',
    countryCodes: ['FR'],
  },
  {
    title: 'Mention du décès en marge de l’acte de naissance',
    summary:
      'Depuis 1945, le décès est porté en marge de l’acte de naissance : un acte de naissance récent dit souvent où chercher le décès.',
    category: 'LEGAL',
    significance: 2,
    start: '29 MAR 1945',
    end: '29 MAR 1945',
    countryCodes: ['FR'],
  },
  {
    title: 'Trente Glorieuses',
    summary: 'Forte croissance, exode rural, électroménager et automobile pour tous.',
    category: 'ECONOMIC',
    significance: 3,
    start: '1945',
    end: '1975',
    countryCodes: ['FR'],
  },
  {
    title: 'Guerre d’Algérie',
    summary:
      'Du 1er novembre 1954 aux accords d’Évian ; plus d’un million d’appelés du contingent y servent.',
    category: 'WAR',
    significance: 4,
    start: '1 NOV 1954',
    end: '19 MAR 1962',
    countryCodes: ['FR', 'DZ'],
  },
  {
    title: 'Mai 68',
    summary: 'Révolte étudiante et grève générale.',
    category: 'POLITICAL',
    significance: 3,
    start: '3 MAY 1968',
    end: '30 JUN 1968',
    countryCodes: ['FR'],
  },
  {
    title: 'Premiers pas sur la Lune',
    summary: 'Le 20 juillet 1969, retransmis en direct dans le monde entier.',
    category: 'CULTURAL',
    significance: 2,
    start: '20 JUL 1969',
    end: '20 JUL 1969',
    countryCodes: [],
  },
  {
    title: 'Chute du mur de Berlin',
    summary: 'Le 9 novembre 1989, fin de la division de l’Europe.',
    category: 'POLITICAL',
    significance: 3,
    start: '9 NOV 1989',
    end: '9 NOV 1989',
    countryCodes: [],
  },

  // --- Argentine -------------------------------------------------------------
  {
    title: 'Révolution de Mai',
    summary:
      'Le 25 mai 1810, Buenos Aires se dote d’un gouvernement propre : début de l’indépendance argentine.',
    category: 'POLITICAL',
    significance: 3,
    start: '25 MAY 1810',
    end: '25 MAY 1810',
    countryCodes: ['AR'],
  },
  {
    title: 'Indépendance de l’Argentine',
    summary: 'Proclamée à Tucumán le 9 juillet 1816.',
    category: 'POLITICAL',
    significance: 4,
    start: '9 JUL 1816',
    end: '9 JUL 1816',
    countryCodes: ['AR'],
  },
  {
    title: 'Constitution argentine',
    summary: 'Adoptée le 1er mai 1853 ; elle invite expressément l’immigration européenne.',
    category: 'LEGAL',
    significance: 3,
    start: '1 MAY 1853',
    end: '1 MAY 1853',
    countryCodes: ['AR'],
  },
  {
    title: 'Grande vague d’immigration européenne en Argentine',
    summary:
      'Des millions d’Italiens, d’Espagnols et de Français s’installent en Argentine, surtout à Buenos Aires et dans la Pampa.',
    category: 'MIGRATION',
    significance: 4,
    start: '1857',
    end: '1930',
    countryCodes: ['AR', 'FR'],
  },
  {
    title: 'Fièvre jaune à Buenos Aires',
    summary:
      'L’épidémie de 1871 tue environ un habitant sur douze et pousse les familles aisées vers le nord de la ville.',
    category: 'EPIDEMIC',
    significance: 3,
    start: 'JAN 1871',
    end: 'JUN 1871',
    countryCodes: ['AR'],
    regionLabels: ['Buenos Aires'],
  },
  {
    title: 'Loi d’immigration et de colonisation (loi Avellaneda)',
    summary: 'Loi 817 du 19 octobre 1876 : accueil, hébergement et placement des immigrants.',
    category: 'LEGAL',
    significance: 3,
    start: '19 OCT 1876',
    end: '19 OCT 1876',
    countryCodes: ['AR'],
  },
  {
    title: 'Loi Sáenz Peña',
    summary: 'Suffrage masculin universel, secret et obligatoire en Argentine (13 février 1912).',
    category: 'LEGAL',
    significance: 3,
    start: '13 FEB 1912',
    end: '13 FEB 1912',
    countryCodes: ['AR'],
  },
  {
    title: 'Coup d’État de 1930 en Argentine',
    summary: 'Le 6 septembre 1930, premier coup d’État militaire de l’histoire argentine moderne.',
    category: 'POLITICAL',
    significance: 3,
    start: '6 SEP 1930',
    end: '6 SEP 1930',
    countryCodes: ['AR'],
  },
  {
    title: 'Présidences de Juan Perón',
    summary: 'Première période péroniste, jusqu’au coup d’État de septembre 1955.',
    category: 'POLITICAL',
    significance: 4,
    start: '4 JUN 1946',
    end: '21 SEP 1955',
    countryCodes: ['AR'],
  },
  {
    title: 'Droit de vote des femmes en Argentine',
    summary: 'Loi du 9 septembre 1947 ; premier vote en 1951.',
    category: 'LEGAL',
    significance: 3,
    start: '9 SEP 1947',
    end: '9 SEP 1947',
    countryCodes: ['AR'],
  },
  {
    title: 'Dictature militaire argentine',
    summary:
      'Du coup d’État du 24 mars 1976 au retour de la démocratie le 10 décembre 1983 ; des milliers de disparus.',
    category: 'POLITICAL',
    significance: 5,
    start: '24 MAR 1976',
    end: '10 DEC 1983',
    countryCodes: ['AR'],
  },
  {
    title: 'Guerre des Malouines',
    summary: 'Conflit entre l’Argentine et le Royaume-Uni, d’avril à juin 1982.',
    category: 'WAR',
    significance: 3,
    start: '2 APR 1982',
    end: '14 JUN 1982',
    countryCodes: ['AR'],
  },
  {
    title: 'Crise argentine de 2001',
    summary: 'Effondrement économique et émeutes des 19 et 20 décembre 2001.',
    category: 'ECONOMIC',
    significance: 3,
    start: '19 DEC 2001',
    end: '20 DEC 2001',
    countryCodes: ['AR'],
  },
];
