# Vision

Chronolignée est un logiciel de généalogie qui traite une famille comme ce
qu'elle est : un graphe **plus** le temps, la géographie, le contexte
historique, les preuves et le récit. Un logiciel classique répond à « qui est
lié à qui ». Chronolignée répond aussi à :

- qui a vécu quand, et **qui était vivant en même temps** ;
- où les branches ont vécu, et quand elles ont bougé ;
- ce qui se passait dans le monde pendant une vie ;
- **quelle source appuie ce qu'on croit savoir**, et laquelle la contredit.

Sa vue signature est le **Gantt généalogique** : chaque vie est un intervalle
de temps, les liens familiaux relient les intervalles.

Le produit doit servir deux usages sans en sacrifier aucun : un **instrument de
recherche** sérieux quand on cherche, une **machine à remonter le temps** quand
on explore. Quand les deux tirent en sens contraire, l'intégrité des données
l'emporte sur le spectacle.

## Principes non négociables

1. **La preuve avant l'affirmation.** Une date de naissance n'est pas une
   colonne : c'est un événement, appuyé par des citations, et les lectures
   contradictoires restent en base ([modèle de données](DATA_MODEL.md)).
2. **L'incertitude reste visible.** Toute date est une fenêtre ; « qui était
   vivant » répond en trois nombres, jamais en un
   ([modèle temporel](TEMPORAL_MODEL.md)).
3. **L'IA propose, l'humain décide.** Aucune sortie de modèle ne devient un
   fait sans une acceptation explicite ([IA](AI.md)).
4. **Un modèle canonique, plusieurs projections.** Frise, ascendance,
   descendance, éventail, constellation, carte et récit lisent la même donnée.
5. **Le temps et la géographie sont des dimensions de premier ordre.**
6. **Les sources sont des entités**, pas des notes.
7. **Les vivants sont protégés par défaut** ([confidentialité](PRIVACY.md)).
8. **La performance fait partie de l'expérience**
   ([mesures](PERFORMANCE.md)).
9. **L'accessibilité vaut aussi pour les vues spectaculaires** : chaque dessin
   a son équivalent en HTML structuré.
10. **Pas de fausse précision, pas de faux progrès, pas de fausse généalogie.**
    Une date illisible est conservée telle qu'écrite plutôt que devinée ; une
    barre de progression mesure du travail réel ; un récit ne contient pas une
    phrase qui ne vienne du registre.

## Pour qui

- **Le chercheur** qui tient un arbre de quelques centaines à quelques dizaines
  de milliers de personnes, cite ses sources, et doit retrouver dans dix ans
  pourquoi il a cru une date.
- **La famille** à qui il ouvre l'arbre : lecteurs, contributeurs, sans que
  les vivants soient exposés à l'extérieur.

## Ce que le produit n'est pas

- Un annuaire de contacts avec une colonne `birthDate`.
- Un service qui « trouve vos ancêtres » par déduction automatique : rien n'est
  fusionné, déduit ou accepté sans un humain.
- Une interface d'administration générique : le langage visuel est celui d'une
  salle d'archives la nuit ([système de design](DESIGN_SYSTEM.md)).

## Ce qui existe aujourd'hui

L'état réel, vérifié, est tenu dans [`PROJECT_STATUS.md`](PROJECT_STATUS.md) ;
ce qui reste à construire, dans [`ROADMAP.md`](ROADMAP.md).
