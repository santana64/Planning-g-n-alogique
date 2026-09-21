# Feuille de route

Ce qui existe est décrit dans les autres documents et vérifié dans
[PROJECT_STATUS.md](PROJECT_STATUS.md). Ce fichier liste **ce qui manque**, par
ordre d'importance pour un usage réel, avec ce qu'il faudrait faire.

## 1. Avant d'ouvrir l'application à quelqu'un d'autre

### Réinitialisation du mot de passe et vérification d'adresse

Aujourd'hui : ni l'une ni l'autre. Un mot de passe oublié enferme dehors le
propriétaire de décennies de recherche, et une invitation repose sur un lien à
usage unique parce qu'aucune adresse n'est vérifiée.

Il faut un **fournisseur de courriel** — donc des identifiants, que ce projet
ne peut pas se donner tout seul. Le travail : une abstraction d'envoi
(interface + transport SMTP + capture locale type MailPit dans
`docker-compose`), les écrans « mot de passe oublié » et « nouveau mot de
passe », `requireEmailVerification` activé, et l'envoi des invitations par
courriel en plus du lien. Le jeton ne doit jamais apparaître dans un journal.

### Traduction des écrans de l'application

Aujourd'hui : 82 clés traduites (accueil, authentification, libellés de
certitude, rôles, constats) ; **les écrans d'un arbre sont écrits en français
dans les composants**, et `/en` les sert en français. Le travail : extraire les
chaînes vers les catalogues `next-intl`, écran par écran, en commençant par la
fiche, la liste et la frise.

### Faire tourner la CI pour de vrai

Le dépôt n'a pas de remote : `.github/workflows/ci.yml` n'a jamais été exécuté
par GitHub. Ses étapes ont été rejouées localement dans un clone vierge et
passent ([TESTING.md](TESTING.md)), mais seule une exécution réelle le prouve.

## 2. Ce qu'un généalogiste attend et qui manque

### Détection de doublons et fusion

La table `duplicate_candidates` existe (score, explication, statut) ; **aucun
calculateur ne l'alimente** et il n'y a pas d'écran de fusion. Le travail : un
score déterministe (noms normalisés, chevauchement des périodes, lieux,
parents, conjoints, enfants, identifiants de source), une explication par
signal, un écran de comparaison côte à côte — **jamais de fusion automatique**.

### L'écran « Recherche »

`auditTree` calcule déjà cycles, anomalies et composantes déconnectées, et la
table `research_tasks` attend ses questions (hypothèse, dépôt, cote, période,
résultat, y compris « rien trouvé », qui est un résultat). Rien de tout cela
n'est affiché. Le travail : une page par arbre — anomalies, faits sans source,
affirmations contestées, tâches de recherche.

### Règles d'anomalie manquantes

Les codes existent, les messages aussi ; les règles ne sont pas écrites :
mariage avant la naissance, mariage après le décès, marié trop jeune,
événement hors de la durée de vie, affirmations acceptées contradictoires,
affirmation sans citation ([GENEALOGY_RULES.md](GENEALOGY_RULES.md)).

### Visionneuse de documents et photographies

Les tables sont prêtes (`document_pages`, `media`, `person_media_tags`,
`event_media`) ; aucun écran. Le travail : rendu des pages (pdfjs-dist),
vignettes (sharp) dans le worker, lecture plein écran avec zoom, identification
manuelle de personnes sur une photographie (régions normalisées, **jamais de
reconnaissance faciale**), et la surcouche des extractions d'IA sur la page.

### Statistiques et comparaisons

Aucune surface d'analyse : personnes par génération, durées de vie, âge au
mariage, taille des familles, prénoms, métiers, lieux, distances de migration,
part de personnes documentées. Et la comparaison « à l'âge X » du cahier des
charges (le père à 30 ans, le grand-père à 30 ans…). Tout doit dire qu'il
s'agit de l'arbre enregistré, pas d'une population.

### Tableau de bord d'un arbre

`/app` liste les arbres (nom, nombre de personnes, rôle). Il manque le résumé
par arbre : étendue temporelle, générations, propositions en attente,
anomalies, dernières modifications.

## 3. IA

- **Lire les images** : l'extraction est textuelle, un acte scanné doit être
  transcrit à la main. Il faut la chaîne complète dans le worker (file
  `document-analysis` déjà déclarée) : préparation de la page, requête vision,
  sortie structurée, vérification des passages, propositions.
- **Sortir l'extraction de la requête** : elle tourne aujourd'hui dans une
  action serveur (jusqu'à 120 s), comme l'import avant cette phase.
- **Assistant de recherche** : contradictions, questions à poser, plans de
  recherche — en disant toujours ce qui manque, sans jamais inventer une
  ascendance.
- **Premier appel réel** au fournisseur Anthropic : jamais fait ici, à observer
  ([AI.md](AI.md)).

## 4. Rendu et vues

- **Agrégation au zoom lointain** : les niveaux `CENTURY`, `BRANCH` et
  `GENERATION` décident déjà des libellés, des liens et des bandes, mais le
  dessin reste « une barre par personne » — il manque les masses de branches et
  les bandes de générations ([ENGINE.md](ENGINE.md)).
- **Mode Rivière**, **WebXR**, **reconstitutions** : drapeaux déclarés
  (`FEATURE_RIVER`, `FEATURE_WEBXR`, `FEATURE_RECONSTRUCTION`), aucune surface.
- **Scènes de récit** : le plan sait parler de personnes, de lieux et de
  contexte ; il manque les scènes « migration sur la carte », « document
  dévoilé », « photographie ».
- **Inspecteur de développement** : images par seconde, temps d'image,
  entités, appels de dessin, backend, préréglage — rien n'est affiché
  aujourd'hui, et c'est ce qui manque pour régler un rendu sans mesurer à la
  main.
- **Couche sonore** optionnelle : non commencée.
- **Chemin WebGPU vu à l'écran** : détecté et dessiné, jamais relu au pixel
  (les E2E passent par WebGL 2).

## 5. Données et échelle

- **Import au-delà de ~80 000 personnes** : une transaction unique bornée à
  120 s ; il faudra la découper ou relever la borne
  ([PERFORMANCE.md](PERFORMANCE.md)).
- **Export en flux** : tout le fichier est construit en mémoire.
- **Écritures en masse sous Docker Desktop** : ~5 500 lignes/s, à remesurer sur
  un PostgreSQL de production avant d'optimiser (suspect : les index GIN).
- **Connecteurs externes** (FamilySearch, archives publiques, autorités
  géographiques) : l'interface d'adaptateur n'est pas écrite ; rien ne doit
  devenir obligatoire, et aucun site ne sera moissonné contre ses conditions.
- **Géocodage** : `GEOCODER_PROVIDER` prévoit `nominatim`, l'adaptateur
  n'existe pas ; les coordonnées s'ajoutent à la main ou par import.

## 6. Exploitation

- **Sauvegardes planifiées** : les scripts existent et sont testés
  (restauration vérifiée, sauvegarde altérée refusée) ; il reste à les
  planifier, à répliquer le stockage objet et à fixer une rétention
  ([DEPLOYMENT.md](DEPLOYMENT.md)).
- **Traces et erreurs en conditions réelles** : vérifiées contre un collecteur
  OTLP local et un rapport Sentry construit en test, pas contre une
  installation de production.
- **Résilience réseau côté client** : pas de brouillon conservé localement, pas
  d'indicateur de connexion.
