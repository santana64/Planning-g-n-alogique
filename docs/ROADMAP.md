# Feuille de route

Ce qui existe est décrit dans les autres documents et vérifié dans
[PROJECT_STATUS.md](PROJECT_STATUS.md). Ce fichier liste **ce qui manque**, par
ordre d'importance pour un usage réel, avec ce qu'il faudrait faire.

## 1. Avant d'ouvrir l'application à quelqu'un d'autre

### Un fournisseur de courriel de production

Fait : l'envoi (`packages/mail`, SMTP), la confirmation d'adresse, le mot de
passe oublié, l'invitation envoyée, et Mailpit en développement comme en CI
([SECURITY.md](SECURITY.md)). Reste ce que ce dépôt ne peut pas se donner :
des identifiants SMTP réels, un domaine d'envoi, SPF/DKIM/DMARC, et la preuve
qu'un message arrive vraiment dans une boîte extérieure.

### Traduction : ce qui reste

Tous les écrans et tous les messages des actions serveur sont traduits
(1 095 clés). Restent trois textes qui ne sont pas des libellés mais de la
langue construite : le **récit généré**, qui demande une grammaire anglaise à
part entière et non une traduction phrase à phrase ; les **courriels**, qui
devraient partir dans la langue du destinataire (qu'on ne connaît pas encore au
moment d'une invitation) ; et les **termes de parenté**, dont l'anglais compte
autrement (« second cousin once removed »).

### Faire tourner la CI pour de vrai

Le dépôt n'a pas de remote : `.github/workflows/ci.yml` n'a jamais été exécuté
par GitHub. Ses étapes ont été rejouées localement dans un clone vierge et
passent ([TESTING.md](TESTING.md)), mais seule une exécution réelle le prouve.

## 2. Ce qu'un généalogiste attend et qui manque

### Doublons : ce qui reste

La recherche, l'écran de comparaison et la fusion existent
([GENEALOGY_RULES.md](GENEALOGY_RULES.md)). Restent : une recherche lancée
**automatiquement après un import** (aujourd'hui, c'est un clic), le
rapprochement **entre deux arbres** d'un même compte, le constat
`DUPLICATE_CANDIDATE` sur la fiche elle-même, et l'**annulation** d'une fusion
— la fiche retirée est effacée en douceur, donc techniquement récupérable,
mais aucun écran ne le propose.

### Recherche : ce qui reste

L'écran existe (anomalies, faits sans source, affirmations contestées, pistes
de recherche) et les règles de mariage et d'événements hors de la vie sont
écrites ([GENEALOGY_RULES.md](GENEALOGY_RULES.md)). Restent : l'attribution
d'une piste à un membre et une échéance (les colonnes existent), et le constat
`DUPLICATE_CANDIDATE` sur la fiche.

### Documents et photographies : ce qui reste

Faits : la visionneuse (zoom à la molette sous le pointeur, déplacement,
pincement, rotation, plein écran, clavier ; PDF dessinés page par page par
pdf.js dans le navigateur), la transcription à côté de l'image, l'album avec
envoi multiple, vignettes et aperçus sans métadonnées faits par le worker, et
l'identification manuelle des personnes par rectangle — **jamais de
reconnaissance faciale**. Restent : la surcouche des extractions d'IA sur la
page (les propositions n'ont pas encore de coordonnées), les liens
photographie ↔ événement (`event_media`), l'audio et la vidéo, et une
photographie dans la démonstration.

### Statistiques et tableau de bord : ce qui reste

Faits : la vue d'ensemble de chaque arbre (étendue, générations, ce qui attend
chaque rôle, dernières modifications) et l'écran Statistiques (naissances par
décennie, âge au décès, enfants par couple, durée de vie par siècle, âge au
premier mariage, prénoms, métiers, lieux, distance de migration, comparaison
« au même âge »). Restent : les comparaisons entre deux arbres et l'export des
chiffres.

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
