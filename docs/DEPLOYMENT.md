# Déploiement

Ce que la production exige, et ce qui a été vérifié. Une archive familiale
peut représenter des décennies de travail : la perte de données n'est pas un
risque acceptable, et ce document commence donc par ce qui la prévient.

## Composants

| Composant      | Rôle                                                                       | Image / service                                         |
| -------------- | -------------------------------------------------------------------------- | ------------------------------------------------------- |
| Web            | Next.js : pages, actions serveur, routes d'API                             | `infra/docker/web.Dockerfile` (utilisateur non root)    |
| Worker         | Écriture des imports GEDCOM, purge des arbres supprimés                    | `infra/docker/worker.Dockerfile` (utilisateur non root) |
| PostgreSQL 18  | Toutes les données ; extensions `citext`, `pg_trgm`, `postgis`, `unaccent` | géré ou `postgis/postgis:18-3.6`                        |
| Redis          | File des imports, du web vers le worker                                    | Redis 8                                                 |
| Stockage objet | Documents numérisés, fichiers GEDCOM importés                              | S3 ou compatible (RustFS en local)                      |
| Courriel       | Confirmation d'adresse, mot de passe oublié, invitations                   | SMTP (Mailpit en local)                                 |

```bash
docker build -f infra/docker/web.Dockerfile -t chronolignee-web .
docker build -f infra/docker/worker.Dockerfile -t chronolignee-worker .
```

Construites depuis la racine du dépôt (monorepo). Aucune valeur secrète n'est
écrite dans une image : les valeurs de construction sont des substituts, les
vraies arrivent par l'environnement du conteneur.

## Configuration

Toutes les variables sont validées au démarrage (`packages/config`), et
documentées dans `.env.example`. Les secrets viennent de l'environnement ou du
gestionnaire de secrets de la plateforme, jamais d'un fichier versionné.

Le serveur **refuse de démarrer** en production (`NODE_ENV=production`, adresse
publique) avec :

- une `APP_URL` en `http://` (cookies d'authentification `Secure`) ;
- les identifiants de développement de la base ou du stockage ;
- `AI_PROVIDER=fake` (le double de test).

Il sort alors avec un code non nul, pour que le déploiement échoue là où on le
voit, au lieu de servir des 500.

**Courriel** : `MAIL_TRANSPORT=smtp` avec `SMTP_URL`
(`smtp://utilisateur:motdepasse@hôte:port`, ou `smtps://` pour le port 465) et
`MAIL_FROM`. Avec `none`, l'instance ne peut pas envoyer : la vérification
d'adresse et la réinitialisation du mot de passe **disparaissent** de
l'interface (elles ne sont pas cassées, elles sont absentes) et une invitation
repose sur son lien. Vérifier après déploiement qu'un message part réellement :
un mot de passe oublié est le moment le plus mauvais pour découvrir que SMTP
était mal configuré.

`BETTER_AUTH_SECRET` : 32 octets aléatoires au moins, un par environnement
(`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`).

## Base de données : migrations

```bash
pnpm db:migrate:deploy   # avant chaque mise en service d'une nouvelle version
```

- Uniquement des migrations versionnées (`packages/db/prisma/migrations`),
  jamais `prisma db push`.
- La CI vérifie l'absence d'écart entre le schéma et les migrations.
- Appliquer la migration **avant** de basculer le trafic sur la nouvelle
  version. Règle d'écriture : une migration doit rester compatible avec la
  version précédente pendant la bascule — ajouter d'abord, supprimer dans une
  version suivante.
- Les données de démonstration (`pnpm db:seed`) ne vont jamais en production.

## Santé

| Point                         | Question                                       | Usage                          |
| ----------------------------- | ---------------------------------------------- | ------------------------------ |
| `/api/health`                 | Le processus web répond-il ?                   | vivacité, `HEALTHCHECK` Docker |
| `/api/health/ready`           | La base et le stockage répondent-ils (≤ 3 s) ? | disponibilité, routage         |
| worker `:3001/health` (image) | Le consommateur de la file tourne-t-il ?       | vivacité, `HEALTHCHECK` Docker |

Le worker ne sert rien d'autre en HTTP ; son port de santé n'existe que si
`WORKER_HEALTH_PORT` est défini (l'image fixe 3001).

`/api/health/ready` répond 503 en disant quelle dépendance manque, sans hôte
ni message d'erreur. Ne pas le brancher sur les redémarrages : une panne de la
base ferait redémarrer tous les conteneurs web en boucle.

## Observabilité

- **Journaux** : JSON (pino) sur la sortie standard, à collecter par la
  plateforme. Jamais de mot de passe, jeton, session, transcription, nom ou
  date d'une personne ; une erreur n'y laisse que sa classe, avec la route (en
  motif, jamais l'URL) et le `digest` que Next affiche à l'utilisateur.
- **Traces** : `OTEL_ENABLED=true` et `OTEL_EXPORTER_OTLP_ENDPOINT` (collecteur
  OTLP/HTTP). Vérifié contre un collecteur local : les traces de requêtes
  arrivent sur `/v1/traces`.
- **File** : une connexion Redis perdue est journalisée une fois, puis au plus
  une fois par minute avec le nombre de tentatives tues — pas une pile par
  reconnexion.
- **Erreurs** : `SENTRY_DSN` active les rapports d'erreurs du web et du
  worker. Seuls partent le type de l'erreur et sa pile : ni requête, ni
  utilisateur, ni fil d'Ariane, ni message (un message de base de données peut
  citer une valeur). Voir `packages/config/src/error-report.ts` et son test.

## Mise à l'échelle

- Web : sans état hors du cache du graphe (par processus, clé = révision de
  l'arbre, donc correct à plusieurs instances). L'adhésion et le rôle sont
  relus en base à chaque requête ; la session est gardée 5 minutes dans un
  cookie signé (révocation effective en 5 minutes au plus).
- Worker : **indispensable aux imports**. Le web analyse le fichier dans la
  requête (lecture, revue, rien n'est écrit), puis met l'écriture en file ;
  sans worker, un import reste « en file d'attente » et l'écran le dit. Un
  import à la fois (une transaction longue par fichier, ~30 s pour 20 000
  personnes, `docs/PERFORMANCE.md`). L'état « terminé » est écrit dans la même
  transaction que les données, et seul un import réellement en file est
  écrit : une double livraison par la file n'écrit qu'une fois.
- Web : a besoin de Redis pour mettre un import en file ; s'il ne répond pas
  en 5 s, l'import revient à l'état « analysé » et l'écran propose de
  réessayer.
- Le balayeur du worker termine toutes les 15 minutes les purges d'arbres
  supprimés restées inachevées ; plusieurs workers peuvent tourner, la purge
  est idempotente.

## Sauvegardes

### PostgreSQL

- **Quotidien, au minimum** : `infra/scripts/backup-db.sh` — dump au format
  personnalisé et son SHA-256. Conserver les dumps hors du disque de la base,
  dans un autre compte ou une autre région (ex. un bucket en verrouillage
  d'objets), avec une rétention d'au moins 30 jours.
- **Point de restauration dans le temps** : sur un PostgreSQL géré, activer
  l'archivage continu (WAL / PITR) ; le dump quotidien reste la copie
  indépendante du fournisseur.

### Stockage objet

- **Versionnement activé** sur le bucket : un objet écrasé ou supprimé par
  erreur reste récupérable pendant la durée de rétention.
- **Réplication** vers un second bucket (autre région ou autre fournisseur),
  par la réplication native du fournisseur ou une copie planifiée
  (`aws s3 sync`, `rclone sync`).
- Les clés sont préfixées par arbre (`documents/<arbre>/…`) : la suppression
  d'un arbre efface ses objets, et la politique de rétention du versionnement
  fixe le délai au-delà duquel ils ont réellement disparu — à régler selon les
  engagements RGPD pris envers les utilisateurs.

### Tester la restauration

Une sauvegarde qui n'a jamais été restaurée est un espoir. Au moins une fois
par mois, et après chaque changement de version majeure de PostgreSQL :

```bash
infra/scripts/verify-backup.sh backups/chronolignee-….dump
```

Le script vérifie la somme SHA-256, restaure le dump dans une base jetable,
compare le nombre de lignes de treize tables avec la base vivante et supprime
la base jetable ; il sort en erreur à la moindre différence. Vérifié en local
(sauvegarde réelle restaurée, extensions comprises) et contre une sauvegarde
volontairement altérée, refusée. Pour le stockage objet, restaurer un
échantillon de documents depuis la réplique et comparer leur empreinte
(`documents.checksum`).

Les deux scripts fonctionnent avec les outils PostgreSQL de l'hôte
(`DATABASE_URL`) ou ceux du conteneur local (`PG_CONTAINER=chronolignee-postgres`).
