# Règles généalogiques

Code : `packages/genealogy/src/` (graphe, validation, constats, numérotations),
seuils dans `findings.ts`, rendu des messages dans
`apps/web/src/lib/finding-messages.ts`.

## La distinction qui gouverne tout

| Gravité     | Sens                                                             | Effet                         |
| ----------- | ---------------------------------------------------------------- | ----------------------------- |
| **ERROR**   | Invariant dur : le graphe ne doit jamais entrer dans cet état    | l'écriture est **refusée**    |
| **WARNING** | Signal de recherche : inhabituel, peut-être faux, peut-être vrai | affiché, **ne bloque jamais** |
| **INFO**    | À remarquer, sans inquiétude                                     | affiché                       |

Refuser une mère de 52 ans perd une naissance réelle ; accepter un décès avant
la naissance corrompt toutes les requêtes temporelles. Ce qui les sépare est la
logique trivaluée : une violation **certaine** d'une règle dure est une erreur ;
la même violation seulement **possible** (dates imprécises) est un
avertissement. Chaque constat porte sa certitude (`CERTAIN` / `POSSIBLE`), et
l'interface dit « probablement » quand il le faut.

Un constat est un code et des paramètres, jamais une phrase : il se rend dans
la langue du lecteur.

## Avant une écriture : `validateRelationshipProposal`

Appelée par le service de relations avant toute création de lien ; toute
ERROR lève `RelationshipRefused` et rien n'est écrit.

| Code                       | Gravité                         | Règle                                                               |
| -------------------------- | ------------------------------- | ------------------------------------------------------------------- |
| `SELF_RELATIONSHIP`        | ERROR                           | une personne n'est pas liée à elle-même                             |
| `DUPLICATE_RELATIONSHIP`   | ERROR                           | un seul lien d'un type donné par paire ordonnée                     |
| `ANCESTRY_CYCLE`           | ERROR                           | personne n'est son propre ancêtre (filiations seulement)            |
| `CHILD_BORN_BEFORE_PARENT` | ERROR si certain, sinon WARNING | l'enfant naît avant le parent                                       |
| `BIRTH_AFTER_MOTHER_DEATH` | ERROR                           | naissance plus de 2 jours après le décès de la mère biologique      |
| `PARENT_TOO_YOUNG`         | WARNING                         | parent de moins de 13 ans à la naissance                            |
| `MOTHER_TOO_OLD`           | WARNING                         | mère biologique de plus de 55 ans                                   |
| `FATHER_TOO_OLD`           | WARNING                         | père biologique (ou parent de sexe non renseigné) de plus de 80 ans |
| `CHILD_BORN_BEFORE_PARENT` | WARNING                         | naissance plus de 320 jours après le décès du père                  |
| `POSTHUMOUS_BIRTH`         | INFO                            | naissance dans les 320 jours suivant le décès du père               |

Les âges se mesurent à la naissance la plus précoce possible de l'enfant — le
choix le plus prudent, qui ne peut pas fabriquer une violation. Un parent
adoptif de 70 ans est normal : les bornes d'âge maximales ne s'appliquent qu'à
la filiation biologique. Sans sexe inscrit, c'est la borne la plus large
(paternelle) qui s'applique : un faux avertissement sur chaque parent non
documenté apprendrait à ignorer les avertissements.

La base ajoute ses propres garde-fous, indépendants du code : pas de relation
d'une personne à elle-même, fenêtres de dates ordonnées, unicité des liens
(voir [DATA_MODEL.md](DATA_MODEL.md)).

## Sur les données existantes : `auditPerson`

Calculé à chaque affichage d'une fiche, **jamais bloquant** :

| Code                       | Gravité                         | Règle                                                                                                        |
| -------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `DEATH_BEFORE_BIRTH`       | ERROR si certain, sinon WARNING | le décès précède la naissance                                                                                |
| `LIFESPAN_IMPLAUSIBLE`     | WARNING                         | plus de 123 ans de vie ; certain seulement si les deux dates sont au jour                                    |
| `NO_TEMPORAL_EVIDENCE`     | INFO                            | ni naissance ni décès datés                                                                                  |
| `SIBLINGS_BORN_TOO_CLOSE`  | WARNING                         | deux naissances d'un même parent biologique à moins de 240 jours (jumeaux exceptés, dates au jour seulement) |
| + les règles parent/enfant | voir ci-dessus                  | appliquées à chaque filiation existante                                                                      |

Une fiche dont les dates se contredisent **reste enregistrable** : la fenêtre
de vie est ramenée à son premier jour, la base l'accepte, et l'audit affiche
l'erreur. Une faute de frappe ne doit pas faire perdre la fiche.

`auditTree` (cycles, constats de chaque personne, composantes déconnectées
`DISCONNECTED_COMPONENT`, dédoublonnage des constats vus des deux côtés) est
affiché par l'écran **Recherche** de chaque arbre (membres seulement), avec les
faits sans source, les affirmations contestées et les pistes de recherche.

### Les événements d'une vie, mesurés à la vie

Chaque personne arrive à l'audit avec **ses propres** événements (rôle
principal ou conjoint — un témoin, un parrain, le père d'un enfant né après sa
mort ne sont pas mesurés à leur propre vie) et ses affirmations datées
acceptées.

| Code                            | Gravité              | Règle                                                                                                                          |
| ------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `MARRIAGE_BEFORE_BIRTH`         | ERROR                | une union certainement antérieure à la naissance                                                                               |
| `MARRIAGE_AFTER_DEATH`          | WARNING même certain | une union après le décès : le mariage posthume existe (art. 171 du Code civil)                                                 |
| `MARRIED_TOO_YOUNG`             | WARNING              | sous 12 ans ; certain si même l'âge maximal est en dessous, « probablement » si l'âge le plus probable (milieu à milieu) l'est |
| `EVENT_OUTSIDE_LIFESPAN`        | ERROR                | un autre événement certainement avant la naissance, ou après le décès (inhumation, crémation, succession exceptées)            |
| `CONTRADICTORY_ACCEPTED_CLAIMS` | WARNING              | deux affirmations acceptées sur la même date, dont les fenêtres ne se recouvrent pas                                           |

Deux décisions, chacune prise après un faux positif réel :

- **Seul un ordre certain est signalé** pour les événements. Deux dates à
  l'année se recouvrent dès qu'elles partagent l'année : un baptême « 1850 »
  et une naissance « 1850 » sont le cas normal, pas un « baptême possiblement
  avant la naissance ».
- **Deux dates « vers » ne fabriquent pas une enfant mariée.** Perrine, née
  « vers 1708 », mariée « vers 1728 » : les fenêtres permettent dix ans, l'âge
  probable est vingt. Le doute n'est dit que si l'âge probable est sous le
  seuil.

Au passage, une **date inconnue** (fenêtre sans bornes) ne produit plus de
soupçon : comparées naïvement, deux dates inconnues donnaient « décès
possiblement avant la naissance » à chaque personne sans dates.

### Codes réservés, non encore produits

`CUSTOM_EVENT_UNLABELLED` (la base l'interdit déjà par contrainte),
`DUPLICATE_CANDIDATE`, `CLAIM_WITHOUT_CITATION` (l'écran Recherche liste les
faits sans source par requête plutôt que par constat), `PEDIGREE_COLLAPSE` :
leurs messages existent, **aucune règle ne les émet**. Les doublons ont leur propre
écran (voir plus bas) ; ils ne remontent pas encore comme constat sur la fiche. L'implexe est aujourd'hui
montré par la numérotation Sosa (une personne à plusieurs numéros), pas comme un
constat.

## Seuils

`DEFAULT_THRESHOLDS`, injectables, jugements sur ce qui est inhabituel — pas sur
ce qui est possible :

| Seuil                               | Valeur    |
| ----------------------------------- | --------- |
| âge minimal d'un parent             | 13 ans    |
| âge maximal d'une mère              | 55 ans    |
| âge maximal d'un père               | 80 ans    |
| durée de vie maximale               | 123 ans   |
| âge minimal au mariage              | 12 ans    |
| naissance posthume (père)           | 320 jours |
| naissance après décès (mère)        | 2 jours   |
| écart minimal entre frères et sœurs | 240 jours |

## Doublons et fusion

Deux imports d'une même famille laissent la même personne deux fois. La
recherche (`scanDuplicates`, file `duplicate-scan`, lancée depuis l'écran
« Doublons ») rapproche d'abord par trigrammes sur le nom normalisé — au plus
**huit voisins par personne** et **5 000 paires par passage**, seuil de
similarité 0,5 — puis score chaque paire.

**Quatre refus passent avant toute arithmétique**, parce qu'aucune
accumulation de ressemblances ne doit les emporter :

| Refus                  | Pourquoi                                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| `SAME_PERSON`          | la même fiche deux fois                                                                                        |
| `RECORDED_SEX_DIFFERS` | le registre a écrit ce qu'il a écrit                                                                           |
| `DIRECTLY_RELATED`     | parent, enfant ou conjoint : le père et le fils du même nom sont deux personnes                                |
| `DATES_EXCLUDE_IT`     | naissances (ou décès) datés au-delà de la tolérance de 8 ans : c'est une preuve contre, pas un signal manquant |

Le score est une moyenne pondérée des seuls signaux **mesurables** des deux
côtés — nom 0,24, prénom 0,20, naissance 0,24, décès 0,08, parents 0,12,
union 0,05, enfants 0,05, lieu de naissance 0,02 — normalisée sur ces
signaux-là : une paire sans dates n'est pas punie pour les dates qu'elle n'a
pas. Au-dessus de **0,62**, la paire est proposée. L'écran affiche toujours le
score **avec** les signaux qui l'ont produit ; un nombre seul demanderait
qu'on lui fasse confiance.

Une fusion (capacité `delete`, jamais un contributeur) déplace vers la fiche
gardée tout ce que la fiche retirée portait — noms, participations aux
événements, liens, affirmations, propositions, étiquettes de photographie,
pistes de recherche — puis :

- **rien n'est arbitré** : deux dates de naissance deviennent deux événements
  de naissance sur la fiche gardée, et la contradiction est affichée par
  l'audit ; choisir est la décision de recherche suivante, pas celle-ci ;
- **un lien déjà présent des deux côtés n'est pas écrit deux fois** ;
- la fiche retirée est **effacée en douceur**, jamais détruite : un
  identifiant cité dans une révision ancienne doit encore résoudre ;
- toutes les paires qui la nommaient passent à `MERGED`, et une révision
  `MERGE` dit ce qui a bougé.

## Ce qui n'est jamais déduit

- **Aucune relation n'est créée en silence.** Ajouter un mariage avec un
  conjoint **propose** le lien d'union ; le formulaire le demande.
- **Aucune fusion automatique.** La recherche de doublons propose des paires
  avec leur score et les signaux qui l'ont produit ; fusionner reste une
  décision humaine, prise devant les deux fiches (voir ci-dessous).
- **Aucun sexe deviné** pour placer un parent : voir Sosa ci-dessous.
- **Aucune date inventée** : une date illisible reste un texte, une borne
  inférée reste marquée comme telle ([TEMPORAL_MODEL.md](TEMPORAL_MODEL.md)).

## Vocabulaire des relations

Filiation : biologique, adoptive, d'accueil, beau-parent, tutelle, inconnue —
toujours orientée **parent → enfant**, pour que la remontée des ancêtres ne
bifurque jamais. Union : conjoint, partenaire, ex-conjoint (divorce), avec une
fenêtre de validité. Autres : fratrie, autre. **Seule la filiation biologique
fait l'ascendance génétique** (Sosa) ; les autres filiations sont des lignes
familiales réelles, affichées comme telles.

## Numérotations et parenté

- **Sosa-Stradonitz** (`sosaNumbers`) : sujet 1, père 2n, mère 2n+1, selon le
  **sexe inscrit**. Un parent de sexe non renseigné prend la première case
  libre du couple, et la position est signalée comme provisoire. Filiation
  biologique seulement. Un ancêtre atteint par plusieurs chemins (implexe)
  garde **tous** ses numéros. Exact jusqu'à la génération 53 (au-delà, les
  entiers JavaScript ne le sont plus : le parcours s'arrête et le dit).
- **Complétude** (`pedigreeCompleteness`) : par génération, en **personnes**,
  pas en cases — « complet jusqu'à la génération 5, puis une seule branche »
  dit où chercher, une moyenne ne le dit pas.
- **D'Aboville** (`abovilleNumbers`) : 1, 1.1, 1.2… dans l'ordre des naissances ;
  un enfant sans date va en dernier, marqué « rang non attesté » ; les enfants
  adoptés sont inclus ; un descendant par deux lignes garde ses deux numéros ;
  un cycle échappé à la validation tronque le parcours au lieu de le faire
  boucler.
- **Parenté** (`kinship`) : par l'ancêtre commun **le plus proche**, rendue en
  code + nombres puis accordée en français (« cousin issu de germain »,
  « petite-nièce », « arrière-grand-oncle ») ; sans sexe inscrit, les deux
  formes (« petit-neveu ou petite-nièce »).

## Personnes vivantes

Une personne est **présumée vivante** si elle est déclarée vivante, ou si aucun
décès n'est enregistré et qu'elle a pu vivre jusqu'à aujourd'hui (née il y a
moins de 123 ans, ou non datée). La règle complète de masquage est dans
[PRIVACY.md](PRIVACY.md).

## Statistiques

`treeStatistics` et `atAge` (`packages/genealogy/src/statistics.ts`) décrivent
**l'arbre enregistré, pas une population**, et l'écran le dit. Règles :

- un âge n'est mesuré qu'entre deux dates connues à environ un an près
  (fenêtre ≤ 400 jours), de milieu à milieu ; « vers 1708 » ne compte pas ;
- médianes plutôt que moyennes seules, et chaque chiffre dit sur combien de
  fiches il repose ;
- un mariage non enregistré n'est pas « célibataire » : la comparaison « au
  même âge » affiche « — » ;
- les axes sont continus : une décennie sans naissance est un zéro, pas un
  trou ;
- seules les personnes visibles par le lecteur sont comptées : un décompte
  incluant les vivants protégés permettrait de les retrouver par différence.
