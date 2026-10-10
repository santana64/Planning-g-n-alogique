import { ofNameIn } from './french';

/**
 * A revision, told as a sentence.
 *
 * "Noah a corrigé la fiche de Jean ROUX — date de naissance : 1877 → 1878."
 * The revision stores codes and the changed fields; this turns them into what
 * a collaborator reads when a date they researched has moved.
 *
 * What lives here is the choice of sentence and of values. The wording lives
 * in the catalogues, so the caller hands in a translator — the root one,
 * because a history line borrows the names of events, relationships, claims
 * and roles from the namespaces that already hold them, rather than keeping a
 * second copy that can drift.
 *
 * The stored summary is the fallback, not the source: summaries written
 * before this existed carry codes ("BIRTH corrigé") that no reader should
 * have to decode.
 */

export type Values = Readonly<Record<string, string | number>>;
export type Translator = ((key: string, values?: Values) => string) & {
  has?: (key: string) => boolean;
};

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

/** The fields a reader is told about, in the order they are declared. */
const FIELDS = [
  'displayName',
  'recordedSex',
  'livingStatus',
  'privacy',
  'notes',
  'birthDate',
  'birthPlace',
  'deathDate',
  'deathPlace',
  'dateOriginalText',
  'placeOriginalText',
  'description',
  'confidence',
  'role',
  'name',
  'visibility',
  'redactLivingPeople',
] as const;

/** Fields whose value is a code with a name of its own. */
const CODED_VALUES = new Set([
  'recordedSex',
  'livingStatus',
  'privacy',
  'confidence',
  'visibility',
  'role',
]);

function show(t: Translator, field: string, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    const key = field === 'role' ? `tree.roles.${value}` : `history.values.${field}.${value}`;
    if (!CODED_VALUES.has(field) || !t.has?.(key)) return value;
    // Roles are named once, capitalised, because that is how they appear on
    // their own. Inside a sentence they are ordinary nouns. Lowercasing here
    // rather than keeping a second list of role names is a decision that
    // holds for French and English; a language that capitalises its nouns
    // would need the sentence forms in the catalogue.
    return field === 'role' ? t(key).toLowerCase() : t(key);
  }
  if (typeof value === 'boolean') return t(value ? 'common.yes' : 'common.no');
  if (typeof value === 'number') return String(value);
  return null;
}

export function changesOf(facts: RevisionFacts, t: Translator): Change[] {
  const before = facts.before ?? {};
  const after = facts.after ?? {};
  const changes: Change[] = [];
  for (const field of FIELDS) {
    // Bookkeeping fields (search keys, who-updated) are not research, and
    // are simply absent from the list above.
    if (!(field in before) && !(field in after)) continue;
    const label = t(`history.fields.${field}`);
    if (field === 'notes') {
      // A note is the researcher's own working text and can run to pages:
      // the history says it changed, not what it says.
      changes.push({ field: label, before: null, after: t('history.changes.notesModified') });
      continue;
    }
    const was = show(t, field, before[field]);
    const is = show(t, field, after[field]);
    if (was !== is) changes.push({ field: label, before: was, after: is });
  }
  return changes;
}

/** Lowercase: the role appears inside a sentence, not as a label. */
function roleName(t: Translator, role: string | null): string {
  return role && t.has?.(`tree.roles.${role}`)
    ? t(`tree.roles.${role}`).toLowerCase()
    : t('history.someMember');
}

function text(record: Readonly<Record<string, unknown>> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function eventName(t: Translator, type: string | null): string {
  if (!type) return t('history.someEvent');
  return t.has?.(`events.${type}`) ? t(`events.${type}`) : type;
}

/** What a summary written as "Jean ROUX modifié" starts with. */
function headOf(summary: string | null, suffix: string): string | null {
  if (!summary?.endsWith(suffix)) return null;
  const head = summary.slice(0, -suffix.length).trim();
  return head || null;
}

export function describeRevision(facts: RevisionFacts, t: Translator, locale = 'fr'): Described {
  const { action, entityType, summary, before, after } = facts;
  const changes = action === 'UPDATE' ? changesOf(facts, t) : [];
  const h = (key: string, values?: Values): string => t(`history.${key}`, values);

  switch (`${entityType}:${action}`) {
    case 'Person:CREATE': {
      const name = text(after, 'displayName') ?? headOf(summary, 'ajouté') ?? h('somePerson');
      return { sentence: h('personCreate', { name }), changes };
    }
    case 'Person:UPDATE': {
      const name = headOf(summary, 'modifié');
      return {
        sentence: name ? h('personUpdate', { name }) : h('personUpdateAnonymous'),
        changes,
      };
    }
    case 'Person:DELETE': {
      const name = text(before, 'displayName') ?? headOf(summary, 'supprimé') ?? h('somePerson');
      return { sentence: h('personDelete', { name }), changes };
    }
    case 'Person:MERGE': {
      // A merge retires a record. The history says which one, into which,
      // and what came across: it is the only trace of the record that left.
      const merged = text(before, 'mergedName') ?? h('someRecord');
      const kept = text(after, 'keptName') ?? h('anotherRecord');
      const events = Number(after?.['events'] ?? 0);
      const relationships = Number(after?.['relationships'] ?? 0);
      const key =
        events > 0 && relationships > 0
          ? 'personMergeBoth'
          : events > 0
            ? 'personMergeEvents'
            : relationships > 0
              ? 'personMergeLinks'
              : 'personMerge';
      return { sentence: h(key, { merged, kept, events, relationships }), changes };
    }
    case 'Event:CREATE': {
      const participants = after?.['participants'];
      const who = Array.isArray(participants)
        ? participants
            .filter((name): name is string => typeof name === 'string')
            .join(h('participantSeparator'))
        : '';
      const date = text(after, 'date');
      const event = eventName(t, text(after, 'type'));
      const key = who
        ? date
          ? 'eventCreateWhoDate'
          : 'eventCreateWho'
        : date
          ? 'eventCreateDate'
          : 'eventCreate';
      return { sentence: h(key, { event, who, date: date ?? '' }), changes };
    }
    case 'Event:UPDATE':
      return {
        sentence: h('eventUpdate', { event: eventName(t, headOf(summary, 'corrigé')) }),
        changes,
      };
    case 'Event:DELETE': {
      const date = text(before, 'date');
      const event = eventName(t, text(before, 'type'));
      return {
        sentence: date ? h('eventDeleteDate', { event, date }) : h('eventDelete', { event }),
        changes,
      };
    }
    case 'Relationship:CREATE': {
      const source = text(after, 'source');
      const target = text(after, 'target');
      const type = text(after, 'type');
      const kind = (
        type && t.has?.(`relationships.${type}`) ? t(`relationships.${type}`) : h('someLink')
      ).toLowerCase();
      return {
        sentence:
          source && target
            ? h('relationshipCreate', { source, target, kind })
            : h('relationshipCreateAnonymous'),
        changes,
      };
    }
    case 'Relationship:DELETE': {
      const prefix = 'Lien supprimé : ';
      return {
        sentence: summary?.startsWith(prefix)
          ? h('relationshipDelete', { detail: summary.slice(prefix.length) })
          : h('relationshipDeleteAnonymous'),
        changes,
      };
    }
    case 'Source:CREATE':
      return { sentence: h('sourceCreate', { title: text(after, 'title') ?? '…' }), changes };
    case 'Citation:CREATE': {
      const source = text(after, 'source') ?? h('someSource');
      const locator = text(after, 'locator');
      return {
        sentence: locator
          ? h('citationCreateLocator', { source, locator })
          : h('citationCreate', { source }),
        changes,
      };
    }
    case 'Citation:DELETE':
      return {
        sentence: h('citationDelete', { source: text(before, 'source') ?? h('someSource') }),
        changes,
      };
    case 'Document:CREATE':
      return { sentence: h('documentCreate', { title: text(after, 'title') ?? '…' }), changes };
    case 'Claim:ACCEPT_CLAIM': {
      const predicate = claimName(t, text(after, 'predicate'));
      const value = text(after, 'value');
      const edited = after?.['edited'] === true;
      const key = value
        ? edited
          ? 'claimAcceptValueEdited'
          : 'claimAcceptValue'
        : edited
          ? 'claimAcceptEdited'
          : 'claimAccept';
      return { sentence: h(key, { predicate, value: value ?? '' }), changes };
    }
    case 'AiProposal:REJECT_CLAIM':
      return {
        sentence: h('claimReject', { predicate: claimName(t, text(before, 'predicate')) }),
        changes,
      };
    case 'Person:RESTORE':
      return {
        sentence: text(after, 'undoOf')
          ? h('mergeUndone', { name: text(after, 'restoredName') ?? h('somePerson') })
          : summary
            ? h('storedSummary', { summary })
            : h('somethingChanged'),
        changes: [],
      };
    case 'Media:CREATE':
      return { sentence: h('mediaCreate', { title: text(after, 'title') ?? '' }), changes: [] };
    case 'Media:UPDATE':
      return {
        sentence: h('mediaUpdate', { title: text(after, 'title') ?? text(before, 'title') ?? '' }),
        changes: [],
      };
    case 'PersonMediaTag:CREATE':
      return {
        sentence: h('mediaTag', { name: text(after, 'name') ?? h('somePerson') }),
        changes: [],
      };
    case 'PersonMediaTag:DELETE':
      return {
        sentence: h('mediaUntag', { name: text(before, 'name') ?? h('somePerson') }),
        changes: [],
      };
    case 'EventMedia:CREATE':
    case 'EventMedia:DELETE': {
      const side = action === 'CREATE' ? after : before;
      const event = text(side, 'customType') ?? eventName(t, text(side, 'eventType'));
      return {
        sentence: h(action === 'CREATE' ? 'mediaEventLink' : 'mediaEventUnlink', {
          title: text(side, 'title') ?? '',
          event,
        }),
        changes: [],
      };
    }
    case 'Document:UPDATE':
      return {
        sentence: h('documentTranscribed', { title: text(after, 'title') ?? h('someRecord') }),
        changes: [],
      };
    case 'ResearchTask:CREATE':
      return {
        sentence: h('researchTaskCreate', { title: text(after, 'title') ?? h('someTask') }),
        changes: [],
      };
    case 'ResearchTask:UPDATE': {
      const status = text(after, 'status');
      return {
        sentence: h('researchTaskUpdate', {
          title: text(after, 'title') ?? h('someTask'),
          status:
            status && t.has?.(`research.tasks.status.${status}`)
              ? t(`research.tasks.status.${status}`)
              : (status ?? ''),
        }),
        changes: [],
      };
    }
    case 'Tree:CREATE':
      return { sentence: h('treeCreate'), changes };
    case 'Tree:IMPORT':
      return {
        sentence: h('treeImport', {
          people: Number(after?.['people'] ?? 0),
          relationships: Number(after?.['relationships'] ?? 0),
          events: Number(after?.['events'] ?? 0),
        }),
        changes,
      };
    case 'Tree:UPDATE':
      return { sentence: h('treeUpdate'), changes };
    case 'Tree:EXPORT':
      return {
        sentence: h('treeExport', { people: Number(after?.['people'] ?? 0) }),
        changes: [],
      };
    case 'TreeMember:CREATE':
      return {
        sentence: h('memberJoin', { role: roleName(t, text(after, 'role')) }),
        changes: [],
      };
    case 'TreeMember:UPDATE':
      return {
        sentence: h('memberRole', {
          // "de Léa", "d'Émile" — the elision is French, so the value is
          // built for the language the sentence is in.
          of: facts.subjectName ? ofNameIn(locale, facts.subjectName) : h('ofAFormerMember', {}),
          before: roleName(t, text(before, 'role')),
          after: roleName(t, text(after, 'role')),
        }),
        changes: [],
      };
    case 'TreeMember:DELETE':
      return {
        sentence:
          summary === 'A quitté l’arbre'
            ? h('memberLeft')
            : summary === 'Compte supprimé'
              ? h('memberLeftWithAccount')
              : h('memberRemoved', { name: facts.subjectName ?? h('aFormerMember') }),
        changes: [],
      };
    default:
      // Membership and invitation summaries are written as whole sentences,
      // role change included; listing the change again would say it twice.
      return {
        sentence: summary ? h('storedSummary', { summary }) : h('somethingChanged'),
        changes: [],
      };
  }
}

function claimName(t: Translator, predicate: string | null): string {
  return predicate && t.has?.(`claims.${predicate}`)
    ? t(`claims.${predicate}`)
    : t('history.someFact');
}
