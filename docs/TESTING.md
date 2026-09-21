# Tests

Trois niveaux, trois contrats différents. Les chiffres ci-dessous sont ceux de
la dernière exécution complète (voir [PROJECT_STATUS.md](PROJECT_STATUS.md)).

| Niveau       | Quoi                                                       | Où                                                             | Combien                |
| ------------ | ---------------------------------------------------------- | -------------------------------------------------------------- | ---------------------- |
| Unitaire     | Pur, sans I/O : dates, règles, mises en page, formulations | `packages/*/src/**/*.test.ts`, `apps/*/src/`                   | **677** en 41 fichiers |
| Intégration  | Contre la vraie base, le vrai stockage, le vrai SMTP       | `packages/*/tests/*.integration.test.ts`, `apps/worker/tests/` | **208** en 18 fichiers |
| Bout en bout | Un navigateur, l'application construite, le worker         | `apps/web/e2e/*.spec.ts`                                       | **71** en 9 fichiers   |

```bash
pnpm test:unit          # < 5 s, à chaque sauvegarde
pnpm test:integration   # ~20 s, nécessite pnpm infra:up
pnpm test:e2e           # ~1 min, construit d'abord (pnpm build)
pnpm verify             # format + lint + types + unitaires — avant tout commit
```

## Unitaire

Le contrat : **aucune I/O, aucune horloge réelle imposée, aucun hasard non
semé**. Ce qui se teste ici est ce qui porte la valeur du produit : conversions
de calendriers, fenêtres de dates, logique trivaluée, invariants du graphe,
numérotations, permissions, règle de confidentialité, encodage GEDCOM, mises en
page, phrases du récit, accords grammaticaux français, messages d'historique.

Deux conventions apprises à la dure :

- un test peut vivre **à côté de sa source** ou sous `tests/` : les deux
  emplacements sont dans le motif Vitest, parce qu'un fichier de tests déposé
  au mauvais endroit était vert **parce qu'il ne s'exécutait jamais** ;
- dans un test unitaire d'`apps/web`, les imports se font en **chemin
  relatif** : l'alias `@/` n'est pas résolu hors de Next.

### Tests de propriétés (`fast-check`)

Là où un exemple ne prouve rien : aller-retour de l'analyseur de dates,
conversions de calendriers sur des milliers de tirages, invariants du graphe
(un ancêtre ne peut pas être son propre descendant), aller-retour GEDCOM,
déterminisme de la constellation (même image quel que soit l'ordre des
données), invariant de zoom de la caméra, encodage Windows-1252 de n'importe
quel nom Latin-1.

## Intégration

Le contrat : **la vraie base** (PostgreSQL 18 + PostGIS de `docker compose`),
le vrai stockage objet, sérialisé (les fichiers partagent une base). C'est là
que vivent les échecs intéressants : contraintes `CHECK`, coercition d'enum,
cache de durée de vie, CTE récursives, index trigrammes, transactions
d'import, purge d'un arbre, hachage d'invitation, URLs présignées.

Chaque test crée son propre arbre et le supprime à la fin ; la démonstration
reste intacte.

## Bout en bout (Playwright)

Contre **l'application construite** (`next start`), pas le serveur de
développement : une génération statique cassée, une variable manquante au
build, un bundle client qui n'hydrate pas ne se voient que là. Le **worker**
est démarré comme second serveur (sonde `/health`), parce qu'un import qui
n'est écrit par personne n'est pas un import.

| Fichier                       | Ce qu'il couvre                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `core-flows.spec.ts`          | Accueil, démonstration, recherche et palette, ascendance, descendance, éventail, constellation, récit, directeur, autorisations, inscription/connexion |
| `editing.spec.ts`             | Créer un arbre, une personne, un lien, un événement, une source, un document, une proposition d'IA, la confidentialité d'un vivant                     |
| `import.spec.ts`              | Import GEDCOM d'un fichier « ANSI » accentué, revue, écriture par le worker, refus d'un encodage illisible                                             |
| `collaboration.spec.ts`       | Invitation, rôles, historique, export, effacement de compte                                                                                            |
| `motion-and-keyboard.spec.ts` | Mouvement réduit (avec **et** sans la préférence), frise et invitation au clavier seul                                                                 |
| `stewardship-a11y.spec.ts`    | axe sur les écrans de gestion, et aucun défilement horizontal à 375 px                                                                                 |
| `operations.spec.ts`          | Sondes de santé, identifiant malformé → 404                                                                                                            |
| `mail.spec.ts`                | Confirmation d'adresse, renvoi du lien, mot de passe oublié, lien déjà utilisé — les messages sont lus dans Mailpit                                    |
| `responsive.spec.ts`          | Projet « mobile » (Pixel 7) : accueil, frise, tableau                                                                                                  |

Règles de la suite :

- **axe-core** (WCAG 2.1 A/AA) sur chaque écran important ; zéro violation
  tolérée.
- Une vérification « négative » accompagne chaque vérification d'absence : le
  test du mouvement réduit passe d'abord **sans** la préférence, sinon il
  passerait aussi sur une page où rien ne bouge.
- **Un seul worker en local**, deux en CI. Ce n'est pas une concession sur ce
  qui est vérifié : à huit navigateurs concurrents, un seul `next start` ne
  suit plus et des lectures anonymes expirent — mesuré, base sans contention.
- La suite consomme **environ six inscriptions** par exécution, contre un
  plafond de vingt par heure et par IP : au-delà de trois exécutions dans
  l'heure, les tests authentifiés échouent — c'est la limite de débit qui
  fonctionne, pas une régression.
- Chaque inscription **confirme son adresse** en lisant le message dans
  Mailpit, comme une personne le ferait : le lien de confirmation est donc
  exercé à chaque exécution.
- Après une exécution, les comptes et arbres de test (`@chronolignee.invalid`)
  se nettoient en SQL ; la démonstration n'est jamais touchée.

### Un test instable est un test qui dit quelque chose

Exemple réel de cette phase : un test de mariage échouait une fois sur
plusieurs dizaines. Cause trouvée en **ralentissant volontairement** la
navigation précédente : l'aide `addPerson` cliquait « Ajouter une personne »
puis saisissait sans attendre la nouvelle page, remplissait le formulaire
d'édition de la personne précédente (mêmes libellés), et envoyait le nouveau
formulaire vide. Corrigé dans l'aide, pas masqué par une reprise.

## Ce qui n'est pas testé automatiquement

- **Pas de comparaison d'images** : aucune capture de référence. Les dessins
  sont vérifiés par leur contenu (tableau équivalent, relecture de pixels pour
  la constellation), pas par une image qui casse à chaque changement de police.
- **Le chemin WebGPU** : les E2E tournent sur Chromium sans adaptateur WebGPU,
  donc c'est le repli WebGL 2 qui est vérifié au pixel.
- **Le fournisseur Anthropic réel** : testé contre un client simulé et les
  types du SDK ; aucun appel payant, en CI ni ailleurs.
- **La montée en charge** : mesurée par des bancs d'essai
  ([PERFORMANCE.md](PERFORMANCE.md)), pas par des assertions.

## Bancs d'essai

```bash
pnpm benchmark      # moteur : Gantt, constellation, audit, sur données synthétiques
pnpm benchmark:db   # base : chargement du graphe, recherche, carte, import, export
```

Les jeux synthétiques (`packages/genealogy/src/synthetic.ts`) sont
déterministes à partir d'une graine et façonnés comme des archives réelles
(fondateurs vers 1700, une génération tous les vingt-huit ans, dates précises,
approximatives ou absentes dans les proportions des registres).

## Intégration continue

`.github/workflows/ci.yml`, quatre travaux : **qualité** (format, lint, types,
unitaires), **intégration** (PostgreSQL + MinIO + Mailpit, migrations, contrôle
de dérive du schéma, seed, tests), **bout en bout** (PostgreSQL + Redis + MinIO

- Mailpit, build, Playwright, rapport archivé en cas d'échec), **images** (les
  deux images de production sont construites, jamais poussées).

`AI_PROVIDER=fake` pour tout le workflow, et le fournisseur payant est refusé
par le code quand `CI` est défini.

**Le dépôt n'a pas de remote : ce workflow n'a jamais tourné sur GitHub.** Ses
étapes ont été rejouées localement dans un clone vierge, contre une base et un
seau neufs, et passent toutes — c'est ainsi qu'ont été trouvés un client Prisma
jamais généré avant le seed, l'absence de stockage objet pour les E2E, un
service MinIO impossible à démarrer en service GitHub, et un contrôle de dérive
écrit avec des options que Prisma 7 a supprimées.

## La boucle avant de committer

1. `pnpm verify` (format, lint, types, unitaires) ;
2. `pnpm test:integration` si la base ou un service a bougé ;
3. `pnpm build` puis `pnpm test:e2e` si l'interface a bougé ;
4. nettoyer les données de test ;
5. mettre à jour la documentation et `PROJECT_STATUS.md` ;
6. commit.
