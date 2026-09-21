# Sécurité

## Autorisation

**Une table, lue par tout le monde** : `packages/domain/src/permissions`.

| Rôle        | Ajouter, corriger | Supprimer | Importer | Exporter, publier/restreindre, membres, réglages | Supprimer l'arbre |
| ----------- | :---------------: | :-------: | :------: | :----------------------------------------------: | :---------------: |
| OWNER       |         ✓         |     ✓     |    ✓     |                        ✓                         |         ✓         |
| ADMIN       |         ✓         |     ✓     |    ✓     |                        ✓                         |                   |
| EDITOR      |         ✓         |     ✓     |    ✓     |                                                  |                   |
| CONTRIBUTOR |         ✓         |           |          |                                                  |                   |
| VIEWER      |                   |           |          |                                                  |                   |

- **Chaque écriture est autorisée côté serveur** (`apps/web/src/server/authorise.ts`) :
  session, adhésion lue en base, capacité exigée par l'action. Masquer un bouton
  n'est jamais la permission. Un test E2E rejoue la vraie requête d'action
  serveur d'un propriétaire avec la session d'un contributeur : refusée.
- **Garde par personne** : une action qui nomme une personne masquée à son
  auteur (restreinte, pour un éditeur) échoue comme pour une personne
  inexistante — le refus ne confirme rien.
- **Adhésions** : un administrateur ne gère que les rôles inférieurs au sien ;
  la propriété ne passe jamais par un lien ; l'arbre garde toujours un
  propriétaire. Le rôle de l'acteur est relu **dans la transaction, après
  verrouillage** de l'arbre : deux propriétaires qui se rétrogradent en même
  temps ne laissent pas l'arbre sans propriétaire (testé).
- **Existence** : un arbre privé, un arbre inexistant et un arbre non ouvert en
  écriture répondent pareil (404 ou message identique).

## Invitations

- Jeton de 256 bits (`randomBytes(32)`), montré **une fois** à l'invitant ; seul
  son SHA-256 est stocké.
- Valable 7 jours, une seule fois (réclamé par une mise à jour conditionnelle),
  pour une seule adresse ; une nouvelle invitation à la même adresse annule la
  précédente ; révocable.
- La page d'invitation n'est ni indexée ni source de `Referer`, et ne montre
  l'adresse que masquée (`c•••@exemple.fr`).
- Le lien part **par courriel** à l'adresse invitée quand l'instance peut
  envoyer, et reste affiché à l'invitant : un message se perd, et une famille
  a souvent déjà son canal.
- **Sans fournisseur de courriel** (`MAIL_TRANSPORT=none`), le lien est le seul
  secret : qui le détient peut créer le compte de l'adresse invitée si elle
  n'en a pas encore — les adresses ne sont alors pas vérifiables.

## Authentification

- Better Auth, mots de passe de 12 caractères minimum, cookies `httpOnly`,
  `SameSite=Lax`, `Secure` en production.
- Limites de débit : connexion 5/min, inscription 20/h, réinitialisation 3/h
  (par IP). Une exécution E2E complète consomme environ 6 inscriptions.
- **Vérification de l'adresse** : exigée dès que l'instance peut envoyer
  (`requireEmailVerification` suit la configuration du courriel). Sans
  transport, l'exiger enfermerait tout le monde dehors. Lien valable 24 h,
  renvoyé sur demande et à toute tentative de connexion non confirmée.
- **Mot de passe oublié** : lien à usage unique, valable 1 heure, jeton jamais
  écrit ailleurs que dans le message — ni journal, ni page. La demande répond
  **la même chose** que l'adresse existe ou non : une réponse différente ferait
  de cette page un moyen de savoir qui est inscrit. Le lien déjà utilisé ne
  propose plus de formulaire.
- **Opérations irréversibles** : supprimer un compte exige une connexion de
  moins de 15 minutes et l'adresse tapée — pas un mot de passe, qui ferait de
  cette page un oracle hors des limites de débit de la connexion.
- Retour après connexion (`next`) limité aux chemins de l'application
  (`safeReturnPath`) : pas de redirection ouverte.

## Données et stockage

- Clés d'objets générées par le serveur, préfixées par arbre ; jamais le nom
  de fichier de l'utilisateur. Type de fichier lu dans les octets, pas dans
  l'extension.
- Documents servis après contrôle d'accès (réglage du document, rôle du
  lecteur), par une URL signée valable 15 minutes, jamais par une URL publique
  permanente.
- Secrets par l'environnement seulement ; `.env` n'est jamais versionné. Le
  serveur refuse de démarrer en production avec une configuration dangereuse
  (`refuseUnsafeConfiguration`).
- Migrations Prisma uniquement (`migrate deploy`), jamais `db push`.

## En-têtes

Politique de contenu (`apps/web/next.config.ts`) : tout depuis l'origine,
aucun cadre (`frame-ancestors 'none'`), aucun objet, formulaires vers
l'origine seulement, pas d'`eval` en production.

**Limite** : `script-src` accepte encore `'unsafe-inline'`, exigé par le
démarrage que Next insère dans la page. La suite est une politique à nonce
générée par requête dans le proxy ; elle rend chaque page dynamique, ce qui est
déjà le cas de toutes celles qui lisent la base.

## Journaux

Jamais : mot de passe, jeton, session, document, transcription, nom ou adresse
d'une personne. Les erreurs de base n'y laissent que leur nom de classe, car un
message Prisma peut citer une valeur.
