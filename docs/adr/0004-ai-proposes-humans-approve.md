# ADR 0004 — L'IA propose, l'humain valide

**Statut** : accepté — 2026-09-15

## Contexte

L'IA sait lire un acte manuscrit et en extraire un nom, une date, un lieu.
C'est utile et c'est faillible.

## Décision

Une sortie de modèle ne peut **jamais** produire directement un `Claim`. Elle
crée un `AiProposal` en statut `PENDING`. Un humain accepte, corrige ou rejette.
Le `Claim` créé à l'acceptation garde un pointeur vers la proposition d'origine.

La séparation est matérialisée par **deux tables distinctes**, pas par un
booléen.

## Justification

Une erreur de transcription en généalogie ne reste pas locale. Une date inventée
déplace une branche entière, et l'erreur se propage aux arbres d'autres
chercheurs par export GEDCOM. Dix ans plus tard, personne ne sait d'où elle
vient.

Un champ `isAiGenerated` ne suffirait pas : trop facile à oublier dans une
requête, et il ne dit rien du modèle, du prompt, ni de l'extrait qui justifiait
la valeur.

`AiProposal` porte donc la provenance complète — fournisseur, modèle, version de
prompt, version de pipeline, horodatage, extrait de preuve, région de la page.
Cette information survit à la revue.

## Conséquences

- La CI n'appelle jamais l'API payante. `FakeAIProvider` renvoie des réponses
  déterministes.
- Toute réponse réelle est validée par Zod avant écriture.
- La confiance déclarée du modèle est **affichée, jamais utilisée pour
  auto-accepter**. Un seuil d'auto-acceptation serait exactement la porte que
  cette ADR ferme.
- L'assistant de recherche doit distinguer explicitement `connu` / `inféré` /
  `possible` / `inconnu`, et dire quand la preuve manque.
