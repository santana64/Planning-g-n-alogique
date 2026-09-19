# Confidentialité

Une généalogie contient les données personnelles de personnes qui n'ont rien
demandé : des parents vivants, leurs dates, leurs lieux. Ce document dit ce que
l'application en fait, et où chaque promesse est tenue dans le code.

## Qui voit qui

Une seule règle, dans `packages/domain/src/privacy`. Chaque vue — liste, fiche,
frise, carte, éventail, constellation, récit, recherche, historique — lui pose
la même question et n'efface que ses propres champs.

| Réglage de la personne | Qui la voit                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| `INHERIT` (défaut)     | les membres ; les visiteurs, sauf si elle est présumée vivante et que l'arbre masque les vivants (défaut) |
| `REDACTED`             | les membres seulement, même après son décès — défaut d'une personne déclarée vivante                      |
| `RESTRICTED`           | le propriétaire et les administrateurs seulement                                                          |
| `VISIBLE`              | quiconque peut lire l'arbre, même de son vivant                                                           |

**Présumée vivante** : déclarée vivante, ou sans décès enregistré et née il y a
moins de 123 ans, ou sans aucune date. Un import GEDCOM laisse presque tout le
monde sans statut : « inconnu » n'est jamais lu comme « décédé ».

Ce qu'une personne masquée devient : le libellé neutre « Personne protégée »,
sans nom, dates, lieux, sexe, précision de date, ni la raison du masquage. Elle
ne compte pas dans les totaux de la carte, n'est pas un résultat de recherche,
et ses modifications n'apparaissent pas dans l'historique de qui ne peut pas la
voir.

`VISIBLE` et `RESTRICTED` sont réservés au propriétaire et aux administrateurs
(`canSetPersonPrivacy`) : publier un vivant et cacher quelqu'un aux éditeurs
sont des décisions sur l'exposition d'autrui.

## Arbre

- Privé par défaut ; « par lien » et « public » s'ouvrent aux visiteurs, avec
  la règle ci-dessus. Aucune page n'est indexée par les moteurs de recherche.
- « Masquer aux visiteurs les personnes qui peuvent être en vie » est coché par
  défaut ; le décocher affiche un avertissement, et les personnes déclarées
  vivantes restent masquées (`REDACTED`).

## Ce qui est conservé, et ce qui ne l'est pas

- **Compte** : nom, adresse, date de création, langue ; mot de passe haché par
  Better Auth ; sessions avec l'adresse IP et le navigateur d'ouverture.
- **Historique** : chaque modification, qui l'a faite, les valeurs avant et
  après. Les membres y sont désignés par leur compte, jamais par leur nom
  recopié : un nom écrit dans une révision survivrait à l'effacement du compte.
  Les notes de recherche y apparaissent comme « modifiées », pas leur texte.
- **Invitations** : l'adresse invitée, le rôle, l'échéance, et un **haché** du
  lien — jamais le lien. Aucun courriel n'est envoyé : l'invitant transmet le
  lien lui-même.
- **Journaux** : identifiants, comptes et durées. Jamais un nom, une adresse,
  une transcription, un mot de passe ou un jeton ; une erreur n'y laisse que
  son nom de classe.

## Droits des personnes

| Droit                       | Où                                                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Accès, portabilité (compte) | Mon compte → « Télécharger mes données » (JSON)                                                                         |
| Portabilité (arbre)         | Réglages → « Télécharger le fichier GEDCOM » (propriétaire, administrateurs) ; chaque export est inscrit à l'historique |
| Effacement (arbre)          | Réglages → suppression, nom de l'arbre à taper (propriétaire)                                                           |
| Effacement (compte)         | Mon compte → suppression, connexion récente et adresse à taper                                                          |
| Personne vivante citée      | le propriétaire de l'arbre la masque (`REDACTED`, `RESTRICTED`) ou retire sa fiche                                      |

### Supprimer un arbre

Immédiat : dans la même transaction, l'arbre sort de toutes les pages et ses
liens d'invitation cessent de fonctionner. Ses fichiers stockés puis ses lignes
(personnes, événements, sources, documents, membres, invitations, historique)
sont effacés dans la foulée ; si cette purge est interrompue, le balayeur du
worker la termine (toutes les 15 minutes). Rien n'est récupérable.

### Supprimer un compte

Partent : le compte, ses sessions et identifiants, ses adhésions, les
invitations qu'il a envoyées et celles adressées à son adresse, et chaque arbre
dont il était le **seul membre**. Restent : ses contributions aux arbres
partagés — elles font partie de la recherche de la famille — dont l'historique
ne dit plus qui les a faites.

Bloque : un arbre dont il est le seul propriétaire alors que d'autres y
travaillent. Il faut d'abord nommer un autre propriétaire, ou supprimer l'arbre.

Exige : une connexion de moins de 15 minutes (une session volée ou un poste
resté ouvert ne suffisent pas) et l'adresse du compte tapée en entier.

## Intelligence artificielle

- Aucun texte n'est envoyé sans le geste d'un éditeur (« Proposer des faits à
  partir de cette transcription », « Demander une sélection à … ») ; le
  fournisseur configuré est nommé avant.
- Ce qui part : la transcription citée, et pour la sélection de récits des
  titres et années de personnes décédées — jamais de personne vivante.
- Rien de ce que propose un modèle n'entre dans l'arbre sans être accepté par
  une personne (ADR 0004). La CI n'appelle jamais un fournisseur payant.
- Modèle par défaut : `claude-opus-5`. Fable 5.1 impose une rétention de 30
  jours côté fournisseur, mauvais défaut pour des textes qui nomment des
  vivants.

## Limites connues

- Les adresses ne sont pas vérifiées (aucun fournisseur de courriel configuré
  par défaut). Une invitation lie un lien à usage unique et une adresse ; qui
  détient le lien d'une adresse encore sans compte peut créer ce compte. Voir
  `SECURITY.md`.
- Les identifiants techniques de l'auteur d'une fiche (`createdById`) restent
  dans les lignes de l'arbre après l'effacement du compte : ils ne désignent
  plus rien.
