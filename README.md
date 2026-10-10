# Chronolignée

**Explorez votre famille dans le temps.**

Chronolignée traite la généalogie comme ce qu'elle est réellement : un graphe
**plus** du temps, de la géographie, du contexte historique et des preuves.

Un logiciel de généalogie classique répond à « qui est lié à qui ». Chronolignée
répond aussi à :

- qui a vécu quand, et **qui était vivant en même temps** ?
- où les branches ont-elles migré, et à quelle époque ?
- que se passait-il dans le monde pendant cette vie ?
- **quelle source appuie ce qu'on croit savoir** — et qu'est-ce qui la
  contredit ?

Sa vue signature est un **Gantt généalogique** : chaque vie est un intervalle
temporel, les relations relient les intervalles.

---

## Démarrage

```bash
pnpm install
pnpm infra:up      # PostgreSQL 18 + PostGIS, Redis, RustFS (S3), Mailpit
cp .env.example .env
# renseigner BETTER_AUTH_SECRET :
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
pnpm db:generate   # le client Prisma n'est pas versionné
pnpm db:migrate
pnpm db:seed
pnpm dev           # web (3000) + worker : le worker écrit les imports GEDCOM
```

Ou en une commande, après avoir créé le `.env` :

```bash
pnpm setup
```

### Ports

| Service                | Port        | Pourquoi celui-là                          |
| ---------------------- | ----------- | ------------------------------------------ |
| PostgreSQL             | **5434**    | 5432 et 5433 sont souvent déjà pris        |
| Redis                  | **6380**    | idem pour 6379                             |
| RustFS S3 / console    | 9000 / 9001 |                                            |
| Mailpit SMTP / console | 1025 / 8025 | attrape les courriels : rien ne sort d'ici |

---

## Commandes

| Commande                | Effet                                             |
| ----------------------- | ------------------------------------------------- |
| `pnpm dev`              | web + worker                                      |
| `pnpm verify`           | format + lint + typecheck + tests unitaires       |
| `pnpm test:unit`        | tests purs, sans I/O                              |
| `pnpm test:integration` | tests contre la vraie base (nécessite `infra:up`) |
| `pnpm test:e2e`         | Playwright, contre l'application construite       |
| `pnpm db:migrate`       | nouvelle migration                                |
| `pnpm db:drift`         | migrations ≟ schéma Prisma                        |
| `pnpm db:studio`        | explorateur de base                               |
| `pnpm benchmark`        | mesures du moteur temporel                        |
| `pnpm benchmark:db`     | mesures des requêtes, jusqu'à 20 000 personnes    |

Préfixer les commandes Prisma par `CI=true` hors terminal interactif : elles
bloquent sinon sur une invite.

---

## Ce qui rend ce modèle de données différent

Il n'y a **pas** de `person.birthDate`, ni de `person.fatherId`.

```
Source    ── ce qui existe dans un dépôt d'archives
Citation  ── l'endroit précis dans cette source
Claim     ── une affirmation, attribuée, datée, citable
```

La date de naissance d'une personne, c'est le `Claim` qu'un humain a marqué
`ACCEPTED`. Les claims rejetés et contestés **restent en base** : un
recensement qui dit 1878 contre un acte de baptême qui dit 1877, c'est une
information — souvent le fil qui, vingt ans plus tard, défait une mauvaise
identification.

### L'incertitude est de premier ordre

Une date n'est pas un point, c'est une fenêtre. Les questions temporelles
répondent sur trois valeurs :

```
Qui était vivant le 8 mai 1945 ?
  → 42 personnes avec certitude
  → 7 possiblement (dates trop imprécises pour trancher)
  → 12 sans aucune date
```

Voir [ADR 0003](docs/adr/0003-julian-day-number-as-temporal-axis.md).

---

## Structure

```
apps/web        interface Next.js, actions serveur, API
apps/worker     écriture des imports GEDCOM, purge des arbres supprimés

packages/domain     dates, invariants, confidentialité, droits — ne dépend de rien
packages/genealogy  traversée de graphe, validation, numérotations
packages/gedcom     lecture (UTF-8, ANSEL, Windows-1252…) et écriture GEDCOM 7
packages/engine     caméra temporelle, niveaux de détail, mises en page (calcul pur)
packages/db         Prisma, codec de dates, services, dépôts, données de démonstration
packages/ai         fournisseurs d'IA, extraction vérifiée
packages/storage    stockage S3 privé, validation des fichiers
packages/jobs       files de travaux
packages/config     validation d'environnement, garde de déploiement
packages/ui         jetons de design, palettes, langage de l'incertitude
```

Les dépendances pointent **vers l'intérieur**, et ESLint l'impose :
`packages/domain` ne peut importer ni `@prisma/client`, ni `react`, ni `next`.

---

## Documentation

- [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) — **l'état réel**, ce qui
  est vérifié, ce qui manque, ce qu'il faut surveiller
- [`docs/VISION.md`](docs/VISION.md) · [`ARCHITECTURE`](docs/ARCHITECTURE.md) ·
  [`DATA_MODEL`](docs/DATA_MODEL.md) · [`TEMPORAL_MODEL`](docs/TEMPORAL_MODEL.md) ·
  [`GENEALOGY_RULES`](docs/GENEALOGY_RULES.md) · [`ENGINE`](docs/ENGINE.md) ·
  [`DESIGN_SYSTEM`](docs/DESIGN_SYSTEM.md) · [`GEDCOM`](docs/GEDCOM.md) ·
  [`AI`](docs/AI.md)
- [`SECURITY`](docs/SECURITY.md) · [`PRIVACY`](docs/PRIVACY.md) ·
  [`PERFORMANCE`](docs/PERFORMANCE.md) · [`TESTING`](docs/TESTING.md) ·
  [`DEPLOYMENT`](docs/DEPLOYMENT.md) · [`DEPENDENCIES`](docs/DEPENDENCIES.md) ·
  [`ROADMAP`](docs/ROADMAP.md)
- [`docs/adr/`](docs/adr/) — décisions coûteuses à annuler
- [`CLAUDE.md`](CLAUDE.md) — guide de session, pièges de la stack

## Licence

Privée, non publiée.

## Édition de bureau (Windows)

Un installeur `.exe` qui embarque tout (PostgreSQL + PostGIS, worker, web) : voir [docs/DESKTOP.md](docs/DESKTOP.md).
