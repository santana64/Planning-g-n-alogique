# État du projet

**Dernière mise à jour** : 2026-09-15
**Phase courante** : 1 (fondation du domaine) — terminée ; démarrage de la 2

Ce fichier est factuel. Rien n'y est marqué fait sans avoir été exécuté.

---

## Terminé et vérifié

### Phase 0 — fondation du dépôt

| Élément                                           | Preuve                               |
| ------------------------------------------------- | ------------------------------------ |
| Monorepo pnpm, catalog de versions                | `pnpm install` passe, lockfile figé  |
| TypeScript strict + `noUncheckedIndexedAccess`    | `pnpm typecheck` passe               |
| ESLint 10 flat config + frontières d'architecture | `pnpm lint` passe, 0 warning         |
| Prettier                                          | `pnpm format:check` passe            |
| Docker Compose                                    | 3 services _healthy_                 |
| PostgreSQL 18.6 + PostGIS 3.6.4                   | interrogé en direct                  |
| Redis 8, MinIO (bucket privé)                     | `PING` / log d'init                  |
| Collation ICU `fr-FR`                             | `Lefebvre < Lefèvre < Lefort < Lévy` |
| UUIDv7 natif                                      | `uuidv7()` renvoie un id horodaté    |

### Phase 1 — modèle temporel et données

| Élément                                                  | Preuve                                  |
| -------------------------------------------------------- | --------------------------------------- |
| Conversions calendaires (grégorien, julien, républicain) | 16 tests, 4 ancrages historiques        |
| Modèle de date + logique trivaluée                       | 109 tests unitaires au total            |
| Parseur GEDCOM 7 + saisie naturelle FR/EN                | aller-retour prouvé par propriété       |
| Schéma Prisma, 31 tables                                 | migration appliquée                     |
| 14 contraintes CHECK                                     | chacune prouvée déclenchante            |
| 5 index trigram + 1 GiST spatial                         | listés dans `pg_indexes`                |
| Codec de dates base ↔ domaine                            | aller-retour prouvé, républicain inclus |

**Tests** : 109 unitaires + 23 d'intégration, tous verts.

---

## Bugs réels trouvés et corrigés

1. **Années sextiles du calendrier républicain.** Implémentées d'abord comme
   IV, VIII, XII (réflexe grégorien) au lieu de III, VII, XI. Toute date
   postérieure à l'an III était décalée d'un jour. Attrapé par l'ancrage
   « 18 brumaire an VIII = 9 novembre 1799 ».

2. **Volume PostgreSQL 18.** Les images 18+ exigent un montage sur
   `/var/lib/postgresql`, plus sur `/var/lib/postgresql/data` ; le conteneur
   refusait de démarrer.

3. **Images MinIO.** `minio/minio` et `minio/mc` ne sont plus servies par
   Docker Hub — elles vivent sur `quay.io`.

4. **Regex mutilée par Prettier.** `/[̀-ͯ]/` réécrit en caractères
   combinants littéraux ; remplacé par `/\p{Diacritic}/gu`.

---

## En cours

Rien. Point de reprise propre.

---

## Reste à faire

| Phase | Contenu                                                           | État    |
| ----- | ----------------------------------------------------------------- | ------- |
| 2     | Better Auth, permissions, CRUD personne / relation / événement    | à faire |
| 3     | Import / export GEDCOM 7 + écran de revue                         | à faire |
| 4     | Services de graphe (ancêtres, descendants, branches), recherche   | à faire |
| 5     | Moteur Chronolignée, Gantt, voyage temporel, « qui était vivant » | à faire |
| 6     | Carte MapLibre, migrations animées                                | à faire |
| 7     | Archives S3, visionneuse de documents                             | à faire |
| 8     | Pipeline IA, propositions, assistant                              | à faire |
| 9     | Constellation, profondeur temporelle, mode Récit                  | à faire |
| 10    | Collaboration, confidentialité des vivants                        | à faire |
| 11    | Durcissement production                                           | à faire |

---

## Décisions importantes

- **Prisma épinglé en 7.10.0** — `latest` = `8.0.0-rc.15` (RC). ADR 0002.
- **TypeScript 5.9.3, pas 7.0.2** — `typescript-eslint` exige `<6.1.0`. ADR 0002.
- **Node 22.15.1, pas 24 LTS** — seul runtime présent sur la machine.
- **PostgreSQL, pas Neo4j** — ADR 0001.
- **JDN comme axe canonique** — ADR 0003.
- **L'IA propose, l'humain valide** — ADR 0004.

## Hypothèses assumées

- Port PostgreSQL **5434** : 5432 et 5433 sont occupés par d'autres projets de
  cette machine (`reglo-reglo-db-1`, `revenue-operator-postgres`).
- Tolérance de `ABOUT` : ±5 ans. `ESTIMATED` : ±10 ans. `CALCULATED` : ±1 an.
  Décision produit, pas fait — modifiable dans `DEFAULT_ESTIMATION_POLICY`.
- Durée de vie maximale : 123 ans.
- Dates numériques lues **jour d'abord** (convention française), sauf quand les
  nombres lèvent l'ambiguïté.
- Calendrier hébraïque : conservé pour l'aller-retour GEDCOM, mais non converti
  en JDN. Ces dates n'ont pas de position temporelle plutôt qu'une position
  inventée.

## Points à surveiller

- Les commandes Prisma bloquent sans TTY : préfixer par `CI=true`.
- `packages/db/generated` est ignoré par git ; `pnpm db:generate` est requis
  après un clone.
