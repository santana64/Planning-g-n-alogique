import { ofName } from './french';
import { CLAIM_LABELS, EVENT_LABELS, RELATIONSHIP_LABELS } from './labels';

/**
 * A revision, told as a sentence.
 *
 * "Noah a corrigé la fiche de Jean ROUX — date de naissance : 1877 → 1878."
 * The revision stores codes and the changed fields; this turns them into
 * what a collaborator reads when a date they researched has moved. Pure, so
 * every wording is tested without a database.
 *
 * The stored summary is the fallback, not the source: summaries written
 * before this existed carry codes ("BIRTH corrigé") that no reader should
 * have to decode.
 */

export interface RevisionFacts {
  readonly action: string;
  readonly entityType: string;
  readonly summary: string | null;
  /** For a membership change: the member's current name, null once erased. */
  readonly subjectName?: string | null;
  readonly before: Readonly<Record<string, unknown>> | null;
  readonly after: Readonly<Record<string, unknown>> | null;
}

export interface Change {
  readonly field: string;
  readonly before: string | null;
  readonly after: string | null;
}

export interface Described {
  /** Follows the author's name: "a corrigé la fiche de Jean ROUX". */
  readonly sentence: string;
  readonly changes: readonly Change[];
}

const FIELD_LABELS: Record<string, string> = {
  displayName: 'nom',
  recordedSex: 'sexe',
  livingStatus: 'statut',
  privacy: 'visibilité',
  notes: 'notes de recherche',
  birthDate: 'date de naissance',
  birthPlace: 'lieu de naissance',
  deathDate: 'date de décès',
  deathPlace: 'lieu de décès',
  dateOriginalText: 'date',
  placeOriginalText: 'lieu',
  description: 'description',
  confidence: 'confiance',
  role: 'rôle',
  name: 'nom de l’arbre',
  visibility: 'lecture',
  redactLivingPeople: 'vivants masqués aux visiteurs',
};

const VALUE_LABELS: Record<string, Record<string, string>> = {
  recordedSex: {
    MALE: 'masculin',
    FEMALE: 'féminin',
    INTERSEX: 'intersexe',
    UNKNOWN: 'non renseigné',
  },
  livingStatus: { LIVING: 'vivante', DECEASED: 'décédée', UNKNOWN: 'inconnu' },
  privacy: {
    INHERIT: 'selon la règle de l’arbre',
    REDACTED: 'membres seulement',
    RESTRICTED: 'administrateurs seulement',
    VISIBLE: 'publique',
  },
  confidence: {
    VERY_LOW: 'très faible',
    LOW: 'faible',
    MEDIUM: 'moyenne',
    HIGH: 'élevée',
    VERY_HIGH: 'très élevée',
  },
  visibility: {
    PRIVATE: 'membres seulement',
    LINK: 'par lien',
    PUBLIC: 'public',
  },
  role: {
    OWNER: 'propriétaire',
    ADMIN: 'administrateur',
    EDITOR: 'éditeur',
    CONTRIBUTOR: 'contributeur',
    VIEWER: 'lecteur',
  },
};

function show(field: string, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') return VALUE_LABELS[field]?.[value] ?? value;
  if (typeof value === 'boolean') return value ? 'oui' : 'non';
  if (typeof value === 'number') return String(value);
  return null;
}

export function changesOf(facts: RevisionFacts): Change[] {
  const before = facts.before ?? {};
  const after = facts.after ?? {};
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const changes: Change[] = [];
  for (const field of fields) {
    const label = FIELD_LABELS[field];
    // Bookkeeping fields (search keys, who-updated) are not research.
    if (!label) continue;
    if (field === 'notes') {
      // A note is the researcher's own working text and can run to pages:
      // the history says it changed, not what it says.
      changes.push({ field: label, before: null, after: 'modifiées' });
      continue;
    }
    const was = show(field, before[field]);
    const is = show(field, after[field]);
    if (was !== is) changes.push({ field: label, before: was, after: is });
  }
  return changes;
}

function roleName(role: string | null): string {
  return (role && VALUE_LABELS['role']?.[role]) ?? 'membre';
}

function text(record: Readonly<Record<string, unknown>> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function eventName(type: string | null): string {
  return type ? (EVENT_LABELS[type] ?? type) : 'Événement';
}

/** What a summary written as "Jean ROUX modifié" starts with. */
function headOf(summary: string | null, suffix: string): string | null {
  if (!summary?.endsWith(suffix)) return null;
  const head = summary.slice(0, -suffix.length).trim();
  return head || null;
}

export function describeRevision(facts: RevisionFacts): Described {
  const { action, entityType, summary, before, after } = facts;
  const changes = action === 'UPDATE' ? changesOf(facts) : [];

  switch (`${entityType}:${action}`) {
    case 'Person:CREATE': {
      const name = text(after, 'displayName') ?? headOf(summary, 'ajouté') ?? 'une personne';
      return { sentence: `a ajouté ${name}`, changes };
    }
    case 'Person:UPDATE': {
      const name = headOf(summary, 'modifié');
      return {
        sentence: name ? `a corrigé la fiche de ${name}` : 'a corrigé une fiche',
        changes,
      };
    }
    case 'Person:DELETE': {
      const name = text(before, 'displayName') ?? headOf(summary, 'supprimé') ?? 'une personne';
      return { sentence: `a retiré ${name} de l’arbre`, changes };
    }
    case 'Event:CREATE': {
      const participants = after?.['participants'];
      const who = Array.isArray(participants)
        ? participants.filter((name): name is string => typeof name === 'string').join(' et ')
        : '';
      const date = text(after, 'date');
      return {
        sentence: `a ajouté l’événement « ${eventName(text(after, 'type'))} »${
          who ? ` de ${who}` : ''
        }${date ? ` (${date})` : ''}`,
        changes,
      };
    }
    case 'Event:UPDATE':
      return {
        sentence: `a corrigé l’événement « ${eventName(headOf(summary, 'corrigé'))} »`,
        changes,
      };
    case 'Event:DELETE': {
      const date = text(before, 'date');
      return {
        sentence: `a retiré l’événement « ${eventName(text(before, 'type'))} »${
          date ? ` (${date})` : ''
        }`,
        changes,
      };
    }
    case 'Relationship:CREATE': {
      const source = text(after, 'source');
      const target = text(after, 'target');
      const kind = (RELATIONSHIP_LABELS[text(after, 'type') ?? ''] ?? 'lien').toLowerCase();
      return {
        sentence: source && target ? `a relié ${source} à ${target} (${kind})` : 'a ajouté un lien',
        changes,
      };
    }
    case 'Relationship:DELETE': {
      const prefix = 'Lien supprimé : ';
      return {
        sentence: summary?.startsWith(prefix)
          ? `a supprimé le lien ${summary.slice(prefix.length)}`
          : 'a supprimé un lien',
        changes,
      };
    }
    case 'Source:CREATE':
      return { sentence: `a ajouté la source « ${text(after, 'title') ?? '…'} »`, changes };
    case 'Citation:CREATE': {
      const locator = text(after, 'locator');
      return {
        sentence: `a cité « ${text(after, 'source') ?? 'une source'} »${locator ? `, ${locator}` : ''}`,
        changes,
      };
    }
    case 'Citation:DELETE':
      return {
        sentence: `a retiré une citation de « ${text(before, 'source') ?? 'une source'} »`,
        changes,
      };
    case 'Document:CREATE':
      return { sentence: `a versé le document « ${text(after, 'title') ?? '…'} »`, changes };
    case 'Claim:ACCEPT_CLAIM': {
      const value = text(after, 'value');
      return {
        sentence: `a accepté une lecture proposée : ${
          CLAIM_LABELS[text(after, 'predicate') ?? ''] ?? 'fait'
        }${value ? ` « ${value} »` : ''}${after?.['edited'] === true ? ', après correction' : ''}`,
        changes,
      };
    }
    case 'AiProposal:REJECT_CLAIM':
      return {
        sentence: `a rejeté une lecture proposée (${
          CLAIM_LABELS[text(before, 'predicate') ?? ''] ?? 'fait'
        })`,
        changes,
      };
    case 'Tree:CREATE':
      return { sentence: 'a créé l’arbre', changes };
    case 'Tree:IMPORT':
      return {
        sentence: `a importé un fichier GEDCOM : ${Number(after?.['people'] ?? 0)} personnes, ${Number(
          after?.['relationships'] ?? 0,
        )} liens, ${Number(after?.['events'] ?? 0)} événements`,
        changes,
      };
    case 'Tree:UPDATE':
      return { sentence: 'a modifié les réglages de l’arbre', changes };
    case 'Tree:EXPORT':
      return {
        sentence: `a exporté l’arbre au format GEDCOM (${Number(after?.['people'] ?? 0)} personnes)`,
        changes: [],
      };
    case 'TreeMember:CREATE':
      return {
        sentence: `a rejoint l’arbre comme ${roleName(text(after, 'role'))}`,
        changes: [],
      };
    case 'TreeMember:UPDATE':
      return {
        sentence: `a changé le rôle ${
          facts.subjectName ? ofName(facts.subjectName) : 'd’un ancien membre'
        } : ${roleName(text(before, 'role'))} → ${roleName(text(after, 'role'))}`,
        changes: [],
      };
    case 'TreeMember:DELETE':
      return {
        sentence:
          summary === 'A quitté l’arbre'
            ? 'a quitté l’arbre'
            : summary === 'Compte supprimé'
              ? 'a quitté l’arbre en supprimant son compte'
              : `a retiré ${facts.subjectName ?? 'un ancien membre'} de l’arbre`,
        changes: [],
      };
    default:
      // Membership and invitation summaries are written as whole sentences,
      // role change included; listing the change again would say it twice.
      return { sentence: summary ? `— ${summary}` : 'a fait une modification', changes: [] };
  }
}
