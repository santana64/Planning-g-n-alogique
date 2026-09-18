# État du projet

**Dernière mise à jour** : 2026-09-18
**Phase courante** : 9 (vues de profondeur) — éventail et constellation livrés ; Récit à suivre

Ce fichier est factuel. Rien n'y est marqué fait sans avoir été exécuté.

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

---

## En cours

Rien. Point de reprise propre.

---

## Reste à faire

| Phase | Contenu                                                           | État                          |
| ----- | ----------------------------------------------------------------- | ----------------------------- |
| 2     | Services CRUD personne / relation                                 | **fait**                      |
| 2     | Formulaires d'édition, liste, éditeur de liens                    | **fait**                      |
| 2     | Éditeur d'événements hors naissance / décès                       | **fait**                      |
| 3     | Import GEDCOM 7 + écran de revue                                  | **fait** — export sans bouton |
| 4     | Services de graphe (ancêtres, descendants, branches), recherche   | **fait** — sans doublons      |
| 5     | Moteur Chronolignée, Gantt, voyage temporel, « qui était vivant » | **fait**                      |
| 6     | Carte MapLibre, migrations                                        | **fait** — arcs au curseur    |
| 7     | Archives S3, visionneuse de documents                             | **fait** — sans visionneuse   |
| 8     | Pipeline IA, propositions, assistant                              | **fait** — texte seul         |
| 9     | Constellation, profondeur temporelle, mode Récit                  | **en cours** — reste le Récit |
| 10    | Collaboration, confidentialité des vivants                        | rédaction faite ; reste l'UI  |
| 11    | Durcissement production                                           | partiel                       |

Manques identifiés hors phases : détection de doublons, bouton d'export
GEDCOM, édition des coordonnées d'un lieu, lecture d'images par l'IA,
assistant de recherche, visionneuse de documents page à page.

---

## Décisions importantes

- **Prisma épinglé en 7.10.0** — `latest` = `8.0.0-rc.15` (RC). ADR 0002.
- **TypeScript 5.9.3, pas 7.0.2** — `typescript-eslint` exige `<6.1.0`. ADR 0002.
- **Node 22.15.1, pas 24 LTS** — seul runtime présent sur la machine.
- **PostgreSQL, pas Neo4j** — ADR 0001.
- **JDN comme axe canonique** — ADR 0003.
- **L'IA propose, l'humain valide** — ADR 0004.

## Hypothèses assumées

- Port PostgreSQL **5434** : 5432 et 5433 sont occupés par d'autres projets de
  cette machine (`reglo-reglo-db-1`, `revenue-operator-postgres`).
- Tolérance de `ABOUT` : ±5 ans. `ESTIMATED` : ±10 ans. `CALCULATED` : ±1 an.
  Décision produit, pas fait — modifiable dans `DEFAULT_ESTIMATION_POLICY`.
- Durée de vie maximale : 123 ans.
- Dates numériques lues **jour d'abord** (convention française), sauf quand les
  nombres lèvent l'ambiguïté.
- Calendrier hébraïque : conservé pour l'aller-retour GEDCOM, mais non converti
  en JDN. Ces dates n'ont pas de position temporelle plutôt qu'une position
  inventée.

## Points à surveiller

- **Modèle par défaut : `claude-opus-5`**, et non Fable 5.1, qui impose une
  rétention de 30 jours côté fournisseur — mauvais défaut pour des
  transcriptions qui nomment des vivants. Le `.env` local contient encore
  `claude-fable-5-1` (inutilisé tant que `AI_PROVIDER=fake`).
- Le fournisseur Anthropic n'a **jamais été appelé pour de vrai** dans ce
  projet : aucune clé n'est configurée. Son comportement est vérifié contre un
  client factice et contre les types du SDK installé (0.125.0). Le premier appel
  réel mérite d'être observé.
- Repli serveur en cas de refus activé (`fallbacks: 'default'`).

- **Contention du poste, pas du produit.** En parallèle maximale, la suite E2E
  échouait une fois sur trois : des attentes côté client expiraient à 30 s.
  Établi par mesure : aucune attente de verrou ni saturation côté PostgreSQL,
  console navigateur propre, et des requêtes **anonymes en lecture seule**
  expiraient aussi. Les exécutions saines durent 18 s, les contendues 1,8 min.
  Un seul processus `next start` ne sert pas huit navigateurs concurrents.
  Workers fixés à 1 en local, 2 en CI (avec reprises). Le nombre de workers ne
  change rien à ce que les tests vérifient.

- La suite E2E consomme désormais **1 inscription par exécution** (au lieu de 3) :
  le compte est créé dans `globalSetup`, avant tout worker. En le faisant dans
  `beforeAll`, chaque worker réécrivait le même fichier de session pendant
  qu'un autre le lisait.

- La suite E2E consommait **3 inscriptions par exécution**, contre un plafond de
  20 par heure et par IP. Enchaîner plus de six exécutions complètes dans
  l'heure fait échouer les tests authentifiés : c'est le rate-limit qui
  fonctionne, pas une régression. Attendre, ou viser un fichier précis.

- Un échec E2E observé **une fois sur environ huit exécutions complètes**, juste
  après une reconstruction : `waitForURL` expirait sur la première action
  serveur d'un `next start` froid. Budget porté de 15 à 30 s — l'assertion est
  inchangée. Six exécutions propres depuis, mais l'observation est trop mince
  pour affirmer que la cause est établie.

- L'image du worker pèse 929 Mo, dominée par le SDK AWS et les moteurs Prisma.
  Acceptable, pas optimal.
- L'export GEDCOM existe au niveau moteur et n'a pas encore de bouton dans
  l'interface.

- **Le chemin WebGPU n'a pas été vu à l'écran.** Dans le navigateur intégré,
  le rendu WebGPU est détecté et dessine (compteur d'images), mais le panneau
  masqué empêche la capture et la relecture d'un canevas WebGPU. Les E2E
  passent par WebGL 2 (Chromium headless n'a pas d'adaptateur WebGPU), et
  c'est ce chemin qui est vérifié au pixel. À regarder sur une vraie machine.
- Le module three.js pèse 919 Ko (248 Ko gzip), chargé seulement sur la
  constellation et seulement après la sonde des capacités.
- L'éventail et la constellation chargent le graphe entier de l'arbre à
  chaque requête, comme l'ascendance. Sans objet sur la démonstration ; à mesurer au-delà de
  quelques dizaines de milliers de personnes.
- Sourcer `.env` dans un shell exporte `NODE_ENV=development`, qui désactive
  la garde de déploiement. Pour la tester à la main, fixer
  `NODE_ENV=production` explicitement — constaté en la vérifiant.

- Les commandes Prisma bloquent sans TTY : préfixer par `CI=true`.
- `packages/db/generated` est ignoré par git ; `pnpm db:generate` est requis
  après un clone.
