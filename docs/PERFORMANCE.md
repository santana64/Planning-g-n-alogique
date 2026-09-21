# Performances

Des mesures, pas des intentions. Chaque chiffre ci-dessous vient d'une
exécution des bancs d'essai, sur la machine décrite. Les refaire après tout
changement qui touche au graphe, aux mises en page, à l'import ou à l'export.

```bash
pnpm benchmark      # moteur, en mémoire : 100 → 20 000 personnes
pnpm benchmark:db   # PostgreSQL : 1 000 → 20 000 personnes (pnpm infra:up d'abord)
```

`benchmark:db` écrit des arbres synthétiques puis les supprime : ne jamais le
lancer contre une base de production.

## Environnement des mesures

Node 22.15.1 · PostgreSQL 18.6 dans Docker Desktop (WSL 2) · Windows 11
(10.0.26200) · AMD Ryzen 5 PRO 5650G, 12 fils · 14 Go. Mesures du 2026-09-19.

## Jeux de données

`@chronolignee/genealogy/synthetic`, déterministe (graine fixe) : quelques
couples fondateurs vers 1700, une génération tous les 28 ans environ, 0 à 8
enfants par couple, 70 % des enfants mariés — la moitié avec quelqu'un d'une
autre famille de l'arbre (ascendances complètes, implexe), la moitié avec
quelqu'un de l'extérieur. Dates comme les registres les donnent : au jour
(55 %), au mois (15 %), « vers » (15 %), « entre » (7 %), à l'année (5 %),
absentes (3 %). À 20 000 personnes : 11 générations, une ascendance de 151
personnes, une descendance de 12 822.

## Moteur (en mémoire)

Médiane (pire) en millisecondes.

| Opération                         | 100          | 1 000       | 5 000       | 20 000        |
| --------------------------------- | ------------ | ----------- | ----------- | ------------- |
| Lecture des dates (naiss., décès) | 0,74 (1,51)  | 3,37 (5,02) | 23,4 (28,2) | 86,6 (97,5)   |
| Construction du graphe            | 0,04 (0,50)  | 0,19 (5,13) | 1,30 (2,92) | 18,1 (21,5)   |
| Ascendance complète               | 0,02 (0,28)  | 0,06 (0,28) | 0,03 (0,04) | 0,09 (0,87)   |
| Descendance complète              | 0,08 (0,34)  | 0,20 (0,58) | 2,19 (2,81) | 23,1 (24,7)   |
| Numérotation Sosa (12 gén.)       | 0,01 (0,02)  | 0,07 (0,29) | 0,09 (0,57) | 0,20 (0,24)   |
| Frise : mise en page              | 0,17 (0,39)  | 1,25 (2,12) | 6,55 (8,20) | 37,9 (39,8)   |
| Frise : liens                     | 0,03 (0,07)  | 0,17 (0,21) | 0,86 (1,20) | 5,79 (6,90)   |
| Qui était vivant (une date)       | 0,004        | 0,05 (0,12) | 0,06 (0,27) | 0,08 (0,98)   |
| Constellation (6 sauts, ≤ 2 000)  | 0,38 (0,91)  | 1,66 (3,51) | 9,91 (12,5) | 61,5 (86,0)   |
| Éventail temporel (10 gén.)       | 0,008 (0,01) | 0,03 (0,08) | 0,04 (0,10) | 0,18 (0,19)   |
| Audit de l'arbre (anomalies)      | 0,84 (1,30)  | 4,57 (6,39) | 23,7 (26,5) | 120,0 (129,9) |

Lecture : à 20 000 personnes, tout ce qui se calcule par vue tient sous
100 ms, et « qui était vivant », recalculé à chaque mouvement du curseur
temporel, sous la milliseconde. L'audit complet (120 ms) ne tourne que sur une
fiche à la fois dans l'interface (`auditPerson`).

## Base de données

Médiane (pire) en millisecondes ; les écritures sont mesurées une fois.

| Opération                          | 1 000     | 5 000     | 20 000    |
| ---------------------------------- | --------- | --------- | --------- |
| Chargement du graphe entier        | 117 (129) | 171 (224) | 631 (785) |
| Recherche par nom (trigrammes)     | 2,9 (3,6) | 10 (15)   | 39 (44)   |
| Liste : première page + total      | 1,3 (1,7) | 1,8 (2,1) | 5,5 (5,8) |
| Carte (lieux et trajets)           | 8,6 (9,7) | 41 (44)   | 179 (184) |
| Couverture des sources             | 3,0 (4,1) | 57 (59)   | 201 (207) |
| Export GEDCOM (lecture + écriture) | 88 (89)   | 262 (334) | 822 (939) |
| Import GEDCOM : lecture du fichier | 41        | 192       | 596       |
| Import GEDCOM : écriture           | 1 471     | 7 290     | 26 860    |

## Ce que les mesures ont changé

- **Le graphe est mis en cache par révision.** Chaque vue d'un arbre (frise,
  ascendance, descendance, éventail, constellation, récit, audit d'une fiche)
  commençait par le relire en entier : 0,6 s à chaque requête à 20 000
  personnes. `apps/web/src/server/graph-cache.ts` le garde par arbre, révision
  et jour ; toute écriture incrémente la révision dans sa transaction, donc un
  graphe périmé n'est jamais servi. Une requête suivante ne coûte plus qu'une
  lecture indexée.
- **L'import écrit par lots.** Écrit ligne à ligne, il prenait 6,6 s pour
  1 000 personnes, 36 s pour 5 000, et **n'aboutissait pas** à 20 000 (délai de
  transaction de 120 s dépassé : fichier perdu). Tout est désormais décidé en
  mémoire (identifiants UUIDv7, durées de vie, refus), puis écrit par
  `createMany` de 1 000 lignes : 1,5 s, 7,3 s et 27 s.
- **La recherche de doublons tourne dans le worker.** Comparer chacun à chacun
  est quadratique ; le rapprochement passe donc par l'index trigramme (au plus
  huit voisins par personne, 5 000 paires par passage) et le score se calcule
  en mémoire. Mesurée sur l'arbre de 20 000 personnes : **2,9 s puis 2,6 s**
  pour 5 000 paires examinées et 92 rapprochements trouvés. Trop long pour une
  requête HTTP — d'où la file — et la transaction est bornée à 30 s
  explicitement, le défaut de Prisma (5 s) coupant la requête au-delà de
  quelques milliers de personnes.
- **L'export ne cherche plus les familles de chaque personne dans toutes les
  familles.** Quadratique : 8,2 s à 20 000 personnes, 0,8 s avec des index.
- **PostgreSQL suffit pour la recherche** : 39 ms à 20 000 personnes avec
  `pg_trgm`. Pas d'Elasticsearch/OpenSearch (règle du projet : seulement si les
  mesures montrent PostgreSQL insuffisant).

## Limites connues

- **Écritures en masse lentes sous Docker Desktop** : environ 5 500 lignes/s.
  Suspect principal, non vérifié : la maintenance des index trigrammes (GIN)
  sur les noms. Sur un PostgreSQL de production (disque local, sans WSL), à
  remesurer avant d'optimiser.
- **L'import s'écrit dans le worker**, plus dans la requête HTTP (qui tenait
  ~30 s à 20 000 personnes) : la requête ne fait que l'analyse et la mise en
  file, l'écran suit la progression réelle (lignes écrites / lignes à écrire).
  Reste une transaction unique par fichier, bornée à 120 s : au-delà d'environ
  80 000 personnes au débit mesuré ici, il faudra la découper ou relever la
  borne — non mesuré.
- **Rendu** : la frise et la constellation adaptent leur niveau de détail et
  leur qualité (`packages/engine/src/render/quality.ts`, niveaux de détail de
  la frise), mais les images par seconde ne sont pas mesurées automatiquement ;
  la constellation est vérifiée au pixel en E2E, pas chronométrée.
- **Graphe par processus** : chaque instance garde son propre cache, 8 arbres
  au plus. Un graphe de 20 000 personnes occupe 18 Mo de tas V8 (mesuré avec
  `--expose-gc`), soit moins de 150 Mo dans le pire cas de huit grands arbres.
