# Chronolignée — guide de session

Généalogie = graphe **+ temps + géographie + contexte historique + preuves**.
Pas un CRUD d'arbre. La vue signature est un **Gantt généalogique** : chaque
vie est un intervalle temporel, les relations relient les intervalles.

## Les 5 règles qu'on ne casse jamais

1. **Preuve avant affirmation.** Une date de naissance n'est pas une colonne,
   c'est le `Claim` qu'un humain a marqué `ACCEPTED`. Les claims rejetés et
   contestés restent en base.
2. **L'incertitude reste visible.** Toute date se résout en fenêtre possible.
   Les questions d'appartenance répondent `YES` / `MAYBE` / `NO`, jamais un
   booléen que la source ne justifie pas.
3. **L'IA propose, l'humain valide.** Une sortie de modèle devient un
   `AiProposal`, jamais un `Claim` directement.
4. **Un modèle canonique, plusieurs projections visuelles.** Timeline, arbre,
   constellation, carte lisent la même donnée.
5. **Pas de fausse précision, pas de faux progrès, pas de fausse généalogie.**

## Commandes

```bash
pnpm setup              # install + infra + migrate + seed (première fois)
pnpm infra:up           # postgres 5434, redis 6380, minio 9000/9001
pnpm dev                # web + worker
pnpm verify             # format:check + lint + typecheck + test:unit  ← avant tout commit
pnpm test:integration   # nécessite pnpm infra:up
pnpm db:migrate         # nouvelle migration
```

`CI=true` devant les commandes Prisma : sinon elles bloquent sur une invite
interactive sans TTY.

## Packages

| Package     | Rôle                                  | Dépend de                             |
| ----------- | ------------------------------------- | ------------------------------------- |
| `domain`    | dates, invariants, types purs         | rien (interdit : db, ui, react, next) |
| `db`        | Prisma, codec de dates, normalisation | domain                                |
| `genealogy` | traversée de graphe, règles           | domain                                |
| `gedcom`    | import/export GEDCOM 7                | domain                                |
| `engine`    | moteur temporel WebGPU                | domain                                |
| `config`    | validation d'environnement (Zod)      | rien                                  |

Les dépendances pointent **vers l'intérieur**. ESLint l'impose : `domain` ne
peut importer ni `@prisma/client`, ni `react`, ni `next`.

## Pièges de cette stack (vérifiés, pas supposés)

- **Prisma est épinglé en 7.10.0.** Le tag `latest` pointe sur `8.0.0-rc.15`.
  Ne pas « mettre à jour ».
- **TypeScript reste en 5.9.3.** `typescript-eslint` déclare
  `typescript: ">=4.8.4 <6.1.0"` : passer en 7 casse `pnpm lint`.
- **Prisma 7 n'accepte plus `url` dans le datasource** — c'est dans
  `packages/db/prisma.config.ts`, et le client passe par un driver adapter.
- **PostgreSQL 18** monte son volume sur `/var/lib/postgresql`, plus sur
  `/data`. Le conteneur refuse de démarrer autrement.
- **Images MinIO sur `quay.io`**, plus sur Docker Hub.
- **Postgres est sur le port 5434** : 5432 et 5433 sont pris par d'autres
  projets de cette machine.

## Raccourcis interdits

- `any`, `!` non justifié
- logique métier dans un composant React
- `db push` en production — les migrations font foi
- écrire une fenêtre JDN à la main : passer par `encodeDate` / `decodeDate`
- accepter une sortie d'IA sans revue humaine
- une barre de progression qui n'est pas adossée à du travail réel
