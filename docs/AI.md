# IA

Règle fondatrice, qui gouverne tout le reste
([ADR 0004](adr/0004-ai-proposes-humans-approve.md)) :

> **L'IA propose, l'humain décide.** Une sortie de modèle n'est jamais un fait
> généalogique. Elle devient une `AiProposal` en attente ; seule une
> acceptation explicite crée une affirmation, et l'affirmation garde un lien
> vers la proposition, pour toujours.

Code : `packages/ai/src/` (frontière, fournisseurs, extraction vérifiée, choix
de récits), écriture des propositions et acceptation dans
`packages/db/src/services/proposals.ts`, écrans dans
`apps/web/src/components/ai/`.

## Les fournisseurs

`AIProvider` est la seule porte : `extract` (lire une transcription) et
`chooseStories` (choisir des récits). `AI_PROVIDER` décide :

| Valeur      | Fournisseur                                                                                  |
| ----------- | -------------------------------------------------------------------------------------------- |
| `anthropic` | Claude, via le SDK officiel. Modèle : `AI_MODEL_PRIMARY` (défaut `claude-opus-5`)            |
| `fake`      | Double de test déterministe : quelques expressions régulières sur les tournures d'état civil |
| `none`      | Aucun. Les écrans n'affichent **pas** de bouton plutôt qu'un bouton qui échoue               |

Deux refus codés en dur, sans interrupteur :

- **la CI n'appelle jamais une API payante** : construire le fournisseur
  Anthropic quand `CI` est défini lève une erreur. Un test automatisé rejoué à
  chaque poussée, lisant ce que contiennent les fixtures, est exactement la
  combinaison qui transforme un secret mal configuré en facture ;
- **la production refuse de démarrer avec `fake`** : la sortie d'une
  expression régulière présentée comme une lecture de registre serait une
  petite fabrication.

Le double de test est **étiqueté comme tel** sur chaque proposition qu'il
produit, et c'est lui qui fait tourner la boucle complète en développement, en
CI et en E2E — sans envoyer un mot nulle part.

## Ce que l'IA lit

**Une transcription citée, jamais du texte libre.** Le point de départ est une
`Citation` : une source, une cote, une page, et la transcription verbatim que
quelqu'un a saisie. L'extraction part de là, et la proposition garde le lien
vers cette citation — sans quoi la chaîne casserait à l'endroit qui compte : un
fait accepté cesserait de dire de quelle page il vient.

Limite d'entrée : 40 000 caractères (un long acte notarié passe ; un livre
entier non — il vaut mieux le découper en actes).

## Ce qu'elle peut proposer

Un sous-ensemble des prédicats d'affirmation, nommé à l'identique pour qu'une
proposition devienne une affirmation sans table de traduction : `NAME`,
`RECORDED_SEX`, `BIRTH_DATE`, `BIRTH_PLACE`, `BAPTISM_DATE`, `DEATH_DATE`,
`DEATH_PLACE`, `BURIAL_DATE`, `MARRIAGE_DATE`, `MARRIAGE_PLACE`, `OCCUPATION`,
`RESIDENCE`, `PARENT`, `SPOUSE`, `CHILD`, plus le type du document. Un
vocabulaire étroit mais toujours juste vaut mieux qu'un large qui invente ; le
reste est laissé à la transcription humaine.

## La vérification, avant qu'un humain ne voie quoi que ce soit

1. **Sortie structurée** imposée par l'API (schéma Zod), pas obtenue par des
   instructions.
2. **Zod** revalide la forme et les bornes en local : un schéma de sortie
   structurée ne sait pas exprimer « entre 0 et 1 », et une contrainte que le
   serveur ignore n'est une contrainte qu'en apparence.
3. **La citation doit exister dans la source.** Chaque fait annoncé porte le
   passage exact censé l'appuyer ; le passage est cherché dans la
   transcription, en tolérant ce qu'une copie fidèle peut changer (accents,
   casse, espaces, apostrophes, retours à la ligne) — et **rien d'autre**. Une
   paraphrase ne correspond pas ; un passage jamais écrit non plus. Ce qui ne
   correspond pas est **écarté et compté**, et le compte est affiché.
4. **Provenance** enregistrée sur chaque proposition : fournisseur, modèle qui
   a effectivement répondu, version du prompt (`fr-register-1`), version du
   pipeline de vérification (`verify-evidence-1`), horodatage.

La confiance du modèle est affichée, **jamais utilisée pour accepter**.

## La revue

Une page par arbre (« Propositions »), une proposition par ligne : valeur
extraite, prédicat, passage justificatif, document, confiance annoncée, et la
citation d'où elle vient.

- **Accepter** crée une affirmation `ACCEPTED`, reliée à la citation et à la
  proposition. Une affirmation acceptée du même prédicat sur la même personne
  passe en `SUPERSEDED` — jamais supprimée : l'histoire de ce qu'on a cru est
  elle-même une matière de recherche.
- **Corriger puis accepter** : la proposition est marquée
  `EDITED_AND_ACCEPTED`, la valeur enregistrée est celle du relecteur.
- **Rejeter** conserve la proposition et sa raison.
- **Il n'y a pas de « tout accepter ».**
- Une date acceptée déplace la fiche **et** la frise : les deux lisent la même
  projection, et un désaccord entre un événement et une affirmation est
  affiché plutôt que masqué.
- Un nom que l'arbre ne connaît pas reste non relié : le relecteur choisit,
  rien n'est deviné.

## Le directeur de récits (drapeau `storyDirector`, désactivé par défaut)

Les candidats sont trouvés **par des règles déterministes** dans les données
acceptées (grand déplacement, lignée la plus profonde, vie bien documentée,
quatre générations vivantes en même temps). Chacun est un récit que
l'application sait déjà raconter, mot pour mot, depuis le registre.

Le modèle ne fait que **choisir parmi ces candidats** et ajouter une phrase
d'introduction. Cette phrase est tenue à ce que le candidat dit : un nombre
qu'elle contient doit figurer dans le titre ou la raison du candidat, sinon
elle est écartée. Elle est étiquetée comme venant du modèle, partout où elle
apparaît. Les personnes vivantes sont exclues de tout motif, **même pour les
éditeurs**. La sélection par règles s'affiche d'emblée, gratuitement, sans rien
envoyer.

## Erreurs

`ExtractionError` porte un **code**, jamais la charge utile :
`NOT_CONFIGURED`, `MISCONFIGURED`, `EMPTY`, `TOO_LONG`, `REFUSED`,
`RATE_LIMITED`, `TIMEOUT`, `UNAVAILABLE`, `REJECTED_REQUEST`, `INVALID_OUTPUT`,
`ABORTED`.

- Reprises **bornées** (deux, par le SDK) : jamais de boucle infinie.
- Délai par requête : `AI_REQUEST_TIMEOUT_MS` (120 s par défaut).
- Un refus de politique arrive en HTTP 200 : il est détecté avant le contenu,
  et l'API réessaie côté serveur sur un modèle de repli avant d'abandonner.
- Une réponse tronquée (`max_tokens`) est refusée : une liste partielle
  présentée comme complète serait pire qu'une erreur.

## Vie privée

- **Rien de privé dans les journaux** : identifiants, compteurs, durées,
  modèle. Jamais la transcription, jamais un nom, jamais la réponse.
- **Envoi annoncé** : l'écran prévient avant chaque envoi à un fournisseur
  externe, et « Mon compte » explique quel fournisseur est configuré et ce qui
  part ([PRIVACY.md](PRIVACY.md)).
- Le modèle par défaut est `claude-opus-5` plutôt qu'un modèle imposant une
  rétention de 30 jours côté fournisseur : un mauvais défaut pour des
  transcriptions qui nomment des vivants.
- Les propositions d'un arbre ne sont **jamais** visibles hors de l'arbre, même
  s'il est public.
- **Pas de reconnaissance faciale** : l'identification sur une photographie
  restera manuelle.

## Ce qui n'existe pas encore

- **Lecture d'images** : l'extraction est textuelle. Un acte scanné doit
  d'abord être transcrit par un humain. La file `document-analysis` est
  déclarée, sans consommateur.
- **Assistant de recherche** (contradictions, questions à poser, plans de
  recherche) : non implémenté.
- **L'extraction tourne dans la requête** (action serveur), pas dans le worker.
- **Le fournisseur Anthropic n'a jamais été appelé pour de vrai** dans ce
  projet : aucune clé n'est configurée ici. Son comportement est vérifié contre
  un client simulé et contre les types du SDK installé (0.125.0). Le premier
  appel réel mérite d'être observé.

Voir [ROADMAP.md](ROADMAP.md).
