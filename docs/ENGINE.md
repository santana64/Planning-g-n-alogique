# Moteur temporel et rendus

Le « moteur Chronolignée » est en deux moitiés :

- **`packages/engine`** — du calcul pur : caméra temporelle, échelle, niveaux
  de détail, mises en page, placement des noms, qualité graphique, plans de
  récit. Pas de DOM, pas de React, pas d'API graphique : tout se teste sans
  navigateur, et la même mise en page sert quel que soit le rendu.
- **les rendus**, dans `apps/web/src/components/` — un module par vue, qui
  prend une projection déjà calculée et la dessine. React pilote l'interface
  autour ; il ne dessine jamais une personne par composant.

```text
base ─▶ projection serveur (server/<vue>.ts, graphe en cache, rédaction)
     ─▶ instantané JSON ─▶ mise en page (packages/engine) ─▶ rendu ─▶ canevas / SVG / WebGL
                                                              └──▶ tableau HTML équivalent
```

## Écarts avec le cahier des charges

Le cahier des charges décrivait un monde ECS (bitECS) alimenté par des mises
en page ELK.js dans des Web Workers (Comlink), Graphology pour les algorithmes,
et un rendu WebGPU pour tout, frise comprise. Ce qui est en place est plus
simple, et mesuré :

- **Pas d'ECS, pas de worker de mise en page, pas d'ELK ni de Graphology.** Les
  mises en page sont des algorithmes dédiés et déterministes (un parcours pour
  la frise, un arbre radial pour la constellation, un éventail temporel), et
  elles tiennent dans le budget : 38 ms pour la frise de 20 000 personnes,
  62 ms pour une constellation ([PERFORMANCE.md](PERFORMANCE.md)). Les ajouter
  aurait été une complexité sans gain mesuré.
- **La frise est un canevas 2D**, pas WebGPU : elle dessine des barres, des
  traits et du texte, ce qu'un canevas 2D fait bien, partout, sans compilation
  de pipelines. Le rendu est une fonction pure, remplaçable sans toucher au
  reste.
- **WebGPU sert la constellation** (three.js r186, `WebGPURenderer`, matériaux
  TSL), avec repli WebGL 2 automatique.
- **Pas encore d'inspecteur graphique ni de HUD de performance**
  ([ROADMAP](ROADMAP.md)).

## `packages/engine`

| Module                    | Rôle                                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| `temporal/scale.ts`       | Jour julien ↔ pixel (linéaire en jours), géométrie d'une barre, graduations (millénaire → jour)          |
| `temporal/camera.ts`      | `TemporalCamera` : déplacement, zoom autour d'un point, ajustement à une période, limites, interpolation |
| `temporal/lod.ts`         | Niveau de détail selon les pixels par année                                                              |
| `layout/gantt.ts`         | Ordre des lignes de la frise et liens de parenté                                                         |
| `layout/temporal-fan.ts`  | L'ascendance en éventail dont le rayon est le temps                                                      |
| `layout/constellation.ts` | La famille autour d'une personne, en arbre radial déterministe                                           |
| `render/labels.ts`        | Quels noms afficher, par priorité, sans chevauchement                                                    |
| `render/quality.ts`       | Préréglages graphiques et choix automatique                                                              |
| `story/lineage.ts`        | Plan de « Remonter la lignée » : des références, jamais du texte                                         |
| `story/director.ts`       | Motifs dignes d'un récit, trouvés par règles dans les données acceptées                                  |

### La caméra

État pur et transitions pures : pas d'événement, pas d'image. L'invariant que
l'on sent : zoomer vers un point laisse **le jour sous ce point exactement à sa
place** (un demi-pixel d'erreur par cran, et une minute de défilement emporte
la vue ailleurs). `fitRange`, `goTo`, limites de zoom, `interpolateCamera` pour
les transitions.

### Niveaux de détail

| Niveau       | À partir de | Ce qui est dessiné                   |
| ------------ | ----------- | ------------------------------------ |
| `CENTURY`    | 0 px/an     | siècles et masses de branches        |
| `BRANCH`     | 0,25 px/an  | résumés de branches                  |
| `GENERATION` | 0,8 px/an   | bandes de générations                |
| `PERSON`     | 2,5 px/an   | une barre par vie                    |
| `EVENT`      | 14 px/an    | noms et événements                   |
| `DETAIL`     | 120 px/an   | tout, y compris sources et documents |

Les seuils sont en pixels par année, seule unité indépendante de l'écran et de
l'étendue des données. Une ligne de moins de 11 px ne porte pas de nom ; au-delà
de 400 personnes visibles, les noms sont retirés : un mur de noms superposés ne
se lit pas. La légende de la frise dit le niveau en cours, en français.

### Qualité graphique

`AUTO`, `LOW`, `MEDIUM`, `HIGH`, `ULTRA` (densité de pixels, anticrénelage,
halo, nombre de noms). `AUTO` part de ce qui se sait avant la première image :
rastériseur logiciel → `LOW` ; fenêtre de téléphone → `MEDIUM` ; WebGL 2 →
`HIGH` ; WebGPU → `ULTRA` sauf au-delà de 8 millions de pixels physiques. Puis
il regarde les images réellement dessinées et **descend d'un cran** si la
médiane de 30 images dépasse 22 ms ; il ne remonte jamais seul (une image qui
s'aiguise et se brouille selon la charge est pire qu'une image un cran
en dessous).

## Les rendus

### Frise — le Gantt généalogique

`timeline/timeline-canvas.tsx` (interaction) + `timeline/render-timeline.ts`
(dessin, fonction pure). Ordre de dessin : bandes historiques derrière la
famille, puis liens, puis barres, marqueurs d'événements, noms, ligne
« aujourd'hui » (pointillée) et curseur temporel (plein).

- **Lignes** : parcours en profondeur depuis les racines les plus anciennes,
  enfants par ordre de naissance — une famille reste contiguë, les liens
  restent courts et verticaux.
- **Incertitude** : chaque bord de barre dit ce que l'on sait de lui — exact :
  un trait net ; approximatif : fondu court et tirets ; inféré (règle des 123
  ans) : fondu long et pâle ; inconnu : la barre se dissout au lieu de s'arrêter
  (`packages/ui/src/tokens/certainty.ts`). Couleur **et** forme, pour survivre
  aux niveaux de gris et au daltonisme.
- **Interaction** : glisser pour se déplacer, molette pour faire défiler les
  lignes, Maj + molette pour zoomer vers le pointeur ; au clavier, flèches,
  `+`/`-`, Origine pour tout afficher (focus visible) ; survol pour les dates ;
  clic pour sélectionner et mettre en avant les proches.
- **Voyage temporel** : un jour choisi au curseur ou au calendrier ; chaque
  ligne prend l'un des états de [TEMPORAL_MODEL.md](TEMPORAL_MODEL.md) (à
  naître presque effacé, vivant plein, peut-être vivant à moitié, décédé en
  retrait) ; les événements postérieurs ne sont pas dessinés ; « qui était
  vivant » est recalculé à chaque image, dans le navigateur.
- Redessin à la demande (une image par changement), jamais en boucle.
- Le canevas est masqué aux technologies d'assistance ; **le même contenu est
  publié en tableau HTML**, proposé aussi sur téléphone, où une frise de la
  largeur d'un écran n'est pas un instrument de recherche.

### Éventail temporel

`fan/temporal-fan-chart.tsx` (SVG). Le rayon est **le temps** (années avant la
naissance du sujet), pas la génération : une lignée de générations longues
s'étire plus loin. L'épaisseur d'une bande est l'incertitude de la naissance
(un trait pour une date au jour, une bande large pour « vers 1750 », sans bord
extérieur pour « avant 1750 »). Un ancêtre sans date de naissance est listé,
**jamais placé**. Un ancêtre né après le sujet est dessiné en rouge et signalé.
Les noms ne sont écrits que s'ils tiennent entiers. Tableau lié.

### Constellation

`constellation/scene.ts` (module three.js sans React) +
`constellation-view.tsx`. Points lumineux instanciés (`PointsNodeMaterial`,
attributs d'instance en TSL), liens en segments, noms en HTML par-dessus
(nets, sélectionnables), placés par priorité.

- **Mise en page déterministe** : même image quelle que soit l'ordre des
  données. Distance au centre = nombre de liens ; chaque personne reçoit un
  secteur proportionnel à ce qu'elle porte ; parents en haut (père à gauche,
  comme Sosa), enfants en bas, fratrie de gauche à droite par âge. **Tous** les
  liens entre les personnes présentes sont tracés (seconde filiation, unions,
  boucles d'implexe).
- **Éclat = preuve** : la part des événements de sa propre vie qu'une citation
  appuie. **Profondeur temporelle** (drapeau `temporalDepth`) : z = années
  depuis la naissance, plans des siècles, plages « vers » tracées.
- **Capacités** : sonde de l'adaptateur WebGPU, repli WebGL 2, rastériseur
  logiciel reconnu et servi en `LOW` ; sans GPU, une phrase au-dessus de la même
  liste — jamais un rectangle noir.
- **Rendu à la demande** : aucune image tant que rien ne bouge. Piège évité :
  three.js compile les pipelines en arrière-plan et saute sans rien dire un
  objet pas prêt ; la scène compile explicitement puis redessine jusqu'à ce que
  tout soit prêt (état « stabilisé » exposé aux tests, rendu vérifié au pixel
  en E2E via WebGL 2).
- **Mouvement réduit** : pas d'amortissement de la caméra, transitions
  immédiates.
- Liste par distance, avec liens, pour les technologies d'assistance.

### Carte

`map/atlas-map.tsx` (MapLibre GL 6.9) + `atlas-view.tsx`. **Aucun fournisseur de
tuiles** : le fond est un contour Natural Earth 1:110 m, domaine public,
converti au build (`apps/web/scripts/build-basemap.mjs`) et servi par
l'application (229 Ko). Des tuiles de rue sous un baptême de 1830 suggéreraient
une précision que le registre n'a jamais eue — et une clé d'API de moins pour
une instance auto-hébergée.

Lieux géolocalisés, trajets géodésiques entre deux lieux successifs d'une vie
(Le Havre → Buenos Aires traverse l'Atlantique ; l'antiméridien est déroulé),
séjours au même lieu non comptés comme déplacements, curseur d'année (un lieu
apparaît quand quelque chose y est enregistré ; un trajet à son arrivée).
Lieux sans coordonnées comptés et annoncés. Tableau des mêmes chiffres.

### Récit et lecteur

« Remonter la lignée » (`story/`) : le plan (`packages/engine/src/story`) ne
contient que des références ; les phrases sont écrites ensuite, depuis le
registre, par `components/story/sentences.ts`, chacune avec ses sources. Le
lecteur est un `<dialog>` natif (Échap rend la main et le focus, flèches,
lecture automatique) ; entre deux chapitres l'année défile — le seul mouvement
qui porte une information — et change d'un coup en mouvement réduit.

### Scène d'ouverture

L'accueil (`landing/opening-timeline.tsx`) dessine en SVG animé quelques vies
qui apparaissent et se relient. Rien n'attend l'animation pour être utilisable,
tout s'affiche immobile en mouvement réduit, et sur téléphone le dessin garde
une largeur lisible (820 px au moins) dans un cadre qui défile plutôt que
d'écraser treize noms dans 375 pixels.

## Préparer la suite

La séparation données / mise en page / caméra / rendu est ce qui permettrait un
rendu WebXR, une frise WebGPU ou un rendu dans un worker sans réécrire le reste.
Aucun de ceux-là n'existe ([ROADMAP](ROADMAP.md)).
