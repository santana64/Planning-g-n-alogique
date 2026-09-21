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
`DISCONNECTED_COMPONENT`, dédoublonnage des constats vus des deux côtés) existe
et est testé, mais **aucun écran ne l'affiche encore** (voir
[ROADMAP](ROADMAP.md)).

### Codes réservés, non encore produits

Le vocabulaire prévoit `EVENT_OUTSIDE_LIFESPAN`, `CUSTOM_EVENT_UNLABELLED` (la
base l'interdit déjà par contrainte), `MARRIAGE_BEFORE_BIRTH`,
`MARRIAGE_AFTER_DEATH`, `MARRIED_TOO_YOUNG`, `CONTRADICTORY_ACCEPTED_CLAIMS`,
`DUPLICATE_CANDIDATE`, `CLAIM_WITHOUT_CITATION`, `PEDIGREE_COLLAPSE` : leurs
messages existent, **aucune règle ne les émet**. L'implexe est aujourd'hui
montré par la numérotation Sosa (une personne à plusieurs numéros), pas comme un
constat.

## Seuils

`DEFAULT_THRESHOLDS`, injectables, jugements sur ce qui est inhabituel — pas sur
ce qui est possible :

| Seuil                               | Valeur                                     |
| ----------------------------------- | ------------------------------------------ |
| âge minimal d'un parent             | 13 ans                                     |
| âge maximal d'une mère              | 55 ans                                     |
| âge maximal d'un père               | 80 ans                                     |
| durée de vie maximale               | 123 ans                                    |
| âge minimal au mariage              | 12 ans (réservé : aucune règle de mariage) |
| naissance posthume (père)           | 320 jours                                  |
| naissance après décès (mère)        | 2 jours                                    |
| écart minimal entre frères et sœurs | 240 jours                                  |

## Ce qui n'est jamais déduit

- **Aucune relation n'est créée en silence.** Ajouter un mariage avec un
  conjoint **propose** le lien d'union ; le formulaire le demande.
- **Aucune fusion automatique.** La table des doublons existe, aucun
  calculateur ne l'alimente encore, et une fusion restera une décision humaine.
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
