# Chronolignée — guide de session

Généalogie = graphe **+ temps + géographie + contexte historique + preuves**.
Pas un CRUD d'arbre. La vue signature est un **Gantt généalogique** : chaque
vie est un intervalle temporel, les relations relient les intervalles.

## Les 5 règles qu'on ne casse jamais

1. **Preuve avant affirmation.** Une date de naissance n'est pas une colonne :
   c'est un événement, appuyé par des citations, et ce qu'un humain a marqué
   `ACCEPTED` l'emporte. Les claims rejetés et contestés restent en base.
2. **L'incertitude reste visible.** Toute date se résout en fenêtre possible.
   Les questions d'appartenance répondent `YES` / `MAYBE` / `NO`, jamais un
   booléen que la source ne justifie pas.
3. **L'IA propose, l'humain valide.** Une sortie de modèle devient un
   `AiProposal`, jamais un `Claim` directement.
4. **Un modèle canonique, plusieurs projections visuelles.** Timeline, arbre,
   constellation, carte, récit lisent la même donnée.
5. **Pas de fausse précision, pas de faux progrès, pas de fausse généalogie.**

## Commandes

```bash
pnpm setup              # install + infra + generate + migrate + seed (première fois)
pnpm infra:up           # postgres 5434, redis 6380, minio 9000/9001, mailpit 1025/8025
pnpm dev                # web + worker (le worker écrit les imports)
pnpm verify             # format:check + lint + typecheck + test:unit  ← avant tout commit
pnpm test:integration   # nécessite pnpm infra:up
pnpm build && pnpm test:e2e   # E2E contre l'application construite + le worker
pnpm db:migrate         # nouvelle migration      pnpm db:generate  après un clone
pnpm db:drift           # migrations ≟ schéma (SHADOW_DATABASE_URL requis)
pnpm benchmark          # moteur          pnpm benchmark:db   # base
```

`CI=true` devant les commandes Prisma : sinon elles bloquent sur une invite
interactive sans TTY.

## Paquets

| Package     | Rôle                                                         | Dépend de                             |
| ----------- | ------------------------------------------------------------ | ------------------------------------- |
| `domain`    | dates, calendriers, trivalué, privacy, droits                | rien (interdit : db, ui, react, next) |
| `genealogy` | graphe, validation, Sosa, d'Aboville, parenté                | domain                                |
| `gedcom`    | décodage, parseur, mappeur, écriture GEDCOM 7                | domain, genealogy                     |
| `engine`    | caméra, échelle, LOD, mises en page, récits — **calcul pur** | domain, genealogy                     |
| `db`        | Prisma, codec de dates, services, dépôts, seed               | domain, gedcom, genealogy             |
| `ai`        | fournisseurs, extraction vérifiée                            | domain                                |
| `storage`   | S3, clés d'objets, validation de fichiers                    | rien                                  |
| `jobs`      | files, charges utiles, reprises                              | rien                                  |
| `mail`      | envoi SMTP, confirmation, mot de passe oublié, invitation    | rien                                  |
| `config`    | validation d'environnement (Zod), garde de déploiement       | rien                                  |
| `ui`        | jetons de design, palettes, incertitude                      | rien                                  |

Les dépendances pointent **vers l'intérieur**. ESLint l'impose : `domain` ne
peut importer ni `@prisma/client`, ni `react`, ni `next`. Le rendu (canevas
2D de la frise, three.js de la constellation, MapLibre) vit dans `apps/web`,
pas dans `engine`.

## Pièges de cette stack (vérifiés, pas supposés)

- **Prisma est épinglé en 7.10.0.** Le tag `latest` pointe sur une RC 8. Ne pas
  « mettre à jour ». Prisma 7 : pas d'`url` dans le datasource
  (`packages/db/prisma.config.ts`), driver adapter, et `migrate diff` utilise
  `--to-schema` (plus `--to-schema-datamodel`) avec un `shadowDatabaseUrl`
  **séparé** — jamais la base principale, que Prisma vide.
- **TypeScript reste en 5.9.3** : `typescript-eslint` déclare `<6.1.0`.
- **`next lint` n'existe plus** (Next 16) : c'est `eslint .`.
- **PostgreSQL 18** monte son volume sur `/var/lib/postgresql`. **MinIO** vit
  sur `quay.io`. **Postgres est sur 5434**, Redis sur **6380**.
- **Un index écrit à la main doit être déclaré dans le schéma Prisma**, sinon
  le prochain `migrate dev` écrit sa suppression (trigrammes, GiST).
- **L'import GEDCOM s'écrit dans le worker** : le web met en file (Redis),
  le worker écrit. Sans worker, l'import reste « en file d'attente ».
- **La vérification d'adresse suit le courriel** : avec `MAIL_TRANSPORT=smtp`,
  une inscription doit confirmer son adresse (Mailpit attrape le message en
  local, `http://localhost:8025`) ; avec `none`, la vérification et le mot de
  passe oublié disparaissent de l'interface.
- **Les tests unitaires d'`apps/web` importent en chemin relatif** : l'alias
  `@/` n'est pas résolu hors de Next.
- **Un test E2E instable dit quelque chose** : le reproduire (ralentir une
  navigation, charger la machine) avant de le retoucher.

## Documentation

`docs/` : [VISION](docs/VISION.md), [ARCHITECTURE](docs/ARCHITECTURE.md),
[DATA_MODEL](docs/DATA_MODEL.md), [TEMPORAL_MODEL](docs/TEMPORAL_MODEL.md),
[GENEALOGY_RULES](docs/GENEALOGY_RULES.md), [ENGINE](docs/ENGINE.md),
[DESIGN_SYSTEM](docs/DESIGN_SYSTEM.md), [SECURITY](docs/SECURITY.md),
[PRIVACY](docs/PRIVACY.md), [GEDCOM](docs/GEDCOM.md), [AI](docs/AI.md),
[PERFORMANCE](docs/PERFORMANCE.md), [TESTING](docs/TESTING.md),
[DEPLOYMENT](docs/DEPLOYMENT.md), [DEPENDENCIES](docs/DEPENDENCIES.md),
[ROADMAP](docs/ROADMAP.md), [PROJECT_STATUS](docs/PROJECT_STATUS.md), et les
ADR dans `docs/adr/`.

**L'état réel, phase par phase, avec ce qui reste : `docs/PROJECT_STATUS.md`.**
Le mettre à jour fait partie du travail, pas de la finition.

## Raccourcis interdits

- `any`, `!` non justifié
- logique métier dans un composant React
- `db push` en production — les migrations font foi
- écrire une fenêtre JDN à la main : passer par `encodeDate` / `decodeDate`
- accepter une sortie d'IA sans revue humaine
- une barre de progression qui n'est pas adossée à du travail réel
- déclarer une dépendance que rien n'importe
- affirmer qu'une chose marche sans l'avoir exécutée
