# ADR 0002 — Versions épinglées contre le tag `latest`

**Statut** : accepté — 2026-09-15

## Contexte

Le cahier des charges impose « pas d'alpha, beta, canary ni RC ». Deux
dépendances majeures violent cette règle si on suit `latest`.

## Décision

### Prisma reste en 7.10.0

Vérifié au registre le 2026-09-15 :

```
prisma dist-tags: { latest: "8.0.0-rc.15", prev: "7.10.0", next: "8.0.0-rc.10" }
```

Le tag `latest` de Prisma pointe sur une **release candidate**, et le CLI
affiche une invitation à migrer vers elle. `@prisma/client` publie 7.10.0 en
stable. Les deux sont épinglés en 7.10.0 via le catalog pnpm.

### TypeScript reste en 5.9.3, pas 7.0.2

TypeScript 7.0.2 est bien une version stable (le tag `rc` est resté sur
7.0.1-rc). Ce n'est donc pas une question de stabilité mais d'écosystème :

```
typescript-eslint@8.70.0 peerDependencies:
  typescript: ">=4.8.4 <6.1.0"
```

TypeScript 7 est hors de la plage supportée par la chaîne de lint. Or `pnpm
lint` fait partie de la Definition of Done. Choisir TS 7 reviendrait à
abandonner le lint typé pour gagner de la vitesse de compilation sur un projet
qui n'a pas de problème de vitesse de compilation.

## Conséquences

- **Node 22.15.1 au lieu de 24 LTS** : c'est le runtime présent sur la machine,
  et installer un Node système demande des droits dont on ne dispose pas.
  `engines.node` vaut `>=22.15.1`. Next 16 et React 19 le supportent.
- Une réévaluation s'impose quand Prisma 8 sort en stable et quand
  `typescript-eslint` élargit sa plage. Grâce au catalog, chacun de ces
  changements se fait dans `pnpm-workspace.yaml` et nulle part ailleurs.

## Règle générale

Ne jamais faire confiance au tag `latest`. Vérifier `dist-tags` et les
`peerDependencies` avant d'épingler.
