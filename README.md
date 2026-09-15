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
pnpm infra:up      # PostgreSQL 18 + PostGIS, Redis, MinIO
cp .env.example .env
# renseigner BETTER_AUTH_SECRET :
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Ou en une commande, après avoir créé le `.env` :

```bash
pnpm setup
```

### Ports

| Service             | Port        | Pourquoi celui-là                   |
| ------------------- | ----------- | ----------------------------------- |
| PostgreSQL          | **5434**    | 5432 et 5433 sont souvent déjà pris |
| Redis               | **6380**    | idem pour 6379                      |
| MinIO API / console | 9000 / 9001 |                                     |

---

## Commandes

| Commande                | Effet                                             |
| ----------------------- | ------------------------------------------------- |
| `pnpm dev`              | web + worker                                      |
| `pnpm verify`           | format + lint + typecheck + tests unitaires       |
| `pnpm test:unit`        | tests purs, sans I/O                              |
| `pnpm test:integration` | tests contre la vraie base (nécessite `infra:up`) |
| `pnpm test:e2e`         | Playwright                                        |
| `pnpm db:migrate`       | nouvelle migration                                |
| `pnpm db:studio`        | explorateur de base                               |
| `pnpm benchmark`        | mesures du moteur temporel                        |

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
apps/web        interface Next.js
apps/worker     jobs longs (import GEDCOM, extraction IA, vignettes)

packages/domain     dates, invariants, types purs — ne dépend de rien
packages/db         Prisma, codec de dates, normalisation
packages/genealogy  traversée de graphe et règles
packages/gedcom     import / export GEDCOM 7
packages/engine     moteur temporel WebGPU
packages/config     validation d'environnement
```

Les dépendances pointent **vers l'intérieur**, et ESLint l'impose :
`packages/domain` ne peut importer ni `@prisma/client`, ni `react`, ni `next`.

---

## Documentation

- [`CLAUDE.md`](CLAUDE.md) — guide de session, pièges de la stack
- [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) — état réel d'avancement
- [`docs/adr/`](docs/adr/) — décisions coûteuses à annuler

## Licence

Privée, non publiée.
