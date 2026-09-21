# Dépendances

Toutes les versions tierces vivent dans le **catalogue** de
`pnpm-workspace.yaml` ; les paquets y font référence par `"dep": "catalog:"`.
Une version ne peut donc pas diverger entre `apps/web` et `apps/worker`, et
elle se change à un seul endroit. Le catalogue ne contient que ce qui est
réellement utilisé : une entrée sans usage laisse croire que la brique fait
partie de la pile.

Installation reproductible : `pnpm install --frozen-lockfile` (la CI échoue si
le verrou n'est pas à jour). Les scripts d'installation sont bloqués par défaut
et autorisés paquet par paquet (`allowBuilds`).

## Exécution

| Élément    | Version                | Note                                                                                                                                 |
| ---------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Node.js    | **22.15.1** (`.nvmrc`) | Le cahier des charges disait 24 LTS ; 22 est le runtime présent sur la machine de développement, et rien n'utilise d'API propre à 24 |
| pnpm       | **12.4.2**             | espaces de travail + catalogue                                                                                                       |
| TypeScript | **5.9.3**              | pas 7 : `typescript-eslint` déclare `<6.1.0` — passer en 7 casse `pnpm lint` ([ADR 0002](adr/0002-dependency-pins.md))               |
| tsx        | 4.23.13                | exécute le worker et les scripts en TypeScript                                                                                       |

## Services (docker-compose)

| Service    | Image                        | Version constatée              | Port local  |
| ---------- | ---------------------------- | ------------------------------ | ----------- |
| PostgreSQL | `postgis/postgis:18-3.6`     | PostgreSQL 18.6, PostGIS 3.6.4 | **5434**    |
| Redis      | `redis:8-alpine`             | Redis 8                        | **6380**    |
| MinIO      | `quay.io/minio/minio:latest` | —                              | 9000 / 9001 |

Ports décalés parce que 5432, 5433 et 6379 sont pris par d'autres projets sur
cette machine. Extensions PostgreSQL : `citext`, `pg_trgm`, `postgis`,
`unaccent` ; collation ICU `fr-FR`.

## Web

| Paquet                            | Version |
| --------------------------------- | ------- |
| next                              | 16.3.5  |
| react, react-dom                  | 19.3.0  |
| next-intl                         | 4.14.5  |
| tailwindcss, @tailwindcss/postcss | 4.3.3   |
| postcss                           | 8.5.28  |
| clsx                              | 2.1.1   |
| tailwind-merge                    | 3.7.0   |
| zod                               | 4.6.5   |
| better-auth                       | 1.7.5   |
| three (`three/webgpu`, TSL)       | 0.186.0 |
| maplibre-gl                       | 6.9.1   |

## Données, travaux, stockage, IA

| Paquet                                            | Version  | Note                                                                                                |
| ------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| prisma, @prisma/client, @prisma/adapter-pg        | 7.10.0   | **épinglé** : `latest` pointe sur une version candidate 8 ([ADR 0002](adr/0002-dependency-pins.md)) |
| pg                                                | 8.23.0   | le client du driver adapter de Prisma 7                                                             |
| bullmq                                            | 6.3.6    | file des imports ; apporte son propre client Redis                                                  |
| @aws-sdk/client-s3, @aws-sdk/s3-request-presigner | 3.1132.0 | stockage privé, URLs présignées                                                                     |
| file-type                                         | 22.1.0   | validation aux nombres magiques                                                                     |
| @anthropic-ai/sdk                                 | 0.125.0  | sorties structurées, repli de refus côté serveur                                                    |

## Observabilité

| Paquet                                                                                                                                                              | Version | Actif quand                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------- |
| pino                                                                                                                                                                | 10.3.1  | toujours                                              |
| pino-pretty                                                                                                                                                         | 13.1.3  | développement seulement (dépendance de développement) |
| @vercel/otel + @opentelemetry/{api 1.9.1, api-logs 0.222.0, sdk-logs 0.222.0, instrumentation 0.222.0, resources 2.11.0, sdk-metrics 2.11.0, sdk-trace-base 2.11.0} | 2.1.3   | `OTEL_ENABLED=true`                                   |
| @sentry/node                                                                                                                                                        | 10.75.0 | `SENTRY_DSN` défini                                   |

## Qualité et tests

| Paquet                                | Version      |
| ------------------------------------- | ------------ |
| vitest, @vitest/coverage-v8           | 5.0.1        |
| @playwright/test                      | 1.63.0       |
| @axe-core/playwright                  | 4.13.0       |
| fast-check                            | 4.10.0       |
| eslint                                | 10.10.0      |
| typescript-eslint                     | 8.70.0       |
| @eslint/js                            | 10.0.1       |
| eslint-config-prettier                | 10.1.8       |
| eslint-plugin-react-hooks             | 7.1.1        |
| prettier, prettier-plugin-tailwindcss | 3.9.6, 0.8.1 |

Outils de build propres à `apps/web` : `topojson-client` et `world-atlas`
(conversion du fond de carte, uniquement au build).

## Ce que le cahier des charges demandait et qui n'est pas installé

Ces briques ont été retirées du catalogue une fois constaté qu'aucune ligne de
code ne les importait. Les garder aurait donné une fausse idée de la pile.

| Brique                                  | Pourquoi elle n'est pas là                                                                                                                                             |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Radix UI (10 paquets)                   | Les seuls éléments à comportement sont des `<dialog>` natifs et des champs standard ; rien n'en importait                                                              |
| Motion, GSAP                            | Le mouvement utile est en CSS, en SVG ou dans la boucle de rendu ([DESIGN_SYSTEM.md](DESIGN_SYSTEM.md))                                                                |
| Zustand, TanStack Query                 | L'état vient du serveur (composants serveur, actions, revalidation) ; l'état client tient dans `useState` et l'URL                                                     |
| bitECS, Graphology, ELK.js, Comlink, d3 | Pas d'ECS, pas de worker de mise en page, pas de moteur de graphe générique : mises en page dédiées et mesurées ([ENGINE.md](ENGINE.md))                               |
| sharp, pdfjs-dist                       | Ni vignettes ni rendu de pages : la visionneuse de documents n'existe pas encore ([ROADMAP](ROADMAP.md)) ; `sharp` reste installé comme dépendance optionnelle de Next |
| ioredis (en direct)                     | BullMQ apporte le sien ; rien ne l'importait                                                                                                                           |
| @testing-library/*, jsdom               | Aucun test ne rend un composant en isolation : les composants sont vérifiés par les E2E, la logique est testée sans React                                              |
| read-gedcom                             | Le lecteur GEDCOM 7 est écrit ici, avec la tolérance aux fichiers 5.5 ([GEDCOM.md](GEDCOM.md))                                                                         |
| Elasticsearch / OpenSearch              | `pg_trgm` répond en 39 ms à 20 000 personnes ([PERFORMANCE.md](PERFORMANCE.md)) : la règle du projet interdit d'ajouter un moteur sans preuve du contraire             |

## Politique de mise à jour

- Une version se change **dans le catalogue**, jamais dans un paquet.
- Les versions candidates et pré-versions sont refusées (Prisma 8 RC en est
  l'exemple vivant).
- pnpm 12 laisse passer un délai avant d'accepter une version tout juste
  publiée ; les paquets pour lesquels cette prudence a dû être levée (Vitest 5,
  Better Auth 1.7.5, sortis le jour de leur adoption) sont listés nommément
  dans `minimumReleaseAgeExclude`.
- Après toute mise à jour : `pnpm verify`, `pnpm test:integration`,
  `pnpm build`, `pnpm test:e2e`, et les deux images Docker.
