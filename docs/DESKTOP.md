# Édition de bureau (Windows)

Chronolignée tout entier sur un seul ordinateur, sans serveur, sans Docker,
sans compte en ligne : un installeur `Chronolignee-Setup-<version>.exe`.

## Ce qui tourne

Electron lance, en processus enfants, uniquement sur la machine (`localhost`) :

| Pièce           | Édition serveur         | Édition de bureau                                   |
| --------------- | ----------------------- | --------------------------------------------------- |
| Base            | PostgreSQL 18 + PostGIS | les mêmes, binaires livrés avec l'app (EDB + OSGeo) |
| File de travail | Redis (BullMQ)          | PostgreSQL (`QUEUE_DRIVER=postgres`)                |
| Archives        | seau S3                 | dossier sur le disque (`STORAGE_DRIVER=filesystem`) |
| Worker          | conteneur               | processus enfant (imports, vignettes, doublons)     |
| Web             | conteneur Next.js       | serveur `standalone` de Next.js, fenêtre Electron   |
| IA, courriel    | configurables           | coupés (`AI_PROVIDER=none`, `MAIL_TRANSPORT=none`)  |

Au premier lancement : création du cluster PostgreSQL (mot de passe aléatoire),
migrations, famille de démonstration et ses illustrations. Les secrets
(base, sessions) sont générés à ce moment et gardés dans le profil ; rien
n'est inscrit dans l'installeur.

Les migrations sont appliquées sans le CLI Prisma
(`apps/worker/src/desktop/migrate.ts`), dans la table `_prisma_migrations`
avec les mêmes sommes de contrôle : une base créée par l'édition de bureau
est la même qu'une base migrée par Prisma.

## Installation et premier lancement

L'installeur ne contient que l'app et trois archives (`web.tar`, `worker.tar`,
`pgsql.tar`) : il s'installe en une quinzaine de secondes. Au premier
lancement, l'app les décompresse une fois (≈ 1 minute, avec un message dans
l'écran de démarrage) dans `%LOCALAPPDATA%\Chronolignée
untime\<version>` ;
les lancements suivants prennent quelques secondes. Une nouvelle version
décompresse les siennes et supprime celles de la précédente.

Écrire ces ~90 000 fichiers depuis l'installeur prenait des dizaines de
minutes (Windows Defender les analyse un par un) et laissait la fenêtre
« ne répond pas ».

## Où sont les données

`%APPDATA%\Chronolignée\` :

- `data\postgres\` — la base ;
- `data\archive\` — photos, documents, fichiers importés ;
- `logs\` — journaux (base, web, worker, démarrage — chaque lancement y est noté) ;
- `desktop.json` — ports et secrets locaux.

Désinstaller le programme **ne supprime pas** ce dossier : une archive de
famille ne disparaît pas avec un logiciel. Pour la sauvegarder, fermer
l'application et copier le dossier.

## Construire l'installeur

Sur Windows, depuis la racine du dépôt :

```bash
node apps/desktop/scripts/fetch-postgres.mjs
```

télécharge PostgreSQL 18.6 et PostGIS 3.6.2 (≈ 470 Mo), vérifie taille et
SHA-256, et prépare `../chronolignee-vendor/pgsql` (sans pgAdmin). Puis :

```bash
pnpm --filter @chronolignee/desktop dist
```

construit le web, déploie le worker à plat, copie PostgreSQL dans
`apps/desktop/stage/`, puis produit l'installeur dans `apps/desktop/release/`
(`scripts/package.mjs` : l'app décompressée, les serveurs copiés dedans —
electron-builder refuse de copier des `node_modules` —, puis l'installeur
NSIS construit à partir de ce dossier).

Pour essayer sans installer, après un `stage` :

```bash
pnpm --filter @chronolignee/desktop start
```

## Limites connues

- Windows x64 seulement ; l'installeur n'est pas signé (Windows SmartScreen
  avertira au premier lancement).
- Pas de mise à jour automatique : une nouvelle version s'installe par-dessus
  et migre la base au démarrage.
- Les comptes sont locaux ; sans courriel, pas de réinitialisation de mot de
  passe par message.
