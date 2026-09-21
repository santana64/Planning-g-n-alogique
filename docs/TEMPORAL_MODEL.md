# Modèle temporel

Code : `packages/domain/src/date/` (types, calendriers, analyse, fenêtres,
mise en forme). Décision de fond : [ADR 0003](adr/0003-julian-day-number-as-temporal-axis.md).

## Une date est une fenêtre, pas un point

Aucune date du modèle n'est un `Date` JavaScript : il est faux avant 1582 (il
suppose le grégorien), ignore le calendrier républicain et porte un fuseau
horaire qu'un acte de naissance n'a pas. `Date` n'apparaît qu'au bord de
l'affichage (`jdnToDate`, `dateToJdn` pour « aujourd'hui »).

Toute date est une `GenealogicalDate` :

| Champ          | Contenu                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------- |
| `qualifier`    | `EXACT`, `ABOUT`, `CALCULATED`, `ESTIMATED`, `BEFORE`, `AFTER`, `BETWEEN`, `RANGE`, `UNKNOWN` |
| `calendar`     | `GREGORIAN`, `JULIAN`, `FRENCH_R` (républicain), `HEBREW`                                     |
| `precision`    | `DAY`, `MONTH`, `YEAR`, `DECADE`, `CENTURY`, `NONE`                                           |
| `start`, `end` | Parties du calendrier (année astronomique, mois, jour facultatifs)                            |
| `originalText` | **Le texte de la source, mot pour mot**, conservé même quand l'analyse échoue                 |
| `interval`     | La fenêtre possible `[earliest, latest]` en jours juliens ; `null` = non borné                |
| `sortJdn`      | Un point pour trier les listes — **jamais affiché comme s'il était la date**                  |
| `unparsed`     | Vrai quand le texte n'a pas pu être lu                                                        |

Une date se construit uniquement par `makeDate` ou par l'analyseur, pour que
la fenêtre ne puisse pas diverger des parties.

`BETWEEN` et `RANGE` ne se confondent jamais : « entre 1877 et 1880 » dit
qu'un événement a eu lieu **un jour** dans la fenêtre (une naissance) ; « de
1877 à 1880 » dit qu'un état a duré **toute** la fenêtre (une résidence, un
service militaire).

## L'axe : le jour julien

Un entier par jour, ordonné, qui traverse la bascule julien/grégorien et sert
directement d'abscisse au rendu. Conversions exactes, testées contre des
ancrages publiés et par propriétés (aller-retour sur des dates aléatoires) :

- **Grégorien** proleptique (y compris avant 1582 quand la source le dit) ;
- **Julien** (`@#DJULIAN@` en GEDCOM, ou calendrier choisi) ;
- **Républicain** : 1er vendémiaire an I = 22 septembre 1792 ; années
  sextiles III, VII, XI (règle de Romme) — « 18 brumaire an VIII » = 9 novembre
  1799 ; affiché « 4 germinal an VII » ;
- **Hébraïque** : conservé pour l'aller-retour GEDCOM, **pas converti**. Une
  telle date n'a pas de position sur la frise plutôt qu'une position inventée.

Une date sans calendrier explicite est lue en grégorien.

## De la date à la fenêtre

| Qualificatif            | Fenêtre                                                                         |
| ----------------------- | ------------------------------------------------------------------------------- |
| `EXACT` « juin 1877 »   | les trente jours de juin 1877 (une date n'est un jour que si le jour est connu) |
| `ABOUT` « vers 1877 »   | 1877 ± 5 ans                                                                    |
| `ESTIMATED`             | ± 10 ans                                                                        |
| `CALCULATED`            | ± 1 an                                                                          |
| `BEFORE` « avant 1877 » | ouverte à gauche, jusqu'à la veille du 1er janvier 1877                         |
| `AFTER` « après 1877 »  | à partir du lendemain du 31 décembre 1877, ouverte à droite                     |
| `BETWEEN` / `RANGE`     | du début de la première borne à la fin de la seconde                            |
| `UNKNOWN`               | aucune position                                                                 |

Les tolérances de `ABOUT`, `ESTIMATED` et `CALCULATED` sont une **décision
produit**, pas un fait : elles vivent dans `DEFAULT_ESTIMATION_POLICY`
(`types.ts`) et peuvent être passées autrement à `makeDate` et à l'analyseur.
Une borne ouverte reste `null` dans la donnée ; la mise en page emprunte
seulement 30 ans pour savoir où estomper le dessin.

## Lire une date

`parseGenealogicalDate(texte, options)` comprend deux langues à la fois :

- la grammaire **GEDCOM 7** (`ABT 1877`, `BET 1801 AND 1803`,
  `FROM 1877 TO 1880`, `FRENCH_R 4 GERM 7`, les échappements 5.5.1
  `@#DJULIAN@`, `@#DFRENCH R@`) ;
- le **français et l'anglais saisis à la main** : « 12 juin 1877 »,
  « vers 1750 », « v. 1750 », « avant 1750 », « entre 1801 et 1803 »,
  « de 1801 à 1803 », « 4 germinal an VII », mois abrégés.

Les dates numériques se lisent **jour d'abord** (convention française), sauf
quand les nombres lèvent l'ambiguïté. L'analyseur **ne lève jamais d'erreur et
ne jette rien** : un texte illisible (« 9 br 1889 ») revient en `UNKNOWN`,
`unparsed`, avec son texte d'origine, affiché tel quel et exporté en phrase de
date GEDCOM. Une lecture humaine peut ensuite être enregistrée comme une
affirmation.

## Écrire une date

`formatGenealogicalDate(date, { locale })` : « 12 juin 1877 », « vers 1750 »,
« avant 1750 », « entre 1801 et 1803 », « de 1801 à 1803 », « à partir de
1801 », « 1877 (calculé) », « 4 germinal an VII ». Une date illisible s'affiche
avec les mots de la source. `formatYearOnly` donne la forme courte des vues
denses. `toGedcomDateValue` donne la forme GEDCOM 7.

## La logique trivaluée

Les questions temporelles répondent `YES`, `MAYBE` ou `NO`, jamais un booléen
que la source ne justifie pas :

- `dateContains(date, jour)` — un `RANGE` contient tous ses jours (`YES`) ;
  tout autre qualificatif plus large qu'un jour ne peut donner que `MAYBE` ;
- `intervalsOverlap`, `isBefore` ;
- `wasAliveOn(naissance, décès, jour)` :
  - `YES` : né avec certitude avant, mort avec certitude après ;
  - `MAYBE` : compatible avec les dates, mais l'incertitude interdit de
    l'affirmer ;
  - `NO` : exclu par les dates.

La même règle existe en version « quatre nombres » (`wasAliveOnIntervals`),
utilisée à chaque image quand on fait glisser le curseur temporel : la question
ne quitte jamais le navigateur.

## La durée de vie

`resolveLifespan(naissance, décès, statut, aujourd'hui)` fait d'une naissance
et d'un décès une seule fenêtre :

- **borne supérieure inférée** : sans décès enregistré, une vie s'arrête au
  plus tard à naissance + **123 ans** (record vérifié de Jeanne Calment,
  arrondi) ; une personne déclarée vivante ne peut pas être morte avant
  aujourd'hui. La borne est marquée `latestIsInferred`, **jamais** recopiée
  dans une date de décès, et le rendu l'estompe au lieu de la tracer ;
- **contradiction** : un décès daté avant la naissance (ou un vivant né dans
  le futur) ne renverse pas la fenêtre — elle se réduit à son premier jour,
  `contradictory` est vrai, la base accepte la fiche et l'audit signale
  l'erreur. Une faute de frappe ne coûte ni la fiche, ni l'import entier.

Sans la borne de 123 ans, « qui était vivant en 1945 » remonterait chaque
ancêtre non daté et deviendrait inutilisable.

## Qui était vivant ?

Pour un jour donné, chaque personne tombe dans un seul groupe :

| État              | Sens                                            | Rendu sur la frise        |
| ----------------- | ----------------------------------------------- | ------------------------- |
| à naître          | naissance certainement postérieure              | presque effacée           |
| vivante           | `YES`                                           | pleine                    |
| peut-être vivante | `MAYBE`                                         | à moitié                  |
| décédée           | décès certainement antérieur                    | en retrait                |
| sans date         | aucune position                                 | à part, comptée à part    |
| protégée          | masquée à ce lecteur ([PRIVACY.md](PRIVACY.md)) | comptée, jamais détaillée |

La réponse affichée est **trois nombres, jamais un** : « 11 avec certitude,
1 possiblement, 7 sans date » — c'est le troisième qui dit où chercher. Les
événements postérieurs au jour choisi ne sont pas dessinés.

## Âges

`ageAt(naissance, jour)` rend une **fourchette** quand la naissance est
incertaine, et rien quand elle n'a pas de position. Les années entières se
comptent par `wholeYearsBetween` (anniversaire atteint ou non), jamais par une
division : 1700 → 1900 fait 200 ans, pas 199.

## Où ces règles servent

Frise et voyage temporel, carte (un lieu apparaît au curseur quand quelque
chose y est enregistré), éventail (rayon = années, épaisseur = incertitude),
constellation (profondeur = années), récit (âges, contexte historique encadré
par naissance **et** décès), audit (contradictions certaines ou possibles —
voir [GENEALOGY_RULES.md](GENEALOGY_RULES.md)).
