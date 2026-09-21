# Système de design

Direction : **histoire d'archives × interface temporelle cinématographique ×
instrument de recherche**. Pas un tableau de bord, pas un gabarit générique,
pas un site de généalogie de 2010. Une salle d'archives la nuit : fond bleu
nuit, texte ivoire, laiton de lampe de lecture.

Source de vérité : `packages/ui/src/tokens/tokens.css` (jetons),
`branch-palette.ts`, `certainty.ts` ; branchement Tailwind dans
`apps/web/src/app/globals.css` (`@theme inline`).

## Principes

1. **Des jetons sémantiques, jamais des valeurs brutes** dans les composants :
   `bg-surface-1`, `text-text-muted`, `border-border-subtle`, `text-accent`.
   Tailwind 4 n'est qu'un accès commode aux jetons.
2. **L'information passe par deux canaux** : couleur **et** forme (tirets,
   fondus, soulignés, icônes) — elle doit survivre aux niveaux de gris, au
   daltonisme et à un trait d'un pixel.
3. **Le mouvement porte une information** ou n'existe pas.
4. **Chaque dessin a son équivalent HTML.**
5. **Le sombre est la version de référence** ; le clair est complet et
   utilisable.

## Couleur (OKLCH)

OKLCH parce que ce produit encode du sens par la couleur (branche, certitude,
solidité d'une preuve) : deux teintes de même L et C se lisent comme d'égale
importance — exactement ce qu'une palette de branches doit affirmer.

| Jeton                                                         | Rôle                                                                 |
| ------------------------------------------------------------- | -------------------------------------------------------------------- |
| `--surface-0/1/2/3`, `--surface-floating`, `--surface-sunken` | fonds, du plus profond au plus élevé ; bleu-noir, pas gris neutre    |
| `--text-primary/secondary/muted/faint`                        | ivoire chaud ; `faint` réglé **par mesure** à 4,97:1 sur `surface-1` |
| `--border-subtle/default/strong`                              | filets                                                               |
| `--accent-primary` (+ `hover`, `muted`, `contrast`)           | **laiton d'archives** : « document » plutôt que « logiciel »         |
| `--accent-history`                                            | encre bleue passée : la couche historique, derrière la famille       |
| `--accent-source`                                             | vert-de-gris : sources, citations, affirmations acceptées            |
| `--accent-warning/danger/success/info`                        | états                                                                |
| `--certainty-exact/approximate/inferred/unknown`              | **rampe de clarté**, pas quatre teintes : survit au gris             |

Thème : le sombre est sur `:root` ; le clair s'applique par
`prefers-color-scheme: light` ou `data-theme="light"`. Il n'y a **pas de
bouton de thème** : c'est le système qui décide. Contraste WCAG AA mesuré dans
les deux thèmes (axe-core en E2E sur toutes les pages principales).

Exceptions assumées : la constellation (ciel nocturne) et le lecteur de récit
(plein écran de nuit) ont leur propre palette fixe, sombre quel que soit le
thème — ce sont des scènes, pas des pages.

## Palette des branches

`branchColor(index)` / `branchColorForKey(id)` :

- **clarté et chroma fixes**, seule la teinte varie — aucune branche ne paraît
  plus importante qu'une autre ;
- **teinte avancée de l'angle d'or** (137,5°) à chaque branche : pour tout
  nombre de branches, deux branches voisines tombent loin l'une de l'autre sur
  le cercle — diviser 360° par leur nombre donnerait un dégradé dès qu'elles
  sont nombreuses ;
- **bandes réservées** : le laiton de l'interface et le rouge du danger ne sont
  jamais attribués à une branche ;
- **déterministe** et, par clé, **stable** : ajouter une branche ne repeint pas
  les autres.

## Le langage visuel de l'incertitude

Une barre de vie ne peut pas être un simple rectangle : ses bords disent ce que
l'on sait d'eux (`EDGE_STYLES`) :

| Bord         | Couleur                   | Forme                          | Sens                                      |
| ------------ | ------------------------- | ------------------------------ | ----------------------------------------- |
| exact        | `--certainty-exact`       | trait net                      | date au jour                              |
| approximatif | `--certainty-approximate` | fondu court (12 %), tirets 3/2 | « vers », mois ou année seulement         |
| inféré       | `--certainty-inferred`    | fondu long (35 %), tirets 2/4  | borne des 123 ans, jamais une source      |
| inconnu      | `--certainty-unknown`     | se dissout (60 %), points      | aucune borne : la vie ne « s'arrête » pas |

« Qui était vivant » a ses propres styles (certain / possible / sans date), et
la frise estompe les lignes selon l'état au curseur
([TEMPORAL_MODEL.md](TEMPORAL_MODEL.md)).

## Typographie

Deux familles, une division du travail, chargées par `next/font` :

- **Inter** pour l'instrument : une grotesque neutre qui s'efface, avec les
  chiffres tabulaires qu'une colonne d'années exige (`.tabular`) ;
- **Source Serif 4** pour les personnes : noms, dates, récit
  (`.font-editorial`). La serif marque l'endroit où l'archive parle, pas le
  logiciel.

Échelle : `--text-2xs` (11 px) à `--text-4xl` (48 px), et `--text-display`
fluide pour l'accueil.

## Élévation, formes, mise en page

Sur un fond presque noir les ombres ne se voient pas : l'élévation est un liseré
clair en haut plus une ombre ambiante profonde (`--shadow-low/mid/high`). Rayons
`--radius-sm/md/lg/xl`. Largeur de contenu `--content-max` (82 rem). La page ne
défile **jamais** horizontalement ; un contenu large défile dans son propre
cadre (vérifié à 375 px sur chaque écran d'un arbre).

## Mouvement

| Jeton                  | Durée  | Usage                                           |
| ---------------------- | ------ | ----------------------------------------------- |
| `--duration-instant`   | 80 ms  | retour immédiat                                 |
| `--duration-fast`      | 140 ms | survols, tout ce qu'on déclenche souvent        |
| `--duration-normal`    | 240 ms | apparitions                                     |
| `--duration-slow`      | 420 ms | changement de scène d'un récit                  |
| `--duration-cinematic` | 900 ms | réservé aux trajets de caméra porteurs d'espace |

Courbes : `--ease-out`, `--ease-in-out`, `--ease-arrive` (léger dépassement pour
ce qui « arrive » — **jamais pour la caméra** : dépasser une position
temporelle suggère une date qui n'a jamais existé).

Ce qui bouge, et pourquoi : l'horloge du récit qui recule d'une génération à
l'autre (le temps qui passe), la caméra de la constellation (l'espace), la scène
d'accueil (une famille qui se forme). Rien ne flotte en permanence, pas de néon,
pas de flou.

**Mouvement réduit** (`prefers-reduced-motion`) : animations de l'accueil
coupées et contenu affiché d'emblée, scène du récit sans transition, année du
récit changée d'un coup, caméra de la constellation sans amortissement ni
trajet. Vérifié en E2E en comparant la même page avec et sans la préférence.

## Focus et clavier

`:focus-visible` : contour de 2 px à la couleur d'accent, décalé de 2 px — **jamais
retiré**. Là où un conteneur coupe ce qui dépasse (la frise), le contour passe à
l'intérieur. Les champs de formulaire marquent leur focus par la bordure. Lien
d'évitement vers le contenu principal. Parcours au clavier vérifiés en E2E :
chaque arrêt de tabulation montre son focus.

## Composants

Pas de bibliothèque de composants : des composants de l'application, en
Tailwind sur les jetons. `packages/ui` fournit les jetons, les palettes et `cn`
(`clsx` + `tailwind-merge`). Les dialogues sont des `<dialog>` natifs (piège de
focus, Échap et retour du focus fournis par le navigateur).

## Accessibilité

Cible WCAG 2.2 AA pour l'interface. En pratique, vérifié :

- axe-core (WCAG 2.1 A/AA) sans violation sur l'accueil, l'éventail temporel,
  la constellation, le récit, le directeur de récits, la revue d'import, la
  fiche d'une personne, le partage, l'historique, les réglages, le compte et
  l'invitation ;
- tout dessin (frise, éventail, constellation, carte) masqué aux technologies
  d'assistance et doublé d'un tableau ou d'une liste avec liens ;
- aucun lien distingué par la seule couleur dans un texte ;
- contrastes mesurés dans les deux thèmes.
