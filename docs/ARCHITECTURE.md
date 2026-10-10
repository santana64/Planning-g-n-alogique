# Architecture

Ce document décrit l'architecture **réellement en place**. Les écarts avec le
cahier des charges initial sont signalés comme tels ; ce qui reste à faire est
dans [`ROADMAP.md`](ROADMAP.md).

## Vue d'ensemble

```text
Navigateur ──HTTP──▶ apps/web (Next.js 16, App Router)
                        │  pages serveur, actions serveur, routes d'API
                        ├──▶ PostgreSQL 18 + PostGIS   (toutes les données)
                        ├──▶ Stockage S3 privé         (documents, fichiers importés)
                        └──▶ Redis ──▶ apps/worker     (écriture des imports GEDCOM)
                                          ├──▶ PostgreSQL
                                          └──▶ Stockage S3
```

Deux processus Node, un monorepo pnpm. Le web sert tout ce que l'on voit et
toutes les écritures courtes ; le worker fait ce qui ne tient pas dans une
requête (l'écriture d'un import) et le ménage (purge des arbres supprimés).

## Monorepo

| Paquet               | Rôle                                                                                       | Dépend de                         |
| -------------------- | ------------------------------------------------------------------------------------------ | --------------------------------- |
| `packages/domain`    | Dates généalogiques, calendriers, logique trivaluée, règle de confidentialité, permissions | rien (Zod)                        |
| `packages/genealogy` | Graphe en mémoire, validation, anomalies, Sosa, d'Aboville, parenté                        | domain                            |
| `packages/gedcom`    | Décodage, lexer, parseur, mappeur, écriture GEDCOM 7                                       | domain, genealogy                 |
| `packages/engine`    | Moteur temporel : caméra, échelle, niveaux de détail, mises en page, récits                | domain, genealogy                 |
| `packages/db`        | Schéma Prisma, migrations, codec de dates, services d'écriture, dépôts de lecture, seed    | domain, gedcom, genealogy         |
| `packages/ai`        | Fournisseurs d'IA (Anthropic, double de test), extraction vérifiée, choix de récits        | domain                            |
| `packages/storage`   | Client S3, clés d'objets, validation des fichiers                                          | —                                 |
| `packages/jobs`      | Noms de files, schémas de charge utile, politique de reprise                               | —                                 |
| `packages/mail`      | Envoi SMTP et les trois messages : confirmation, mot de passe oublié, invitation           | —                                 |
| `packages/config`    | Validation de l'environnement, garde de déploiement, nettoyage des rapports d'erreur       | —                                 |
| `packages/ui`        | Jetons de design, palette des branches, langage visuel de l'incertitude                    | —                                 |
| `apps/web`           | Interface et API                                                                           | tous les paquets                  |
| `apps/worker`        | Consommateur de la file, balayeur de purge                                                 | config, db, gedcom, jobs, storage |

**Les dépendances pointent vers l'intérieur** et ESLint l'impose
(`eslint.config.js`) : `domain` ne peut importer ni `db`, ni `ui`, ni
`engine`, ni React, ni Next, ni Prisma ; `genealogy` et `gedcom` ne peuvent
importer ni React, ni Next, ni `ui`. Les paquets publient leur source
TypeScript (pas d'étape de build) ; Next les transpile (`transpilePackages`).

Écart avec le cahier des charges : il n'y a ni `packages/maps` ni
`packages/testing`. La carte n'a pas de fournisseur de tuiles à abstraire (fond
de carte embarqué, voir [ENGINE.md](ENGINE.md)) et les aides de test vivent
près des tests ; créer ces paquets aurait été une abstraction sans usage.

## Le chemin d'une requête

### Lecture

```text
page serveur (app/[locale]/app/[treeSlug]/…/page.tsx)
  → server/<vue>.ts        accès, projection, rédaction des personnes protégées
  → @chronolignee/db       dépôts de lecture (SQL, CTE récursives, PostGIS)
  → PostgreSQL
```

- `server/access.ts` résout **à chaque requête** l'arbre, l'appartenance et le
  rôle depuis la base. Un visiteur anonyme ne lit qu'un arbre public ou
  partagé par lien.
- Les vues généalogiques (ascendance, descendance, éventail, constellation,
  frise, récit) partent de la **même projection** : le graphe de l'arbre,
  chargé une fois puis gardé dans un cache par processus
  (`server/graph-cache.ts`, 8 arbres, clé = révision de l'arbre + jour). Toute
  écriture incrémente `trees.revision` : un graphe périmé n'est jamais servi,
  même à plusieurs instances.
- La rédaction des personnes protégées suit **une seule règle**
  (`packages/domain/src/privacy`) appliquée par `server/redaction.ts` et par
  chaque vue ; détail dans [PRIVACY.md](PRIVACY.md).

### Écriture

```text
formulaire client
  → action serveur (server/*-actions.ts)
      authoriseWrite(slug, capacité)     rôle relu en base, garde par personne
      validation Zod                      packages/db/src/services/schemas.ts
  → service @chronolignee/db              une transaction, révision enregistrée
  → revalidation des chemins concernés
```

- Chaque écriture exige **sa** capacité (`contribute`, `delete`, `import`,
  `export`, `setPersonPrivacy`, `manageMembers`, `manageTree`, `deleteTree`)
  dans la table de `packages/domain/src/permissions`.
  L'interface masque ce qui est refusé, mais n'est jamais la barrière.
- Les services écrivent l'historique (`revisions`) dans la même transaction :
  champs modifiés seulement, auteur, résumé.
- Les téléversements, imports, exports et l'API d'authentification passent par
  des **routes d'API** (`app/api/…`) : corps multipart, réponses en
  téléchargement, codes HTTP explicites.

### Import GEDCOM

```text
POST /api/trees/<arbre>/import           analyse : décode, lit, compte — n'écrit rien dans l'arbre
POST /api/trees/<arbre>/import/<job>     « analysé » → « en file » (une seule fois), mise en file BullMQ
worker                                    « en file » → « en cours » → écrit (une transaction) → « terminé »
GET  /api/trees/<arbre>/import/<job>     état et progression réelle, interrogés chaque seconde par l'écran
```

Détail dans [GEDCOM.md](GEDCOM.md).

## Authentification et sessions

Better Auth 1.7, adaptateur Prisma, e-mail + mot de passe (12 caractères au
moins, hachage scrypt). Sessions en base, cookie `httpOnly`, `SameSite=Lax`,
`Secure` en production, préfixe `chronolignee`. Un cache de session signé de
5 minutes évite une lecture en base à chaque navigation (une révocation prend
donc effet en 5 minutes au plus). Limites de débit : connexion 5/min,
inscription 20/h par IP.

**Vérification d'adresse et mot de passe oublié** suivent la configuration du
courriel : dès qu'un transport SMTP est configuré, une adresse doit être
confirmée avant de servir, et un mot de passe se réinitialise par un lien à
usage unique valable une heure. Sans transport, les deux sont **absents** de
l'interface plutôt que cassés, et une invitation repose sur son lien. Modèle
de menace dans [SECURITY.md](SECURITY.md).

## Stockage des fichiers

Seau S3 privé (RustFS en local). Les clés sont générées par le serveur et
préfixées par arbre (`documents/<arbre>/…`, `imports/<arbre>/…`) — jamais le
nom de fichier de l'utilisateur. Les fichiers sont validés à leurs nombres
magiques (`file-type`), pas à leur extension. Le téléchargement passe par une
URL présignée courte (15 min par défaut), émise après une vérification des
droits à chaque demande. Les originaux ne sont jamais modifiés.

## File de travaux

Redis 8 + BullMQ. Deux files sont actives : `gedcom-import` (producteur : le
web, consommateur : le worker, un import à la fois, une seule tentative) et
`duplicate-scan` (une recherche par arbre à la fois : l'identifiant du travail
porte celui de l'arbre, donc un second clic pendant la recherche ne lance rien).
Les charges utiles sont validées par Zod à l'entrée de la file et à la sortie.
`packages/jobs` déclare aussi `document-analysis` et `media-derivatives` :
**aucun producteur ni consommateur** pour l'instant (voir
[ROADMAP](ROADMAP.md)).

## Internationalisation

next-intl : français par défaut, **sans préfixe** d'URL ; anglais sous `/en`.
Les catalogues (`apps/web/messages/`) comptent 1 095 clés dans les deux
langues, vérifiées clé pour clé et placeholder pour placeholder par un test
unitaire.

Tous les écrans sont traduits, ainsi que les messages que renvoient les actions
serveur (lus dans la langue de la requête). Trois choses ne le sont pas, et
l'interface le dit plutôt que de le cacher :

- **le récit généré** (`components/story/sentences.ts`) est une prose française
  construite à partir des fiches, avec ses accords ; sous `/en`, l'écran
  prévient que le récit lui-même est en français ;
- **les courriels** (`packages/mail`) partent en français, quelle que soit la
  langue de l'expéditeur ;
- **les termes de parenté** (`lib/kinship-messages.ts`) suivent l'usage
  français (« cousin issu de germain ») et n'ont pas encore d'écran.

Deux règles tenues partout : une phrase est **choisie** dans le code et
**écrite** dans le catalogue — le code ne concatène pas des fragments, parce
que deux langues ne mettent pas les mots dans le même ordre ; et ce qui
dépend de la langue (l'élision « d'Émile », la minuscule d'un rôle au milieu
d'une phrase) est traité comme tel, jamais supposé universel.

## Configuration

Toutes les variables sont validées au démarrage par Zod
(`packages/config`) ; `.env.example` les documente. En production, le web et le
worker **refusent de démarrer** avec une configuration dangereuse (APP_URL en
http, identifiants de développement, IA factice) — voir
[DEPLOYMENT.md](DEPLOYMENT.md). Les fonctions expérimentales passent par des
drapeaux (`FEATURE_*`) : `constellation` et `temporalDepth` actifs par défaut,
`storyDirector` inactif ; `river`, `webxr` et `reconstruction` sont déclarés
mais ne commandent aucune surface.

## Observabilité

Journaux JSON (pino), jamais de contenu privé ; traces OpenTelemetry
(`OTEL_ENABLED`) ; rapports d'erreurs Sentry optionnels et nettoyés
(`SENTRY_DSN`) ; sondes de santé pour le web et le worker. Détail dans
[DEPLOYMENT.md](DEPLOYMENT.md).

## Rendu

Les vues ne sont pas des arbres de composants React par personne : la frise est
un canevas 2D, l'éventail un SVG calculé, la constellation une scène three.js
(WebGPU, repli WebGL 2), la carte MapLibre. Chaque dessin est masqué aux
technologies d'assistance et doublé d'un tableau ou d'une liste HTML. Détail
dans [ENGINE.md](ENGINE.md).

## Décisions coûteuses à défaire

- [ADR 0001](adr/0001-postgresql-instead-of-graph-database.md) — PostgreSQL
  plutôt qu'une base orientée graphe.
- [ADR 0002](adr/0002-dependency-pins.md) — versions épinglées (Prisma 7,
  TypeScript 5.9).
- [ADR 0003](adr/0003-julian-day-number-as-temporal-axis.md) — le jour julien
  comme axe temporel.
- [ADR 0004](adr/0004-ai-proposes-humans-approve.md) — l'IA propose, l'humain
  valide.
