# ADR 0001 — PostgreSQL plutôt qu'une base graphe

**Statut** : accepté — 2026-09-15

## Contexte

La généalogie est un graphe. Le réflexe est d'atteindre Neo4j.

## Décision

PostgreSQL 18, traversées en CTE récursives, accès au graphe masqué derrière
des services de domaine dans `packages/genealogy`.

## Justification

Le graphe généalogique a une forme très particulière : il est **peu dense**
(au plus deux parents biologiques par personne) et **peu profond** (une
généalogie documentée dépasse rarement quinze générations). Les requêtes qui
comptent sont « tous les ancêtres de X » et « tous les descendants de X » :
des traversées bornées depuis une racine, pas de la recherche de chemin
arbitraire dans un graphe dense.

C'est exactement le point fort d'une CTE récursive indexée sur
`(treeId, targetId)`.

Ce qu'on gagne à rester sur PostgreSQL pèse plus lourd que la traversée :

- **Une seule base transactionnelle.** Accepter un claim touche le claim, la
  personne et le journal d'audit. En bi-base, cette atomicité disparaît.
- **PostGIS.** La géographie est une dimension de premier ordre du produit.
- **Recherche plein texte et trigram** au même endroit que les données.
- **Une seule sauvegarde à tester.** Une archive généalogique représente des
  décennies de travail humain ; la restauration doit être simple.

## Conséquences

Les traversées passent par `packages/genealogy`, jamais par du SQL disséminé.
Si le profil de charge change un jour, un moteur dédié peut se glisser derrière
cette interface sans réécrire le produit.

## Ce qui invaliderait cette décision

Une requête réelle, mesurée, dont la CTE récursive reste inacceptable après
indexation correcte et `EXPLAIN ANALYZE`. Mesurer d'abord.
