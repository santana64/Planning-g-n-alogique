# État du projet

**Dernière mise à jour** : 2026-09-21
**Phase courante** : après la phase 11 — chantiers de la
[ROADMAP](ROADMAP.md). Dernier livré : la détection de doublons, l'écran de
comparaison et la fusion.

Ce fichier est factuel. Rien n'y est marqué fait sans avoir été exécuté.

| Section                 | Où                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| Terminé et vérifié      | ci-dessous, phase par phase                                                               |
| En cours                | [§ En cours](#en-cours)                                                                   |
| Reste à faire           | [§ Reste à faire](#reste-à-faire) et [ROADMAP.md](ROADMAP.md)                             |
| Problèmes connus        | [§ Points à surveiller](#points-à-surveiller)                                             |
| Constats de performance | [§ Constats de performance](#constats-de-performance) et [PERFORMANCE.md](PERFORMANCE.md) |
| Décisions importantes   | [§ Décisions importantes](#décisions-importantes)                                         |
| Prochaine action        | [§ Prochaine action](#prochaine-action)                                                   |

**Dernière exécution complète** (2026-09-21, poste de développement) :
format, lint, types **verts** ; **694** tests unitaires, **214** d'intégration,
**73** de bout en bout, tous verts ; `pnpm build` vert ; images Docker web et
worker construites ; la CI rejouée localement dans un clone vierge passe toutes
ses étapes, et le parcours d'installation du README rejoué à la lettre (base et
seau neufs) donne les 40 personnes de la démonstration.

---

## Terminé et vérifié

### Phase 0 — fondation du dépôt

| Élément                                           | Preuve                               |
| ------------------------------------------------- | ------------------------------------ |
| Monorepo pnpm, catalog de versions                | `pnpm install` passe, lockfile figé  |
| TypeScript strict + `noUncheckedIndexedAccess`    | `pnpm typecheck` passe               |
| ESLint 10 flat config + frontières d'architecture | `pnpm lint` passe, 0 warning         |
| Prettier                                          | `pnpm format:check` passe            |
| Docker Compose                                    | 3 services _healthy_                 |
| PostgreSQL 18.6 + PostGIS 3.6.4                   | interrogé en direct                  |
| Redis 8, MinIO (bucket privé)                     | `PING` / log d'init                  |
| Collation ICU `fr-FR`                             | `Lefebvre < Lefèvre < Lefort < Lévy` |
| UUIDv7 natif                                      | `uuidv7()` renvoie un id horodaté    |

### Phase 1 — modèle temporel et données

| Élément                                                  | Preuve                                  |
| -------------------------------------------------------- | --------------------------------------- |
| Conversions calendaires (grégorien, julien, républicain) | 16 tests, 4 ancrages historiques        |
| Modèle de date + logique trivaluée                       | 109 tests unitaires au total            |
| Parseur GEDCOM 7 + saisie naturelle FR/EN                | aller-retour prouvé par propriété       |
| Schéma Prisma, 31 tables                                 | migration appliquée                     |
| 14 contraintes CHECK                                     | chacune prouvée déclenchante            |
| 5 index trigram + 1 GiST spatial                         | listés dans `pg_indexes`                |
| Codec de dates base ↔ domaine                            | aller-retour prouvé, républicain inclus |

**Tests** : 109 unitaires + 23 d'intégration, tous verts.

### Phase 1 (suite) — application web et authentification

| Élément                                            | Preuve                                         |
| -------------------------------------------------- | ---------------------------------------------- |
| Next.js 16.3.5 + React 19.3, App Router, Turbopack | build de production vert                       |
| Tokens de design OKLCH, sombre par défaut          | inspecté dans les deux thèmes                  |
| Palette de branches (angle d'or, bandes réservées) | rendu vérifié                                  |
| Langage visuel de l'incertitude                    | pointillé, estompe et fondu visibles à l'écran |
| Scène d'ouverture (Gantt SVG animé)                | inspectée à 1440 px et 375 px                  |
| i18n next-intl, fr par défaut sans préfixe         | routes `/fr` et `/en` générées                 |
| CSP et en-têtes de sécurité                        | déclarés dans `next.config.ts`                 |
| Better Auth + adaptateur Prisma                    | inscription → session → base, vérifié          |
| Hachage du mot de passe                            | scrypt, 161 caractères en base                 |
| Limitation de débit                                | 5 tentatives puis HTTP 429, mesuré             |
| Cookies httpOnly préfixés                          | aucun cookie émis sur échec de connexion       |

**Tests** : 179 unitaires + 23 d'intégration, tous verts.

### Jeu de données et moteur temporel

| Élément                                             | Preuve                                        |
| --------------------------------------------------- | --------------------------------------------- |
| Famille de démonstration, 40 personnes, 1702-2026   | semée et interrogée                           |
| Date républicaine (4 germinal an VII)               | = 24 mars 1799, vérifié                       |
| Date illisible conservée + lecture humaine en claim | `9 br 1889` sans position, claim à 1889-11-09 |
| Sources contradictoires (1822 / 1823)               | les deux conservées, statuts distincts        |
| Implexe (mariage entre cousins)                     | 22 ancêtres par 30 chemins                    |
| Anomalie plantée (mère de 57 ans)                   | trouvée par l'audit, en avertissement         |
| PostGIS Tours → Buenos Aires                        | ~11 000 km géodésiques                        |
| Caméra temporelle, échelle, LOD, mise en page       | 237 tests unitaires                           |
| Gantt généalogique à l'écran                        | inspecté, interaction testée                  |
| Rédaction des personnes vivantes                    | 0 nom, 0 date dans la charge publique (HTTP)  |

**Tests** : 237 unitaires + 40 d'intégration.

### Voyage temporel et GEDCOM

| Élément                                 | Preuve                                                           |
| --------------------------------------- | ---------------------------------------------------------------- |
| Curseur temporel, états visuels         | inspecté ; événements postérieurs non dessinés                   |
| « Qui était vivant ? » trivalué         | 8 mai 1945 : 11 certains, 1 possible, 7 masqués — recoupé en SQL |
| Forme par intervalles ≡ forme par dates | propriété sur 1000 cas aléatoires                                |
| Lexer / parseur GEDCOM 7                | tolérant aux fichiers réels, ne jette jamais                     |
| Mappeur vers le domaine                 | pedigree, coordonnées, tags inconnus conservés                   |
| Écriture GEDCOM 7                       | familles réassemblées, `FAMS`/`FAMC` régénérés                   |
| Aller-retour sans perte                 | intervalles de dates identiques, `ABT` préservé                  |
| Import en base, transactionnel          | `FRENCH_R 4 GERM 7` → base → « 4 germinal an VII »               |

**Tests** : 292 unitaires + 49 d'intégration.

### Import, stockage et durcissement

| Élément                                      | Preuve                                             |
| -------------------------------------------- | -------------------------------------------------- |
| Écran de revue avant écriture                | analyse = 0 ligne en base, vérifié en HTTP         |
| Import complet (upload → revue → validation) | 4 personnes, 5 relations, 0 rejet                  |
| Rejeu d'un import déjà appliqué              | HTTP 409                                           |
| Stockage privé S3/MinIO                      | URL présignée OK, non signée refusée               |
| Validation par nombres magiques              | script renommé en `.png` refusé                    |
| CI GitHub Actions                            | 4 jobs : qualité, intégration, E2E, images         |
| Tests de bout en bout                        | **18**, dont contrôle axe                          |
| Contraste WCAG AA                            | corrigé dans les **deux** thèmes, mesuré           |
| Worker BullMQ                                | démarre, consomme, s'arrête proprement sur SIGTERM |
| Image web de production                      | 433 Mo, non-root, sert la démo depuis la base      |
| Image worker de production                   | 929 Mo, non-root, connectée à Redis                |

### Écriture manuelle (phase 2)

| Élément                                      | Preuve                                               |
| -------------------------------------------- | ---------------------------------------------------- |
| Création d'une personne                      | nom d'affichage à la française, `Jean DUPONT`        |
| Date saisie au clavier                       | parsée par le domaine, FR et GEDCOM                  |
| Date illisible conservée                     | `9 br 1889` gardé tel quel, aucune position inventée |
| Naissance stockée en événement               | aucune colonne `birthDate`, participant `PRINCIPAL`  |
| Cache de durée de vie rafraîchi à l'écriture | `lifespanEarliestJdn` renseigné dans la transaction  |
| Correction d'une date                        | l'ancien événement est archivé, pas écrasé           |
| Vivant masqué dès la création                | `privacy = REDACTED`, jamais public un seul instant  |
| Journal des révisions                        | seuls les champs modifiés, pas l'enregistrement      |
| Relation créant un cycle                     | refusée avant l'écriture (`RelationshipRefused`)     |
| Mère de 58 ans                               | acceptée, avertissement retourné                     |

### Interface d'édition (phase 2)

| Élément                                       | Preuve                                             |
| --------------------------------------------- | -------------------------------------------------- |
| Compte neuf → arbre → personne → lien → Gantt | parcours E2E complet, vert                         |
| Tableau de bord des arbres                    | liste les appartenances, crée un arbre privé       |
| Formulaire personne                           | dates en texte libre, noms multiples, surnom       |
| Date illisible saisie à la main               | `9 br 1889` conservé, marquée « date illisible »   |
| Éditeur de liens                              | sens demandé côté sujet, arête dirigée assemblée   |
| Recherche de personne dans l'éditeur          | interroge le serveur, repliement d'accents partagé |
| Lien créant un cycle                          | refusé, motif affiché                              |
| Mère de 57 ans                                | écrit, avertissement affiché, jamais bloquant      |
| Suppression                                   | nom à retaper, suppression douce                   |
| Autorisation                                  | revérifiée en base dans chaque action serveur      |
| Vivant vu d'un autre navigateur               | 404, ni nom ni année dans le HTML                  |

### Événements (phase 2, suite)

| Élément                          | Preuve                                                  |
| -------------------------------- | ------------------------------------------------------- |
| Événement à deux participants    | un mariage, une date, deux fiches — pas deux copies     |
| Lien d'union                     | **proposé** par le formulaire, jamais déduit en silence |
| Participant d'un autre arbre     | refusé                                                  |
| Baptême tenant lieu de naissance | déplace la durée de vie                                 |
| Baptême retiré                   | la durée de vie repart à vide                           |
| Date d'événement illisible       | conservée, certitude abaissée, événement gardé          |
| Effacer une date                 | l'efface vraiment ; l'ancien événement reste archivé    |
| Naissance / décès                | corrigés depuis la fiche, pas depuis deux écrans        |

### Ascendance (phase 4)

| Élément                            | Preuve                                                             |
| ---------------------------------- | ------------------------------------------------------------------ |
| Numérotation Sosa-Stradonitz       | sujet 1, père 2, mère 3 ; le sexe décide la case, pas l'ordre      |
| Implexe                            | Pierre et Victoire CHASSAGNE en 10/11 **et** 12/13, vérifié en SQL |
| Générations vides                  | affichées : c'est là que la recherche s'arrête                     |
| Complétude                         | compte des personnes, pas des cases                                |
| Filiation adoptive                 | hors numérotation Sosa, toujours visible dans les liens            |
| Parenté (cousin germain, issu de…) | code + nombres, accord grammatical testé                           |

### Recherche (phase 4)

| Élément                        | Preuve                                                        |
| ------------------------------ | ------------------------------------------------------------- |
| Similarité trigramme           | « chassaigne » trouve CHASSAIGNE **et** les CHASSAGNE         |
| Orthographe approchée annoncée | marquée « orthographe proche », jamais présentée comme exacte |
| Accents repliés des deux côtés | « lefevre » trouve LEFÈVRE, et l'inverse                      |
| Année dans la requête          | « chassagne 1901 » remonte Anne ; 1822 remonte Jean-Baptiste  |
| Année qui classe sans exclure  | l'acte décalé d'un an reste dans les résultats                |
| Cloisonnement par arbre        | vérifié avec un homonyme dans un second arbre                 |
| Palette ⌘K                     | ouverte, parcourue et validée au clavier seul                 |
| Vivants dans la palette        | jamais proposés à un visiteur extérieur                       |

### Descendance (phase 4)

| Élément                            | Preuve                                                 |
| ---------------------------------- | ------------------------------------------------------ |
| Numérotation d'Aboville            | 1, puis 1.1 / 1.2 / 1.3 dans l'ordre des naissances    |
| Enfant sans date                   | placé en dernier et marqué « rang non attesté »        |
| Enfant adopté                      | inclus — contrairement à Sosa, qui encode la filiation |
| Descendant par deux lignes         | garde ses deux numéros                                 |
| Comptage par génération            | des personnes, pas des positions                       |
| Total sur l'arbre de démonstration | 26 depuis Mathurin CHASSAGNE, vérifié en SQL           |
| Cycle échappé à la validation      | tronque au lieu de faire exploser la pile              |

### Carte (phase 6)

| Élément                      | Preuve                                                         |
| ---------------------------- | -------------------------------------------------------------- |
| Fond de carte sans clé d'API | Natural Earth 110m, domaine public, 229 ko servis par l'app    |
| Trajets géodésiques          | Le Havre → Buenos Aires passe par l'Atlantique, pas le Sahara  |
| Antiméridien                 | déroulé — pas de traînée horizontale                           |
| Séjour long                  | 3 actes à Tours = 0 déplacement, pas 2                         |
| Curseur temporel             | un lieu apparaît quand quelque chose y est enregistré          |
| Arc affiché à l'arrivée      | jamais pendant la traversée : on n'est pas sur deux continents |
| Démonstration                | 7 lieux, 8 déplacements, 1702–2018                             |
| Vivants                      | 7 trajets retenus et **annoncés**                              |
| Lieux sans coordonnées       | 3 comptés et annoncés, jamais omis en silence                  |
| Tableau accessible           | mêmes chiffres que la carte, comme la chronologie              |

### Archives (phase 7)

| Élément                              | Preuve                                                                |
| ------------------------------------ | --------------------------------------------------------------------- |
| Source distincte de la citation      | « Archives d'Indre-et-Loire » n'est pas une preuve, c'est un bâtiment |
| Cote conservée et mise en avant      | ce qui permet de redemander le document au dépôt                      |
| Citation rattachée à l'**événement** | un acte prouve un baptême, pas une vie entière                        |
| Transcription verbatim               | champ séparé, jamais une paraphrase                                   |
| Source d'un autre arbre              | refusée ; événement d'un autre arbre aussi                            |
| Taux de sourçage affiché             | le chiffre qui dit ce que vaut la recherche                           |
| Versement de document                | validé aux nombres magiques, pas à l'extension                        |
| Script renommé `.png`                | refusé, HTTP 415                                                      |
| Même fichier versé deux fois         | un seul document, annoncé comme doublon                               |
| Clé de stockage                      | générée par le serveur, jamais le nom de fichier                      |
| Téléchargement                       | URL présignée courte, autorisation revérifiée à chaque fois           |
| Document privé                       | REDACTED hors de l'arbre, RESTRICTED aux administrateurs              |

### Lecture assistée (phase 8)

| Élément                                | Preuve                                                               |
| -------------------------------------- | -------------------------------------------------------------------- |
| L'IA propose, l'humain décide          | proposition enregistrée : aucune affirmation, durée de vie inchangée |
| Lecture d'une transcription **citée**  | jamais de texte libre : toute proposition a une source et une cote   |
| Citation vérifiée mot pour mot         | paraphrase ou passage inventé écarté **et compté**                   |
| Confiance du modèle                    | affichée, jamais utilisée pour accepter ; pas d'« accepter tout »    |
| Acceptation                            | affirmation ACCEPTED + lien vers la citation + provenance IA         |
| Date acceptée                          | 1823 → 12 juin 1822 sur la chronologie **et** la fiche               |
| Désaccord événement / affirmation      | affiché, pas masqué                                                  |
| Nouvelle date acceptée                 | l'ancienne SUPERSEDED, jamais supprimée                              |
| Rejet                                  | conservé avec sa raison                                              |
| Nom inconnu de l'arbre                 | laissé non relié ; le relecteur choisit, rien n'est deviné           |
| Propositions sur un arbre public       | 404 pour un visiteur, lien absent                                    |
| Aucun appel payant en CI               | refus codé en dur, sans interrupteur                                 |
| Aucune donnée privée dans les journaux | ids, compteurs, durées ; chemins masqués dans pino                   |
| Fournisseur Anthropic                  | testé avec un client factice : requête, refus, troncature, erreurs   |

**Tests** : 457 unitaires + 160 d'intégration + 41 E2E.

### Éventail temporel (phase 9)

L'ascendance en éventail, dont le rayon est le **temps** et non la génération.

| Élément                            | Preuve                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------- |
| Rayon = années avant le sujet      | père né 34 ans avant Émile MOREAU (1884), lu dans le tableau            |
| Épaisseur = incertitude            | date exacte : un trait ; « vers 1702 » : « entre 176 et 187 ans »       |
| Borne ouverte (« avant 1750 »)     | la bande dépasse son bord connu au lieu d'en inventer un                |
| Ancêtre non daté                   | listé « naissance non datée », jamais placé — vérifié en E2E            |
| Sujet non daté                     | aucun éventail : sans point de départ, ce serait des générations        |
| Ancêtre né après le sujet          | dessiné en rouge et signalé, pas masqué                                 |
| Implexe                            | Mathurin CHASSAGNE dessiné à ses deux places                            |
| Vivant, vu de l'extérieur          | aucun éventail : le centre porterait son année ; aucun nom dans le HTML |
| Vivant dans une ascendance publiée | non placé : le rayon publierait son année de naissance                  |
| Noms sur les arcs                  | seulement s'ils tiennent entiers ; retournés dans la moitié basse       |
| Accessibilité                      | dessin masqué aux AT, légende + tableau lié ; axe sans violation        |
| Téléphone                          | noms masqués, années agrandies, aucun défilement horizontal             |
| Drapeau `temporalDepth`            | 404 et lien absent quand il est coupé                                   |

**Tests** : 483 unitaires + 160 d'intégration + 44 E2E.

### Constellation (phase 9)

La famille autour d'une personne, en points lumineux. Premier usage du moteur
WebGPU (three.js r186, `WebGPURenderer`, matériaux en TSL).

| Élément                     | Preuve                                                                           |
| --------------------------- | -------------------------------------------------------------------------------- |
| Disposition déterministe    | même image quel que soit l'ordre des données (propriété, 150 tirages)            |
| Distance = liens            | un anneau par lien ; jamais deux personnes au même angle d'un anneau (propriété) |
| Orientation                 | parents en haut, père à gauche comme Sosa ; fratrie de gauche à droite par âge   |
| Tous les liens              | seconde filiation, unions et boucles d'implexe, pas seulement le parcours        |
| Éclat = preuve              | part des événements de sa propre vie qu'une citation appuie                      |
| Témoin, parrain             | aucun crédit pour l'acte d'un autre (intégration)                                |
| Événement archivé, supprimé | exclu de la couverture (intégration)                                             |
| Magnitude                   | une étoile mieux sourcée est aussi plus grande : l'écart se voit                 |
| Profondeur                  | z = années depuis la naissance ; plans des siècles ; plage « vers » tracée       |
| Vivant, vu de l'extérieur   | point anonyme : ni nom, ni dates, ni couverture ; jamais placé en profondeur     |
| Ordre d'une fratrie         | calculé sans la date des vivants, qui le trahirait                               |
| WebGPU, sinon WebGL 2       | sonde de l'adaptateur ; rastériseur logiciel reconnu et servi en BASSE           |
| Qualité                     | AUTO / BASSE / MOYENNE / HAUTE / MAXIMALE ; baisse d'un cran si médiane > 22 ms  |
| Rendu à la demande          | aucune image dessinée tant que rien ne bouge                                     |
| Rendu vérifié au pixel      | canevas relu en WebGL 2 : ciel peint, étoiles et liens dessinés (E2E)            |
| Sans GPU                    | une phrase au-dessus de la même liste, jamais un rectangle noir (E2E)            |
| Accessibilité               | canevas masqué aux AT, liste par distance avec liens ; axe sans violation        |
| Recentrage                  | l'étendue est conservée ; les étoiles partent de la personne choisie             |
| Drapeau `constellation`     | 404 et onglet absent quand il est coupé                                          |

**Tests** : 538 unitaires + 167 d'intégration + 49 E2E.

### Récit — « Remonter la lignée » (phase 9)

Génération après génération vers le passé, sans une phrase qui ne vienne du
registre. Toujours disponible, sans drapeau.

| Élément                        | Preuve                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------- |
| Plan, puis phrases             | le planificateur ne produit que des références ; aucune phrase ne s'y écrit      |
| Trois lignées                  | paternelle, maternelle, la plus ancienne (jusqu'à la naissance la plus reculée)  |
| Père et mère                   | selon le sexe inscrit ; un parent de sexe non renseigné n'est ni l'un ni l'autre |
| Chaque phrase citée            | notes numérotées par chapitre ; « (sans source) » quand il n'y en a pas          |
| Âges                           | seulement si les deux naissances sont connues ; en fourchette sinon              |
| Contexte historique            | seulement si naissance **et** décès l'encadrent ; décès inconnu : rien           |
| Vague d'émigration             | rattachée seulement à qui a une migration enregistrée                            |
| Histoire ≠ archives familiales | aparté distinct, marqué « pas un fait tiré des archives de la famille »          |
| Déplacement                    | seulement entre deux lieux géolocalisés, à plus de 25 km                         |
| Baptême, inhumation            | dits comme tels, accordés ; « vers 1702 » affiché « v. 1702 »                    |
| Français                       | élision, dates républicaines (« le 4 germinal an VII »), pronom jamais deviné    |
| L'horloge ne fait que reculer  | un chapitre par génération, apartés sans effet sur l'année (E2E)                 |
| Fin de la lignée               | dit ce qui manque : « c'est là que la recherche continue »                       |
| Lecteur                        | `<dialog>` natif : Échap rend la main et le focus ; flèches ; lecture auto       |
| Focus initial                  | sur « Suivant », pas sur « Quitter » (E2E)                                       |
| Vivant, vu de l'extérieur      | aucun récit ; une lignée s'arrête avant un parent vivant, sans le nommer         |
| Données envoyées au navigateur | seulement les personnes citées par le plan, sans liens vers leurs parents        |
| Accessibilité                  | récit statique structuré, apartés en `aside` ; axe sans violation                |

**Tests** : 574 unitaires + 167 d'intégration + 53 E2E.

### Directeur de récits (phase 9, drapeau `storyDirector`)

Choisit **quoi** raconter ; le moteur du Récit décide **comment**. Désactivé
par défaut, activé pour les E2E.

| Élément                         | Preuve                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------- |
| Motifs trouvés dans les données | grand déplacement, lignée la plus profonde, vie documentée, 4 générations               |
| Déplacement                     | deux naissances géolocalisées à plus de 300 km ; un récit par route                     |
| Quatre générations              | quatre décès connus exigés : un décès inconnu n'est pas une longue vie                  |
| Personnes vivantes              | exclues de tout motif, **même pour les éditeurs**                                       |
| Sélection par règles            | affichée d'emblée, gratuite, rien n'est envoyé ; même choix à chaque fois               |
| Sélection par un modèle         | éditeurs seulement, sur demande, avertissement d'envoi externe                          |
| Ce que le modèle peut faire     | choisir parmi les candidats et ajouter une phrase — jamais écrire un récit              |
| Garde-fous                      | id inconnu, doublon, au-delà de la limite : écartés et comptés                          |
| Phrase du modèle                | écartée si elle contient un nombre absent du candidat ; étiquetée « modèle »            |
| Appel Anthropic                 | modèle principal à effort bas, sortie structurée, repli serveur ; client simulé en test |
| Géographie du contexte          | un événement limité à des pays ne s'attache qu'à qui y a un lieu enregistré             |
| Démonstration                   | « De Tours à Buenos Aires », 7 générations jusqu'en 1696, vie documentée                |

La sélection par un modèle n'est couverte que par des tests unitaires (client
simulé) : aucun E2E ne passe par le bouton, faute d'arbre éditable contenant
des candidats dans la suite.

**Tests** : 597 unitaires + 167 d'intégration + 54 E2E.

### Confidentialité (phase 10)

Une seule règle, dans `packages/domain/src/privacy` : chaque vue demande
« cette personne est-elle masquée pour ce lecteur ? » et n'efface que ses
propres champs ; aucune ne décide seule de masquer.

| Élément                      | Preuve                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| Réglage de la personne       | `RESTRICTED` : propriétaire et administrateurs ; `REDACTED` : membres ; `VISIBLE` : publié |
| Règle de l'arbre (`INHERIT`) | personne **présumée vivante** masquée aux non-membres si l'arbre le demande                |
| Présumée vivante             | vivante déclarée, ou sans décès enregistré et née il y a moins de 123 ans, ou non datée    |
| Décès enregistré             | événement décès/inhumation ou affirmation acceptée — jamais la borne déduite               |
| Libellé neutre               | « Personne protégée » : la raison du masquage est elle-même protégée                       |
| Recherche par nom            | liste et palette ne cherchent que parmi les noms lisibles : aucun résultat « protégé »     |
| Carte                        | une personne masquée ne compte ni dans les trajets, ni dans les totaux d'un lieu           |
| Frise                        | ligne masquée sans année, sans précision de date, sans « vivant » ; axe borné au visible   |
| Vues                         | ascendance, descendance, éventail, constellation, Récit, Directeur, frise, carte, fiches   |

**Tests** : 614 unitaires + 169 d'intégration + 54 E2E.

### Droits, partage, historique, RGPD (phase 10)

Une table de capacités dans `packages/domain/src/permissions`, lue par chaque
action serveur et chaque écran ; détail dans `docs/SECURITY.md`, et ce que
l'application fait des données personnelles dans `docs/PRIVACY.md`.

| Élément                   | Preuve                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| Rôles                     | propriétaire, administrateur, éditeur, contributeur (ajoute, ne retire jamais), lecteur          |
| Autorisation serveur      | `authoriseWrite(slug, capacité)` avant chaque écriture ; E2E : requête d'action rejouée, refusée |
| Garde par personne        | une action visant une personne restreinte échoue comme pour une personne inexistante             |
| Visibilité d'une fiche    | sélecteur ; publier (`VISIBLE`) et restreindre (`RESTRICTED`) réservés aux administrateurs       |
| Invitations               | lien à usage unique, 7 jours, une adresse, haché en base, révocable ; aucun courriel envoyé      |
| Adhésions                 | rôles inférieurs seulement pour un administrateur ; jamais d'arbre sans propriétaire (verrou)    |
| Historique                | arbre et fiche, en phrases (« a changé le rôle d'Émile : contributeur → lecteur »), filtré       |
| Membres dans l'historique | par compte, jamais par nom recopié ; « un ancien membre » une fois le compte effacé              |
| Réglages                  | nom, lecture (privé, par lien, public), vivants masqués aux visiteurs (avertissement)            |
| Export                    | GEDCOM 7 de tout l'arbre, propriétaire et administrateurs ; inscrit à l'historique               |
| Suppression d'arbre       | nom à taper ; hors d'usage à l'instant ; fichiers puis lignes purgés ; balayeur du worker        |
| Compte                    | export JSON ; effacement (connexion récente + adresse) ; bloqué par un arbre partagé orphelin    |
| Traitements IA            | fournisseur et envoi expliqués sur « Mon compte » et avant chaque envoi                          |

**Tests** : 648 unitaires + 200 d'intégration + 57 E2E.

### Durcissement (phase 11)

| Élément                              | Preuve                                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Mesures 100 → 20 000 personnes       | tableaux de `docs/PERFORMANCE.md`, jeux synthétiques déterministes                             |
| Cache du graphe par révision d'arbre | 0,6 s économisées par requête à 20 000 ; correct à plusieurs instances                         |
| Import écrit par le worker           | la requête n'écrit plus ; progression réelle (lignes écrites / à écrire), test d'intégration   |
| Redis indisponible                   | refus en 5,4 s, import remis à « analysé », reprise après retour — mesuré en arrêtant Redis    |
| Sondes de santé                      | `/api/health`, `/api/health/ready` (503 nommant la dépendance), worker `:3001/health`          |
| Images Docker                        | web et worker reconstruites, non-root ; conteneur worker **healthy** en 9 s                    |
| Traces OpenTelemetry                 | reçues par un collecteur OTLP local (`POST /v1/traces`)                                        |
| Rapports d'erreur                    | nettoyés (type + pile, ni requête, ni utilisateur, ni message), test unitaire                  |
| Journaux de file                     | une ligne structurée par coupure au lieu de 95 piles brutes                                    |
| Sauvegardes                          | `backup-db.sh` + `verify-backup.sh` : restauration réelle vérifiée, sauvegarde altérée refusée |
| Encodages GEDCOM                     | UTF-8/UTF-16/ANSEL/Windows-1252/Mac Roman lus, DOS refusé ; 10 tests dont une propriété        |
| Import GEDCOM de bout en bout        | fichier « ANSI » accentué → revue → worker → fiche → historique (E2E)                          |
| Mouvement réduit                     | E2E avec **et** sans la préférence (accueil, horloge du récit)                                 |
| Clavier                              | frise atteinte, focus visible à chaque arrêt, invitation créée puis annulée au clavier seul    |
| Accessibilité                        | axe sans violation sur les écrans de gestion et la revue d'import                              |
| Téléphone                            | aucun défilement horizontal sur les 11 écrans d'un arbre, à 375 px                             |
| Contrôle de dérive du schéma         | `pnpm db:drift` : aucune différence entre migrations et schéma                                 |
| Installation propre                  | clone vierge, base et seau neufs : install → generate → migrate → seed → tests → build → E2E   |
| Documentation                        | 17 documents dans `docs/`, écrits depuis le code et relus contre lui                           |

**Tests** : 677 unitaires + 208 d'intégration + 71 E2E.

### Courriel : confirmation, mot de passe oublié, invitations (après phase 11)

Le premier manque de la feuille de route : un mot de passe oublié enfermait
dehors le propriétaire de décennies de recherche.

| Élément                | Preuve                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| Paquet d'envoi         | `packages/mail` : interface, transport SMTP (nodemailer), trois messages ; 6 tests unitaires          |
| Envoi réel             | test d'intégration contre Mailpit : le message part, arrive, porte son lien en texte et en HTML       |
| Confirmation d'adresse | exigée dès qu'un transport existe ; lien 24 h, renvoyé sur demande et à toute connexion non confirmée |
| Mot de passe oublié    | lien à usage unique, 1 h ; réponse identique que l'adresse existe ou non ; lien déjà utilisé refusé   |
| Invitation             | envoyée à l'invité **et** affichée à l'invitant ; sujet et lien vérifiés dans Mailpit (E2E)           |
| Sans fournisseur       | `MAIL_TRANSPORT=none` : les deux écrans disparaissent (404), l'invitation repose sur son lien         |
| Échappement            | un arbre nommé `<script>` sort échappé dans la partie HTML (test)                                     |
| Journaux               | type du message et adresse masquée ; jamais le lien, jamais le jeton                                  |
| E2E                    | 3 tests lisant les messages dans Mailpit, et chaque inscription de la suite confirme son adresse      |
| Développement et CI    | Mailpit dans `docker-compose` et dans les deux travaux de CI qui en ont besoin                        |

### Doublons : recherche, comparaison, fusion (après phase 11)

Ce qu'un généalogiste rencontre dès son deuxième import, et la table qui
l'attendait depuis la phase 1.

| Élément            | Preuve                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Score              | `packages/genealogy/src/duplicates.ts` : huit signaux pondérés, quatre refus avant l'arithmétique ; 13 tests unitaires |
| Rapprochement      | trigrammes sur le nom normalisé, au plus 8 voisins par personne et 5 000 paires par passage                            |
| Recherche          | file `duplicate-scan`, un travail par arbre ; 2,9 s puis 2,6 s sur 20 000 personnes ([PERFORMANCE.md](PERFORMANCE.md)) |
| Base               | `scanDuplicates`, `mergePeople`, `openDuplicates`, `dismissDuplicate` ; 6 tests d'intégration contre la vraie base     |
| Écran              | liste expliquée signal par signal, comparaison côte à côte, fusion confirmée en deux temps                             |
| Autorisation       | la revue exige `contribute`, la fusion `delete` ; une paire nommant une personne masquée n'est pas affichée du tout    |
| Rien n'est arbitré | deux dates de naissance deviennent deux événements sur la fiche gardée ; la fiche retirée est effacée en douceur       |
| Historique         | révision `MERGE` : qui, quand, ce qui a bougé — phrase française dans l'historique de l'arbre                          |
| Démonstration      | le seed lance la vraie recherche : le doublon montré est celui que le produit trouve (96 %, cinq signaux)              |
| E2E                | 2 tests : recherche par le worker, père et fils écartés, paire rejetée, fusion, 404 pour qui ne peut pas écrire        |

**Tests** : 694 unitaires + 214 d'intégration + 73 E2E.

---

## Bugs réels trouvés et corrigés

1. **Années sextiles du calendrier républicain.** Implémentées d'abord comme
   IV, VIII, XII (réflexe grégorien) au lieu de III, VII, XI. Toute date
   postérieure à l'an III était décalée d'un jour. Attrapé par l'ancrage
   « 18 brumaire an VIII = 9 novembre 1799 ».

2. **Volume PostgreSQL 18.** Les images 18+ exigent un montage sur
   `/var/lib/postgresql`, plus sur `/var/lib/postgresql/data` ; le conteneur
   refusait de démarrer.

3. **Images MinIO.** `minio/minio` et `minio/mc` ne sont plus servies par
   Docker Hub — elles vivent sur `quay.io`.

4. **Antislash simple dans le matcher de locale.** `'\.'` dans une chaîne JS
   perd son antislash : le motif excluait « tout chemin contenant un caractère
   quelconque » au lieu de « contenant un point ». Aucune page n'aurait reçu de
   locale. Échec totalement silencieux, désormais couvert par un test.

5. **Dégradé SVG dégénéré.** Une `<line>` horizontale a une boîte englobante de
   hauteur nulle ; avec les unités `objectBoundingBox` par défaut, le trait
   disparaissait entièrement. Corrigé en `userSpaceOnUse`.

6. **`stroke-dasharray` CSS écrasant l'attribut SVG.** L'animation de tracé
   consommait le motif de tirets qui encode « date approximative ». Le
   dévoilement passe désormais par un `clipPath`.

7. **Implexe sous-déclaré.** Seul le premier nœud partagé était marqué. Or si
   un couple est doublé, toute son ascendance l'est aussi : la collapse était
   sous-estimée de la majeure partie de l'arbre. Remplacé par un calcul de
   multiplicité sur un ordre topologique.

8. **Graduations temporelles introuvables.** La recherche partait du pas le
   plus grossier ; 1850-1950 était gradué en millénaires, soit zéro trait.

9. **Fuite de rédaction par les marqueurs d'événements.** Le nom était masqué
   mais la naissance restait tracée sur l'axe — la date que la rédaction
   devait protéger. Même fuite par les liens de parenté et par la colonne
   « certitude ».

10. **Âge calculé par division.** 1700→1900 s'affichait « 199 ans ».

11. **`.partial()` de Zod conserve les valeurs par défaut — fuite de
    confidentialité.** Le schéma de mise à jour, dérivé du schéma de création,
    réappliquait donc `livingStatus: UNKNOWN` à chaque édition. La
    confidentialité suit le statut vivant : corriger le nom d'une personne
    vivante la rendait publique. Corrigé en séparant les champs nus des
    valeurs par défaut de création ; couvert par un test de régression.

12. **`diffFields` comparait à des colonnes non sélectionnées.** Un champ
    absent du `select` était lu comme une modification : chaque édition
    écrivait une révision citant des champs que personne n'avait touchés.

13. **Regex mutilée par Prettier.** La classe de caractères combinants,
    écrite en échappements Unicode, était réécrite en caractères littéraux —
    illisibles et fragiles. Remplacée par la propriété nommée `Diacritic`.

14. **Événements d'un vivant exposés.** Le nom était masqué, mais la liste de
    ses événements restait publiée. Vidée pour un visiteur extérieur.

15. **Impossible d'effacer un champ facultatif.** Une chaîne vide devenait
    `undefined` (« non fourni ») au lieu de `null` (« effacé ») : vider un
    surnom le laissait en place.

16. **Parent et enfant inversés dans les avertissements.** « Mère de 57 ans »
    nommait l'enfant. Les rôles sont désormais nommés et testés.

17. **Invalidation de cache trop large.** Un motif de route invalidait tous les
    arbres, puis le tableau de bord toute l'application. Chemins concrets, par
    locale.

18. **Tests unitaires jamais exécutés.** Les fichiers sous `tests/` échappaient
    au motif Vitest : verts parce qu'absents.

19. **Course à la création d'arbre.** Deux arbres homonymes créés ensemble se
    disputaient le même slug (P2002). Nouvelle tentative, testée à 4 en
    parallèle.

20. **Migration qui supprimait des index.** Les index trigramme et PostGIS,
    créés à la main, n'étaient pas déclarés : `migrate dev` générait leur
    suppression. Déclarés, migration corrigée, test de garde sur les 6 index.

21. **Garde de déploiement jamais appelée.** `assertDeployable` existait sans
    que rien l'invoque. Appelée au démarrage du web et du worker, avec sortie
    non nulle.

22. **Images Docker sans `packages/ai`.** Le build d'image aurait échoué. Test
    de garde comparant les manifestes du dépôt aux deux Dockerfiles, vérifié
    rouge sur l'état fautif.

23. **Fiche et chronologie en désaccord.** Après acceptation d'une date, la
    fiche lisait l'événement, la chronologie l'affirmation. Même projection
    pour les deux ; le désaccord est affiché.

24. **Liens de l'éventail non localisés.** Les ancres SVG brutes auraient
    renvoyé un visiteur anglophone vers la version française. Chemins résolus
    par `getPathname`.

25. **Liens imbriqués dans une image.** Un `role="img"` contenant des liens
    (axe `nested-interactive`), et jusqu'à 1 022 arrêts de tabulation à dix
    générations. Le dessin est masqué aux technologies d'assistance ; le
    tableau porte les liens.

26. **`process.exit` compilé pour Edge.** Avertissement à chaque build : le
    hook de démarrage est compilé pour tous les runtimes. La partie Node est
    importée dynamiquement derrière la vérification du runtime.

27. **Date corrigée encore présente dans le graphe.** Corriger une date
    archive l'ancien événement ; le cache de durée de vie l'excluait, mais pas
    le chargeur du graphe. L'éventail, l'ascendance et la validation pouvaient
    donc lire la date corrigée. Trouvé en relisant le chargeur pour la
    constellation ; test de régression rouge puis vert.

28. **Constellation vide au chargement.** three.js compile les pipelines en
    arrière-plan et saute sans rien dire un objet dont le pipeline n'est pas
    prêt. Avec un rendu à la demande, les premières images — vides — restaient
    à l'écran jusqu'au premier geste. Établi en relisant le framebuffer :
    zéro pixel, pas même la couleur du ciel. Compilation explicite, puis
    rendu continu le temps que tout soit prêt ; l'état « stabilisé » est
    exposé et attendu par les tests.

29. **Lien distingué par la seule couleur.** « Élargir » dans une phrase :
    contraste 1,36:1 avec le texte autour (axe `link-in-text-block`). Souligné.

30. **Le Récit faisait avancer l'horloge en remontant le temps.** Le contexte
    historique, raconté comme une scène à part, donnait 1884, 1914, 1850,
    1916… Vu à la relecture du rendu. Regroupé en chapitres par génération,
    le contexte en aparté ; testé.

31. **Vague d'émigration attachée à une femme restée à Tours.** Vrai mot pour
    mot, trompeur par juxtaposition. Un événement historique de catégorie
    migration ne concerne plus que qui a une migration enregistrée.

32. **Première Guerre mondiale attachée à un enfant de Buenos Aires.** Vrai
    (il avait 4 ans), sans rapport : l'événement ne touche que FR, DE, GB.
    Un événement limité à des pays exige désormais un lieu enregistré dans
    l'un d'eux ; sans lieu connu, rien n'est exclu faute de pouvoir juger.

33. **Focus initial du lecteur sur « Quitter ».** React ne rend pas
    l'attribut `autofocus` et le dialogue, monté fermé, ignore le `focus()`
    de montage : un Entrée réflexe refermait le récit. Focus donné après
    `showModal()` ; vérifié en E2E.

34. **Les vivants importés par GEDCOM n'étaient jamais masqués.** La
    rédaction ne regardait que le statut `LIVING` ; un import laisse presque
    tout le monde `UNKNOWN`. Une personne née en 1990 sans décès enregistré
    était publiée avec son nom et sa date. Désormais : présumée vivante tant
    qu'aucun décès n'est enregistré et qu'elle a pu vivre jusqu'à aujourd'hui.

35. **Le réglage de confidentialité d'une personne n'était lu nulle part.**
    `REDACTED` et `RESTRICTED` étaient stockés, jamais appliqués : seule la
    règle des vivants l'était. Appliqués par toutes les vues.

36. **Une recherche par nom révélait l'existence d'une personne masquée.**
    Liste (`?q=`) et palette renvoyaient une ligne « protégée » sous la
    recherche « valentina » — soit exactement ce que la protection cache. Les
    personnes masquées ne sont plus des résultats.

37. **Les totaux d'un lieu comptaient les personnes masquées.** Trajets
    retirés, mais une présence à Buenos Aires en 2010 étirait encore la
    période du lieu jusqu'à 2010. Totaux calculés sur le visible ; testé.

38. **La frise transmettait l'année de naissance d'une ligne masquée.** Nom
    et dates effacés, mais `lifespanLabel` (« 1962 – »), la précision des
    bornes et « Vivant » partaient dans la page : invisibles à l'écran,
    lisibles dans le code source. Trouvé en relisant ce que le rédacteur
    oubliait ; la liste des champs effacés est désormais testée champ par
    champ, et l'axe n'est plus borné par une personne masquée.

39. **Le libellé disait pourquoi quelqu'un était masqué.** « Personne
    vivante » apprend à un inconnu qu'un parent est en vie aujourd'hui.
    Libellé et messages neutres : « Personne protégée ».

40. **Enregistrer une fiche retirait les sources de sa naissance.** Le
    formulaire envoie les dates à chaque enregistrement, et le service
    archivait puis recréait l'événement de naissance ou de décès même
    inchangé : ses citations restaient sur l'archive. Corriger une note
    rendait une naissance sourcée « sans source ». Remplacé seulement quand la
    date ou le lieu changent ; un champ absent garde sa valeur ; testé.

41. **Un seul lien refusé faisait échouer tout un import GEDCOM.** Le
    commentaire promettait l'inverse, mais une instruction refusée invalide
    toute la transaction PostgreSQL (`25P02`) : un divorce daté avant le
    mariage perdait le fichier entier. Le mapper le signale à la revue et
    importe l'union sans ses dates ; le service écarte d'avance ce que la base
    refuserait. Même traitement pour une personne unie à elle-même.

42. **L'export GEDCOM perdait adoptions et placements, et mariait des frères
    et sœurs.** Aucun `PEDI` sous `FAMC` : une adoption relue devenait une
    naissance. Un lien frère/sœur devenait une famille HUSB/WIFE. Un mariage
    sans événement daté se relisait en simple partenariat. Filiation écrite
    (`ADOPTED`, `FOSTER`, `OTHER` + `PHRASE`), fratrie en `ASSO`, `MARR Y` ;
    aller-retour testé type par type.

43. **Un import ne laissait aucune trace dans l'historique.** Dix-huit mille
    personnes ajoutées sans auteur ni date. Une révision par fichier.

44. **Le sexe et le statut « vivant » d'une personne masquée partaient avec
    sa ligne.** « ♀ Personne protégée » dans la liste, `isLiving` dans les
    données du sélecteur de liens. Neutralisés.

45. **Supprimer une fiche affichait une page 404.** L'action revalidait la
    page de la personne supprimée avant que le client ne la quitte. Redirection
    côté serveur, dans la même réponse ; vérifié en E2E.

46. **Un contributeur pouvait supprimer.** Tout membre non lecteur passait le
    même contrôle « peut éditer ». Chaque action exige désormais sa capacité.

47. **Une fiche dont les dates se contredisent était refusée par la base.**
    Un décès antérieur à la naissance (ou un vivant né dans le futur)
    produisait une fenêtre inversée, refusée par la contrainte
    `people_lifespan_window_ordered` (23514) : la fiche ne pouvait pas être
    enregistrée, et un import entier échouait pour une faute de frappe. La
    fenêtre se réduit désormais à son premier jour, marquée contradictoire, et
    l'audit affiche l'erreur.

48. **L'import de 20 000 personnes ne finissait pas.** Écriture ligne à ligne
    (6,6 s pour 1 000), export quadratique, et le graphe entier relu à chaque
    requête. Écriture par lots (26,9 s pour 20 000), index dans l'export,
    cache du graphe par révision d'arbre.

49. **La navigation d'un arbre débordait sur téléphone.** Tous les écrans d'un
    arbre défilaient horizontalement à 375 px.

50. **La frise ne montrait pas où était le focus** (`outline-none` sur un
    conteneur `role="application"` focusable), et affichait son niveau de
    détail en anglais (« person », « event ») dans une interface française.

51. **Un identifiant malformé dans une adresse rendait une erreur 500** : la
    requête atteignait PostgreSQL, qui refuse un uuid invalide. Désormais 404,
    comme pour une page qui n'existe pas.

52. **Un fichier GEDCOM ancien perdait ses accents en silence.** Tout fichier
    était décodé en UTF-8 : un export 5.5.1 en « ANSI » (Windows-1252) ou en
    ANSEL importait « LEF�VRE » sans un mot. Les octets décident
    maintenant, l'en-tête conseille, et un encodage illisible est refusé.

53. **Le champ de fichier de l'import n'avait pas d'étiquette accessible.**

54. **Un contributeur se voyait proposer l'import** (palette, arbre vide, page)
    avant d'être refusé par le téléversement. Chaque entrée exige désormais le
    droit d'importer.

55. **L'index spatial GiST n'était pas déclaré dans le schéma Prisma** : le
    prochain `migrate dev` aurait écrit sa suppression — le même piège que les
    index trigrammes, trouvé en faisant enfin tourner le contrôle de dérive.

56. **La CI n'aurait pas pu passer.** Le dépôt n'a pas de remote, donc elle
    n'avait jamais tourné : client Prisma jamais généré avant le seed, aucun
    stockage objet pour les E2E, service MinIO impossible à démarrer sans
    commande, contrôle de dérive écrit avec des options supprimées par
    Prisma 7 — et pointé sur la base principale comme base fantôme, que Prisma
    vide.

57. **L'écriture d'un import tenait la requête HTTP** (~30 s à 20 000
    personnes), ce que le cahier des charges interdit. Passée au worker, avec
    une mise en file idempotente et l'état « terminé » écrit dans la même
    transaction que les données.

58. **Une coupure de Redis écrivait 95 piles d'erreurs brutes** hors du journal
    structuré (BullMQ les imprime lui-même faute d'écouteur).

59. **Un test E2E instable disait quelque chose.** L'aide `addPerson` cliquait
    « Ajouter une personne » puis saisissait sans attendre la nouvelle page :
    elle remplissait le formulaire d'édition de la personne précédente (mêmes
    libellés) et envoyait le nouveau formulaire vide. Reproduit en ralentissant
    la navigation précédente, corrigé dans l'aide.

60. **`daysInMonth` grégorien passait par `Date.UTC`**, qui lit les années
    0–99 comme 1900–1999 : février de l'an 0 (bissextile) comptait 28 jours.
    Calcul arithmétique, testé contre les conversions JDN sur quatre siècles.

61. **Parenté mal accordée** : « petit-nièce » au lieu de « petite-nièce », et
    « grand-grand-oncle » / « petit-petit-neveu » au lieu de
    « arrière-grand-oncle » / « arrière-petit-neveu ».

62. **L'image du worker plantait au démarrage** avec un `.env` de
    développement : `pino-pretty` est une dépendance de développement, absente
    de l'image.

63. **Treize dépendances déclarées n'étaient importées nulle part** (Radix ×10,
    Motion, Zustand, TanStack Query), et le script `lint` du paquet web
    appelait `next lint`, supprimé de Next 16.

64. **Une connexion abandonnée était journalisée comme une panne.** Quand un
    lecteur ferme l'onglet pendant qu'une page se rend, Next remonte
    « The destination stream closed early. » : une ligne d'erreur, et un
    rapport Sentry, pour l'impatience de quelqu'un. Reconnue et enregistrée en
    `debug`, jamais rapportée.

65. **Le tableau de bord n'avait pas de titre de niveau 1** : la page
    commençait en `h2`, et le nom du produit y tenait lieu de titre.

66. **Le nouveau paquet manquait dans les images Docker** — attrapé par le test
    de garde écrit après le même oubli en phase 8 : il compare les manifestes
    du dépôt aux deux Dockerfiles.

67. **Un identifiant de travail avec deux-points.** La recherche de doublons
    portait l'identifiant `scan:<arbre>` pour n'avoir qu'un passage par arbre.
    BullMQ compose ses clés Redis avec `:` et refuse un identifiant qui en
    contient — depuis l'intérieur de `add`, donc l'écran n'avait qu'une chose à
    dire : « le service de traitement ne répond pas ». Trouvé par le test de
    bout en bout, jamais par un test unitaire. Corrigé (`scan-<arbre>`), la
    règle est descendue dans `packages/jobs` avec son test, et l'échec réel est
    désormais journalisé au lieu d'être confondu avec une panne de Redis.

68. **Une page serveur important une fonction d'un module client.** Les
    libellés des signaux vivaient dans le composant de liste (`'use client'`) ;
    la page de comparaison, rendue sur le serveur, les appelait. Next refuse
    (« Attempted to call agreeingSignals() from the server ») et l'écran
    affichait « This page couldn't load ». Les libellés sont maintenant dans un
    module neutre, lisible des deux côtés.

69. **Une année de vie calculée avec une année moyenne.** La liste des doublons
    divisait le jour julien par 365,2425 : une personne née le 1er janvier 1840
    s'affichait « 1839 – ? », sur le seul écran dont le travail est de
    distinguer deux personnes par leurs dates. Vu à l'œil sur une capture, pas
    par un test. Passage par le calendrier (`jdnToGregorian`), fonction
    extraite et testée sur le Nouvel An.

70. **Le doublon de la démonstration ne s'expliquait pas.** Le seed écrivait
    l'explication à la main, dans une forme que plus aucun code ne produit
    (`score`/`detail`, un signal « occupation ») : l'écran lisait `value`, ne
    trouvait rien, et affichait « aucun signal net ». Le seed lance désormais
    la vraie recherche sur l'arbre qu'il vient de créer.

---

## En cours

Rien. Point de reprise propre : la phase 11 est terminée et committée.

---

## Reste à faire

| Phase | Contenu                                                       | État                                        |
| ----- | ------------------------------------------------------------- | ------------------------------------------- |
| 2     | CRUD personne / relation / événement, formulaires             | **fait**                                    |
| 3     | Import GEDCOM 7 + écran de revue                              | **fait** — écrit par le worker              |
| 4     | Graphe, ascendance, descendance, recherche                    | **fait**                                    |
| 5     | Moteur temporel, Gantt, voyage temporel, « qui était vivant » | **fait** — sans agrégation au zoom lointain |
| 6     | Carte MapLibre, migrations                                    | **fait** — arcs au curseur                  |
| 7     | Archives S3, documents, citations                             | **fait** — sans visionneuse                 |
| 8     | Pipeline IA, propositions, assistant                          | **fait** — texte seul, sans assistant       |
| 9     | Constellation, profondeur temporelle, Récit, Directeur        | **fait** — sans WebXR ni rivière            |
| 10    | Collaboration, confidentialité des vivants, RGPD              | **fait**                                    |
| 11    | Durcissement production                                       | **fait**                                    |

Ce qui manque, par ordre d'importance, avec le travail que cela demande :
[ROADMAP.md](ROADMAP.md). En tête : un fournisseur de courriel réel, la
traduction des écrans de l'application, une exécution réelle de la CI, l'écran
« Recherche », la visionneuse de documents.

---

## Constats de performance

Mesures complètes, méthode et matériel : [PERFORMANCE.md](PERFORMANCE.md).
L'essentiel, à 20 000 personnes, sur ce poste :

| Opération                            | Mesure                  |
| ------------------------------------ | ----------------------- |
| Chargement du graphe (première fois) | 631 ms                  |
| Recherche par nom (`pg_trgm`)        | 39 ms                   |
| Liste de personnes (page)            | 5,5 ms                  |
| Carte (lieux + trajets)              | 179 ms                  |
| Couverture des preuves               | 201 ms                  |
| Export GEDCOM complet                | 822 ms                  |
| Écriture d'un import                 | 26,9 s (dans le worker) |
| Mise en page du Gantt                | 37,9 ms                 |
| Mise en page de la constellation     | 61,5 ms                 |
| Audit de l'arbre entier              | 120 ms                  |
| Graphe en mémoire                    | 18,2 Mo                 |

Ce que les mesures ont changé : écriture d'import par lots, index dans
l'export, cache du graphe par révision, et la décision de **ne pas** ajouter de
moteur de recherche externe (PostgreSQL suffit largement).

---

## Décisions importantes

- **PostgreSQL, pas de base orientée graphe** — [ADR 0001](adr/0001-postgresql-instead-of-graph-database.md).
- **Prisma épinglé en 7.10.0** — `latest` = une version candidate 8. [ADR 0002](adr/0002-dependency-pins.md).
- **TypeScript 5.9.3, pas 7** — `typescript-eslint` exige `<6.1.0`. [ADR 0002](adr/0002-dependency-pins.md).
- **Le jour julien comme axe canonique** — [ADR 0003](adr/0003-julian-day-number-as-temporal-axis.md).
- **L'IA propose, l'humain valide** — [ADR 0004](adr/0004-ai-proposes-humans-approve.md).
- **Node 22.15.1, pas 24 LTS** — seul runtime présent sur la machine.
- **L'écriture d'un import va dans le worker**, l'analyse reste dans la
  requête : c'est l'analyse que l'utilisateur attend, pas l'écriture.
- **Pas d'ECS, pas d'ELK, pas de Graphology, pas de worker de mise en page** :
  les mises en page dédiées tiennent le budget mesuré ([ENGINE.md](ENGINE.md)).
- **Le catalogue ne contient que ce qui est importé** : treize dépendances
  déclarées mais jamais utilisées ont été retirées ([DEPENDENCIES.md](DEPENDENCIES.md)).

## Hypothèses assumées

- Port PostgreSQL **5434**, Redis **6380** : 5432, 5433 et 6379 sont occupés
  par d'autres projets de cette machine.
- Tolérance de `ABOUT` : ±5 ans. `ESTIMATED` : ±10 ans. `CALCULATED` : ±1 an.
  Décision produit, modifiable dans `DEFAULT_ESTIMATION_POLICY`.
- Durée de vie maximale : 123 ans.
- Dates numériques lues **jour d'abord** (convention française), sauf quand les
  nombres lèvent l'ambiguïté.
- Calendrier hébraïque : conservé pour l'aller-retour GEDCOM, non converti —
  ces dates n'ont pas de position plutôt qu'une position inventée.
- Un fichier GEDCOM sans encodage déclaré et invalide en UTF-8 est lu en
  Windows-1252, et la revue dit que c'est une supposition.

## Points à surveiller

### Fonctionnalités manquantes qui se voient

- **Le courriel de production reste à brancher** : l'envoi, la confirmation
  d'adresse, le mot de passe oublié et l'invitation fonctionnent contre Mailpit
  (développement, CI), mais aucun message n'a jamais atteint une boîte
  extérieure depuis ce dépôt : il y faut des identifiants SMTP, un domaine et
  SPF/DKIM/DMARC. Avec `MAIL_TRANSPORT=none`, les adresses ne sont pas
  vérifiées et une invitation repose sur son lien seul.
- **Les écrans de l'application ne sont pas traduits** : `/en` les sert en
  français (82 clés traduites couvrent l'accueil, l'authentification et
  quelques libellés).
- **Tables prêtes sans écran** : tâches de recherche, pages de documents,
  médias et identification sur photographie.

### Exploitation

- **La CI n'a jamais tourné sur GitHub** (pas de remote). Ses étapes sont
  rejouées localement dans un clone vierge, et passent.
- **Sans worker, un import reste « en file d'attente »** : l'écran le dit au
  bout de 15 s. Le web a besoin de Redis pour mettre en file.
- L'image du worker pèse 929 Mo (SDK AWS et moteurs Prisma) : acceptable, pas
  optimal.
- `packages/db/generated` est ignoré par git : `pnpm db:generate` après un
  clone. Les commandes Prisma bloquent sans TTY : les préfixer par `CI=true`.
- Sourcer `.env` dans un shell exporte `NODE_ENV=development`, ce qui désactive
  la garde de déploiement : pour la tester à la main, fixer `NODE_ENV=production`.
- Une migration reste à appliquer avant de déployer ce code :
  `20260919200000_import_job_result` (et `20260919140000_revision_export`).

### Tests

- La suite E2E consomme **environ six inscriptions** par exécution, contre un
  plafond de vingt par heure et par IP : au-delà de trois exécutions dans
  l'heure, les tests authentifiés échouent — c'est la limite de débit qui
  fonctionne. Chaque inscription confirme son adresse en lisant le message
  dans Mailpit, qui doit donc tourner (`pnpm infra:up`).
- **Un seul worker Playwright en local** (deux en CI) : à huit navigateurs
  concurrents, un seul `next start` ne suit plus, et des lectures anonymes
  expirent. Mesuré : aucune contention côté PostgreSQL.
- Après une exécution, nettoyer les comptes `@chronolignee.invalid` et leurs
  arbres (SQL dans [TESTING.md](TESTING.md)).

### IA

- **Modèle par défaut `claude-opus-5`**, et non Fable 5.1, qui impose une
  rétention de 30 jours côté fournisseur — mauvais défaut pour des
  transcriptions qui nomment des vivants.
- Le fournisseur Anthropic n'a **jamais été appelé pour de vrai** ici : aucune
  clé configurée. Vérifié contre un client simulé et les types du SDK 0.125.0.
  Le premier appel réel mérite d'être observé.

### Rendu

- **Le chemin WebGPU n'a pas été relu au pixel** : dans le navigateur intégré
  il est détecté et dessine, mais la capture d'un canevas WebGPU n'a pas
  abouti ; les E2E vérifient le repli WebGL 2.
- three.js pèse 919 Ko (248 Ko compressés), chargé seulement sur la
  constellation, après la sonde des capacités.
- L'éventail et la constellation chargent le graphe entier de l'arbre (comme
  l'ascendance) : sans objet sur la démonstration, à mesurer au-delà de
  quelques dizaines de milliers de personnes.

### Environnement de développement

- **Incident Docker Desktop (2026-09-19)** : démarrage impossible
  (`dockerInference … The file cannot be accessed by the system`). Réparé en
  renommant `%LOCALAPPDATA%\Docker\run`. Jamais « Reset to factory defaults »,
  qui efface les volumes.

---

## Prochaine action

**La traduction des écrans de l'application.** C'est le dernier point de la
§ 1 de [ROADMAP.md](ROADMAP.md) qui ne dépende de personne d'autre : 82 clés
sont traduites (accueil, authentification, libellés), mais les écrans d'un
arbre sont écrits en français dans les composants et `/en` les sert en
français. Le travail : extraire les chaînes vers les catalogues `next-intl`,
écran par écran, en commençant par la fiche, la liste et la frise — en gardant
le français comme langue par défaut, sans préfixe d'URL.

Deux choses ne dépendent pas du code et restent en attente : des identifiants
SMTP réels pour vérifier qu'un message sort bien de l'instance, et un dépôt
distant pour que la CI tourne ailleurs que localement.
