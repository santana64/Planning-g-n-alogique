# GEDCOM

Cible : **FamilySearch GEDCOM 7.0**, avec lecture des fichiers 5.5/5.5.1 que
les gens ont réellement. Code : `packages/gedcom/src/` (décodage, lexer,
parseur, mappeur, écriture), pipeline d'import dans
`apps/web/src/server/gedcom-import.ts` et `apps/worker/src/gedcom-import.ts`,
export dans `packages/db/src/repositories/gedcom-export.ts`.

Règle de conduite, partout : **ne jamais jeter**. Une balise non comprise, une
date illisible, un pointeur qui ne mène nulle part : chacun est signalé et
conservé. Un chercheur peut réparer une anomalie signalée ; il ne peut pas
réparer ce que l'importeur a supprimé sans le dire.

## Lire un fichier

```text
octets ─▶ decode.ts ─▶ lexer.ts ─▶ parser.ts ─▶ mapper.ts ─▶ plan (rien n'est écrit)
```

### 1. Encodage (`decode.ts`)

GEDCOM 7 est en UTF-8 ; les fichiers réels, souvent pas. Décoder de l'ANSEL ou
du « ANSI » comme de l'UTF-8 n'échoue pas : cela remplace chaque lettre
accentuée par `U+FFFD`, en silence, dans tous les noms du fichier.

Les octets décident, l'en-tête conseille :

| Cas                                                    | Lecture                                               |
| ------------------------------------------------------ | ----------------------------------------------------- |
| BOM UTF-8, UTF-16 (BOM ou motif d'octets nuls)         | ce que dit le BOM                                     |
| Contenu valide en UTF-8                                | UTF-8, quoi que déclare `CHAR`                        |
| Sinon, `CHAR ANSEL`                                    | ANSEL (accents remis **après** leur lettre, composés) |
| Sinon, `CHAR ANSI` / `ASCII` / `ISO-8859-1` / `CP1252` | Windows-1252                                          |
| Sinon, `CHAR MACINTOSH`                                | Mac Roman                                             |
| Sinon, `CHAR IBMPC` / `CP437` / `CP850`                | **refusé** : aucun décodeur fidèle ici                |
| Sinon (rien de déclaré, ou UTF-8 déclaré à tort)       | Windows-1252, **annoncé comme une supposition**       |

L'écran de revue affiche l'encodage retenu, ce que le fichier déclarait, et
quelques noms tels qu'ils seront écrits : le moyen le plus rapide de voir que
les accents sont bons avant d'importer.

### 2. Lexer

Une ligne GEDCOM est `niveau [@xref@] TAG [valeur]`. La grammaire est petite ;
ce qui est difficile, c'est que les fichiers la violent tout le temps — et un
importeur qui refuse un fichier de 40 Mo parce qu'une ligne est fautive a
échoué. Chaque problème est signalé **avec son numéro de ligne** et la lecture
continue : `BOM_REMOVED`, `EMPTY_LINE`, `INVALID_LEVEL`, `LEVEL_JUMP`,
`LONE_CONTINUATION`.

### 3. Parseur

Construit l'arbre des enregistrements. `CONT`/`CONC` sont repliés dans la
valeur du parent (détail de transport, pas de structure). **Les balises
inconnues sont conservées** dans l'arbre. Signalements : `ORPHAN_LINE`,
`DUPLICATE_XREF`, `NO_HEADER`, `NO_RECORDS`, `UNKNOWN_VERSION`.

### 4. Mappeur

Traduit en structures du domaine — un **plan**, jamais une écriture.

- **Noms** : `Jean /DUPONT/ Jr` découpé, `GIVN`/`SURN`/`NPFX`/`NSFX`/`NICK`/
  `SPFX` prioritaires quand ils existent ; la ligne d'origine est conservée,
  parce que notre découpage est une interprétation.
- **Événements** : 24 balises comprises (`BIRT`, `CHR`/`BAPM`, `DEAT`, `BURI`,
  `CREM`, `MARR`, `MARB`, `MARC`, `DIV`, `RESI`, `OCCU`, `EDUC`/`GRAD`,
  `EMIG`/`IMMI`, `NATU`, `CENS`, `PROB`, `WILL`, `RELI`/`CONF`/`ORDN`, `EVEN`).
- **Dates** : toute la grammaire GEDCOM, calendriers compris
  ([TEMPORAL_MODEL.md](TEMPORAL_MODEL.md)) ; illisible ⇒ conservée telle quelle
  et comptée (`UNPARSEABLE_DATE`).
- **Filiation** : `FAMC`/`PEDI` (`BIRTH` par défaut, `ADOPTED`, `FOSTER`,
  `STEP`, `SEALING`) ; une valeur inconnue devient `PARENT_UNKNOWN` — « il y a
  un lien, on ne sait pas lequel » est une phrase que le modèle sait dire, et
  la ramener à « biologique » serait une falsification discrète.
- **Lieux** : `PLAC`, coordonnées `MAP`/`LATI`/`LONG`.
- **Sources** : `SOUR`, `TITL`, `AUTH`, `PUBL`, `PAGE`, `QUAY`, `CALN`.
- Avertissements : `PERSON_WITHOUT_NAME`, `FAMILY_WITHOUT_MEMBERS`,
  `CHILD_IS_OWN_PARENT`, `SELF_UNION`, `UNION_DATES_REVERSED`,
  `DANGLING_POINTER`, `DUPLICATE_RELATIONSHIP`.
- La liste des **balises non interprétées** est remontée à la revue.

## Importer

```text
POST /api/trees/<arbre>/import          analyse : décode, lit, compte — n'écrit rien
        │  (la revue : comptes, encodage, aperçu des noms, avertissements, lignes fautives)
POST /api/trees/<arbre>/import/<job>    « analysé » → « en file », mise en file
worker                                   écrit en une transaction, progression réelle
GET  /api/trees/<arbre>/import/<job>    état : en file, en cours (x %), terminé, échoué
```

- **Rien n'est écrit avant que quelqu'un ait vu ce que contient le fichier.**
  L'analyse crée un travail d'import en essai (`isDryRun`), stocke le fichier
  d'origine tel quel, et rend les comptes : personnes, familles, événements,
  relations, lieux, sources, médias, dates illisibles.
- L'écriture est **une transaction** : tout ou rien. Un import à moitié écrit
  laisse des personnes sans parents et des mariages sans époux, sans que
  l'utilisateur puisse le voir ni l'annuler.
- Ce que la base refuserait (une personne unie à elle-même, un divorce daté
  avant le mariage, un lien en double) est **écarté d'avance et compté**, parce
  qu'une seule instruction refusée invalide toute la transaction PostgreSQL —
  et faisait perdre le fichier entier.
- Une **révision** par fichier (« Import GEDCOM : 4 personnes, 5 liens,
  6 événements »), pas dix-huit mille.
- Un import déjà appliqué ne peut pas l'être deux fois ; un travail déjà en
  file ou en cours non plus. Détail dans [ARCHITECTURE.md](ARCHITECTURE.md).
- Mesures : environ 27 s d'écriture pour 20 000 personnes
  ([PERFORMANCE.md](PERFORMANCE.md)).

## Exporter

`GET /api/trees/<arbre>/export` — **propriétaire et administrateurs
seulement** : le fichier contient toutes les personnes vivantes, sans
rédaction. Chaque export est inscrit à l'historique.

Le fichier est du GEDCOM 7.0, en UTF-8, lignes `CRLF`, `HEAD.SOUR CHRONOLIGNEE`.
Le point délicat est la reconstitution des familles : le modèle stocke des
relations orientées (c'est ce qui permet un père biologique **et** un père
adoptif), GEDCOM veut des enregistrements `FAM` avec `HUSB`, `WIFE`, `CHIL`.

- une famille est identifiée par l'**ensemble de ses parents** : deux enfants
  du même couple tiennent dans un seul enregistrement ;
- les enfants sont groupés **par type de filiation** : un enfant avec une mère
  biologique et un père adoptif appartient à deux familles, chacune écrivant
  son `PEDI` (`ADOPTED`, `FOSTER`, ou `OTHER` + `PHRASE` pour beau-parent,
  tutelle, inconnu) ;
- **seules les unions font des couples** : un lien de fratrie écrit en
  `HUSB`/`WIFE` mariait un frère et une sœur ; il sort en `ASSO` + `ROLE OTHER` ;
- un mariage sans événement daté sort en `MARR Y` (et `DIV Y`), sinon il se
  relisait en simple partenariat ;
- l'incertitude survit : `ABT 1877` se relit `ABOUT`, et une date que nous
  n'avons jamais comprise sort en **phrase de date** entre parenthèses, comme
  la spécification le prévoit.

L'aller-retour est testé type par type (propriétés et cas) : dates, filiations,
unions, sources.

## Limites connues

- **Les balises inconnues ne survivent pas à un aller-retour complet.** Elles
  sont conservées à la lecture et listées à la revue, mais la base ne les
  stocke pas : un export est écrit depuis le modèle, pas depuis le fichier.
  Le fichier d'origine reste téléchargeable tel quel.
- **Pas d'import de médias** : `OBJE` est compté, les fichiers ne sont pas
  récupérés.
- **Pas de détection de doublons à l'import** : le compte affiché vaut 0, la
  table existe, le calculateur reste à écrire ([ROADMAP](ROADMAP.md)).
- **Pas de reprise ni d'annulation** d'un import en cours : la transaction
  échoue ou réussit entièrement, et l'écran le dit.
- **Encodages DOS refusés** plutôt que mal lus (voir plus haut).
