# ADR 0003 — Le Julian Day Number comme axe temporel canonique

**Statut** : accepté — 2026-09-15

## Contexte

Il faut une représentation canonique des dates qui serve à la fois au tri, à
l'arithmétique d'intervalles, au rendu et à l'export GEDCOM.

## Décision

Toute date se résout en une fenêtre `[earliest, latest]` de **Julian Day
Numbers** (entiers). `Date` de JavaScript n'apparaît nulle part dans le modèle
canonique — uniquement au bord de la présentation.

## Justification

`Date` est disqualifié pour trois raisons indépendantes :

1. **Il est faux avant 1582.** `new Date('1500-01-01')` interprète la date en
   grégorien proleptique. Or un acte de 1500 est julien. L'écart est de dix
   jours, silencieusement.
2. **Il ignore le calendrier républicain.** Quatorze ans d'état civil français
   (1792-1806) ne s'expriment que dans ce calendrier. Un acte du « 18 brumaire
   an VIII » n'est pas une curiosité : c'est la seule forme qui existe.
3. **Il porte fuseau horaire et heure d'été.** Un acte de naissance n'a pas de
   fuseau. Introduire cette notion produit des décalages d'un jour selon la
   machine.

Le JDN règle les trois : un entier, ordonné linéairement, qui traverse la
discontinuité julien/grégorien et sert directement d'axe de rendu.

## Le point qui compte vraiment : la logique trivaluée

Une date n'est pas un point, c'est une fenêtre. « Juin 1877 » couvre trente
jours. « Vers 1877 » en couvre environ 3 650.

Les prédicats temporels renvoient donc `YES` / `MAYBE` / `NO` :

```
wasAliveOn(personne, 8 mai 1945)
  YES    né avec certitude avant, mort avec certitude après
  MAYBE  compatible avec ce qui est enregistré, mais l'incertitude
         interdit de l'affirmer
  NO     exclu par les dates enregistrées
```

Sans ce troisième état, « qui était vivant le 8 mai 1945 ? » force un mensonge
dans un sens ou dans l'autre : soit on affirme des vivants qu'on ne peut pas
prouver, soit on en exclut qu'on n'a pas le droit d'exclure.

### La règle de durée de vie maximale

Une personne née en 1750 sans date de décès enregistrée n'était pas vivante en 1945. Sans cette borne arithmétique (123 ans, arrondi supérieur du record
vérifié de Jeanne Calment), « qui était vivant » remonterait tout ancêtre non
daté et deviendrait inutilisable.

La borne est **marquée comme inférée** (`latestIsInferred`) et n'est jamais
réécrite dans la date de décès de la personne. Le rendu doit l'estomper, pas la
tracer.

## Conséquences

- Les tolérances de `ABOUT` / `ESTIMATED` / `CALCULATED` sont une décision
  produit, pas un fait. Elles vivent dans `DEFAULT_ESTIMATION_POLICY`,
  injectables, documentées dans `docs/TEMPORAL_MODEL.md`.
- Le texte source est conservé verbatim. Une date illisible est stockée telle
  quelle plutôt que jetée.
- Le codec recalcule la fenêtre à la lecture comme à l'écriture : une ligne
  écrite avant une correction des règles se relit corrigée.
