# Modèle de données

Source de vérité : `packages/db/prisma/schema/*.prisma` (schéma Prisma en
plusieurs fichiers) et `packages/db/prisma/migrations/` (SQL versionné). Ce
document dit pourquoi le modèle a cette forme et ce que l'application en utilise
réellement.

## Ce qui n'existe pas, volontairement

Il n'y a ni `person.birthDate`, ni `person.fatherId`, ni `person.motherId`.
Ces raccourcis ne savent pas dire une naissance contestée, un père adoptif à
côté d'un père biologique, ni une source qui en contredit une autre :

- une naissance ou un décès est un **événement** (`events`) auquel la personne
  participe ;
- une filiation ou une union est une **relation** orientée (`relationships`) ;
- ce que l'on croit, quand les registres divergent, est une **affirmation**
  (`claims`) avec un statut, appuyée par des **citations**.

## Conventions

- **`treeId` sur chaque ligne généalogique** : c'est la frontière entre les
  arbres, et la première colonne de presque tous les index.
- **Identifiants UUIDv7** générés par PostgreSQL 18 (`uuidv7()`), ou par
  l'application pour les écritures en masse de l'import : triés par date de
  création, donc des insertions locales dans les B-arbres.
- **Suppression douce** (`deletedAt`) pour les arbres, personnes, relations,
  événements, sources, documents et médias : un événement corrigé est archivé,
  pas écrasé. La purge définitive d'un arbre supprimé est faite par le worker.
- **Dates aplaties** : chaque date stocke ses parties structurées, son texte
  d'origine, et sa fenêtre en jours juliens (`…EarliestJdn`, `…LatestJdn`,
  `…SortJdn`). Les deux sont écrits ensemble par le codec
  (`packages/db/src/date-codec.ts`) — voir [TEMPORAL_MODEL.md](TEMPORAL_MODEL.md).
- **Historique** : chaque écriture significative ajoute une ligne à
  `revisions` dans la même transaction (champs modifiés seulement).

## Les tables, par domaine (29)

### Comptes et collaboration

| Table                                            | Rôle                                                                                      |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `users`, `sessions`, `accounts`, `verifications` | Forme attendue par Better Auth ; rien de généalogique. `accounts.password` = un hachage.  |
| `trees`                                          | Nom, `slug`, visibilité (`PRIVATE`/`LINK`/`PUBLIC`), règle des vivants, `revision`        |
| `tree_members`                                   | Appartenance et rôle (`OWNER`, `ADMIN`, `EDITOR`, `CONTRIBUTOR`, `VIEWER`)                |
| `tree_invitations`                               | Invitation à une adresse, rôle, **hachage** du jeton, expiration, acceptation, révocation |

`trees.revision` est incrémenté par toute écriture : c'est la clé du cache du
graphe côté web.

### Personnes et liens

| Table                  | Rôle                                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `people`               | Sexe **inscrit** (tel que le registre l'écrit), statut vivant, confidentialité, caches dérivés (voir plus bas)                      |
| `person_names`         | Noms structurés : type, prénom, particule, nom, nom de naissance, surnom, forme affichée, période, préféré                          |
| `relationships`        | Relation orientée ; pour une filiation, source = parent, cible = enfant. Fenêtre de validité, confiance                             |
| `duplicate_candidates` | Paires suspectes : score, explication signal par signal, statut (ouverte, écartée, fusionnée) — écrite par la recherche de doublons |

Types de relation : `PARENT_BIOLOGICAL`, `PARENT_ADOPTIVE`, `PARENT_FOSTER`,
`PARENT_STEP`, `PARENT_GUARDIAN`, `PARENT_UNKNOWN`, `SPOUSE`, `PARTNER`,
`DIVORCED_PARTNER`, `SIBLING`, `OTHER`. Filiation biologique et adoptive sont
deux valeurs distinctes, non un drapeau : un enfant peut avoir les deux, et
chacune doit pouvoir être citée et contestée séparément.

### Événements, lieux, histoire

| Table                    | Rôle                                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| `events`                 | 21 types (naissance, baptême, décès, inhumation, mariage, bans, contrat, divorce, résidence, …, `CUSTOM`) |
| `event_participants`     | Qui prend part, avec quel rôle (principal, époux, parent, enfant, témoin, parrain, officiant, …)          |
| `places`                 | Nom, nom historique et période, hiérarchie, coordonnées **et** `geography(Point)` PostGIS, pays           |
| `historical_events`      | Histoire générale, **partagée** entre arbres : période, pays, région, importance 1–5                      |
| `tree_historical_events` | Lien facultatif arbre ↔ événement historique (épinglé, note)                                              |

Un mariage est **un** événement à deux participants, pas deux faits sur deux
fiches : c'est ce qui permet de tracer un seul trait entre deux vies. Le nom
historique d'un lieu n'est jamais écrasé par un géocodage moderne.

### Preuves

| Table             | Rôle                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `sources`         | Ce qui existe dans un dépôt : titre, type, dépôt, **cote**, auteur, URL, fiabilité                                        |
| `citations`       | L'endroit précis dans la source (page, folio, volume, localisation), transcription **verbatim**, rattachée à un événement |
| `claims`          | Une affirmation (prédicat + valeur structurée) sur une personne, une relation **ou** un événement — exactement un sujet   |
| `claim_citations` | Plusieurs citations par affirmation, plusieurs affirmations par citation                                                  |

Statuts d'une affirmation : `PROPOSED`, `ACCEPTED`, `DISPUTED`, `REJECTED`,
`SUPERSEDED`. Une affirmation remplacée garde un lien vers celle qui la
remplace ; rien n'est supprimé.

### Archives et IA

| Table                                       | Rôle                                                                                               |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `documents`                                 | Document versé : type, clé de stockage aléatoire, SHA-256, taille, source, confidentialité         |
| `document_pages`                            | Pages rendues d'un document — **table prête, la visionneuse page à page n'existe pas encore**      |
| `media`, `event_media`, `person_media_tags` | Photographies et identification manuelle dans l'image — **tables prêtes, pas encore d'écran**      |
| `ai_proposals`                              | Sortie d'une lecture automatique en attente de décision, avec provenance complète ([AI.md](AI.md)) |

### Travail et audit

| Table            | Rôle                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| `revisions`      | Historique en ajout seul : entité, action, avant/après (champs modifiés), résumé, auteur, lot            |
| `import_jobs`    | Un import GEDCOM : état, encodage détecté, comptes, avertissements, progression, résultat, erreur        |
| `research_tasks` | Questions de recherche (hypothèse, dépôt, cote, période, résultat) — **table prête, pas encore d'écran** |

Actions d'historique : `CREATE`, `UPDATE`, `DELETE`, `RESTORE`, `MERGE`,
`IMPORT`, `ACCEPT_CLAIM`, `REJECT_CLAIM`, `EXPORT`.

## Caches dérivés

Des colonnes existent pour que les vues lisent des milliers de personnes en une
requête. Elles ne sont **jamais** saisies ; elles sont recalculées à chaque
écriture qui les concerne, et recalculables à tout moment :

| Colonne                                                         | Calculée par                                     | À partir de                                               |
| --------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------- |
| `people.lifespanEarliestJdn/LatestJdn`, `…LatestInferred`       | `packages/db/src/projections/person-lifespan.ts` | affirmation de naissance/décès acceptée, sinon événements |
| `people.birthSortJdn`                                           | idem                                             | idem                                                      |
| `people.displayName`, `people.searchName`                       | `packages/db/src/normalise.ts`                   | nom préféré ; `searchName` sans accents, en minuscules    |
| `person_names.normalisedSurname/Given`, `places.normalisedName` | idem                                             | le nom lui-même                                           |

Une affirmation acceptée l'emporte sur un événement (c'est un jugement explicite
entre des registres qui divergent) ; un baptême tient lieu de naissance non
enregistrée. `loadGenealogyGraph` recalcule plutôt que de faire confiance au
cache : un cache dérivé se verrait comme un désaccord, pas comme une erreur
silencieuse.

## Contraintes

Prisma ne sait pas tout exprimer ; les migrations ajoutent des contraintes
`CHECK`, chacune vérifiée par un test d'intégration qui la déclenche :

- une affirmation a **exactement un** sujet ;
- une relation ne relie pas une personne à elle-même ;
- toute fenêtre de dates est ordonnée (événements, durée de vie, relations,
  événements historiques) ;
- un événement `CUSTOM` porte un libellé ;
- importance historique entre 1 et 5 ;
- régions d'image, confiance d'un modèle et score de doublon entre 0 et 1 ;
- une paire de doublons est ordonnée ;
- coordonnées valides, un lieu n'est pas son propre parent.

Unicité : une relation d'un type donné par paire ordonnée ; un participant par
rôle et par événement. Aucune sur les noms de lieux : deux villages portent
souvent le même nom.

## Index

- Composites commençant par `treeId` sur toutes les tables d'arbre.
- `people (treeId, lifespanEarliestJdn, lifespanLatestJdn)` : la frise et « qui
  était vivant ».
- `events (treeId, dateEarliestJdn, dateLatestJdn)` et `(treeId, dateSortJdn)`.
- **Trigrammes (GIN, `pg_trgm`)** sur `people.searchName`,
  `person_names.normalisedSurname/Given`, `places.normalisedName`,
  `sources.title` : la recherche approchée.
- **GiST** sur `places.geom` : les requêtes spatiales.

Ces six index écrits à la main sont **déclarés dans le schéma Prisma** : un
index que Prisma ignore est un index que le prochain `migrate dev` supprime.
`pnpm db:drift` (en CI) vérifie qu'il n'y a aucun écart entre le schéma et les
migrations.

## Extensions et collation

`citext` (adresses insensibles à la casse), `pg_trgm`, `postgis`, `unaccent`.
Base créée en collation ICU `fr-FR` (tri : Lefebvre < Lefèvre < Lefort < Lévy).

## Migrations

| Migration                             | Contenu                                                         |
| ------------------------------------- | --------------------------------------------------------------- |
| `20260915171635_initial_domain_model` | Schéma initial, extensions, contraintes, index écrits à la main |
| `20260918122853_ai_proposal_citation` | Une proposition d'IA garde la citation qu'elle a lue            |
| `20260919140000_revision_export`      | Action d'historique `EXPORT`                                    |
| `20260919200000_import_job_result`    | Résultat d'un import écrit par le worker                        |

Règles : migrations versionnées seulement, jamais `db push` ; appliquer avec
`pnpm db:migrate:deploy` **avant** de basculer le trafic ; une migration reste
compatible avec la version précédente pendant la bascule
([DEPLOYMENT.md](DEPLOYMENT.md)).

## Données de démonstration

`pnpm db:seed` crée l'arbre fictif « Famille Chassagne » : 40 personnes de 1702
à 2026 en France et en Argentine, 13 mariages, un divorce, deux adoptions, une
émigration Tours → Buenos Aires, des dates républicaines et illisibles, des
sources contradictoires, un implexe, des vivants, une anomalie volontaire, un
doublon suspect et trois questions de recherche (ces dernières sans écran pour
l'instant). Le doublon n'est pas écrit à la main : le seed lance la vraie
recherche sur l'arbre qu'il vient de créer, pour que la démonstration montre ce
que le produit trouve. Aucune personne réelle. Il ne va jamais en production.
