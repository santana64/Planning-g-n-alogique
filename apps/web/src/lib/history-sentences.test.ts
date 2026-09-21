import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import fr from '../../messages/fr.json';
import { describeRevision, type RevisionFacts, type Translator } from './history-sentences';

/**
 * The history, rendered through the real catalogues.
 *
 * The module chooses the sentence and the values; the wording is in
 * `messages/*.json`. Rendering through the catalogue here means a key the
 * code asks for and the catalogue does not have fails in this test rather
 * than in front of a reader — `onError` throws instead of returning the key.
 */

const translator = (locale: 'fr' | 'en'): Translator =>
  // Cast: the imported JSON gives `createTranslator` literal key types, and
  // this module calls it with keys it computes from a revision.
  createTranslator({
    locale,
    messages: locale === 'fr' ? fr : en,
    onError: (error) => {
      throw error;
    },
  }) as unknown as Translator;

const french = translator('fr');
const english = translator('en');

const facts = (partial: Partial<RevisionFacts> & Pick<RevisionFacts, 'entityType' | 'action'>) => ({
  summary: null,
  before: null,
  after: null,
  ...partial,
});

/** The French reading, which the wording of these assertions describes. */
const told = (input: Parameters<typeof describeRevision>[0]) => describeRevision(input, french);

describe('describeRevision', () => {
  it('tells a corrected birth as before and after', () => {
    const described = told(
      facts({
        entityType: 'Person',
        action: 'UPDATE',
        summary: 'Jean ROUX modifié',
        before: { birthDate: '1877', birthPlace: null },
        after: { birthDate: '1878', birthPlace: 'Tours' },
      }),
    );
    expect(described.sentence).toBe('a corrigé la fiche de Jean ROUX');
    expect(described.changes).toEqual([
      { field: 'date de naissance', before: '1877', after: '1878' },
      { field: 'lieu de naissance', before: null, after: 'Tours' },
    ]);
  });

  it('names settings in words, and leaves bookkeeping out', () => {
    const described = told(
      facts({
        entityType: 'Person',
        action: 'UPDATE',
        summary: 'Claire ROUX modifié',
        before: { livingStatus: 'UNKNOWN', privacy: 'INHERIT', searchName: 'claire roux' },
        after: { livingStatus: 'LIVING', privacy: 'REDACTED', updatedById: 'u1' },
      }),
    );
    expect(described.changes).toEqual([
      { field: 'statut', before: 'inconnu', after: 'vivante' },
      { field: 'visibilité', before: 'selon la règle de l’arbre', after: 'membres seulement' },
    ]);
  });

  it('says a note changed without quoting it', () => {
    const described = told(
      facts({
        entityType: 'Person',
        action: 'UPDATE',
        summary: 'Paul ROUX modifié',
        before: { notes: null },
        after: { notes: 'Chercher le mariage à Tours, registre de 1902.' },
      }),
    );
    expect(described.changes).toEqual([
      { field: 'notes de recherche', before: null, after: 'modifiées' },
    ]);
  });

  it('decodes the codes older summaries carry', () => {
    expect(
      told(facts({ entityType: 'Event', action: 'UPDATE', summary: 'MARRIAGE corrigé' })).sentence,
    ).toBe('a corrigé l’événement « Mariage »');
    expect(
      told(
        facts({
          entityType: 'Relationship',
          action: 'CREATE',
          after: { type: 'PARENT_BIOLOGICAL', source: 'Jean ROUX', target: 'Paul ROUX' },
        }),
      ).sentence,
    ).toBe('a relié Jean ROUX à Paul ROUX (parent biologique)');
    expect(
      told(
        facts({
          entityType: 'Claim',
          action: 'ACCEPT_CLAIM',
          after: { predicate: 'BIRTH_DATE', value: '12 juin 1877', edited: true },
        }),
      ).sentence,
    ).toBe('a accepté une lecture proposée : date de naissance « 12 juin 1877 », après correction');
  });

  it('tells an event with the people it belongs to', () => {
    expect(
      told(
        facts({
          entityType: 'Event',
          action: 'CREATE',
          after: { type: 'MARRIAGE', date: '1902', participants: ['Jean ROUX', 'Anne BRUN'] },
        }),
      ).sentence,
    ).toBe('a ajouté l’événement « Mariage » de Jean ROUX et Anne BRUN (1902)');
  });

  it('tells an import as one line', () => {
    expect(
      told(
        facts({
          entityType: 'Tree',
          action: 'IMPORT',
          after: { people: 4, relationships: 5, events: 6, refused: 0 },
        }),
      ).sentence,
    ).toBe('a importé un fichier GEDCOM : 4 personnes, 5 liens, 6 événements');
  });

  it('tells a merge as what became of the record that left', () => {
    expect(
      told(
        facts({
          entityType: 'Person',
          action: 'MERGE',
          summary: 'Jean CHASSAIGNE fusionné dans Jean CHASSAGNE',
          before: { mergedId: 'p2', mergedName: 'Jean CHASSAIGNE' },
          after: { keptId: 'p1', keptName: 'Jean CHASSAGNE', events: 2, relationships: 1 },
        }),
      ).sentence,
    ).toBe('a fusionné Jean CHASSAIGNE dans Jean CHASSAGNE — 2 événements, 1 lien repris');

    // Nothing moved: the sentence stops rather than saying "0 lien".
    expect(
      told(
        facts({
          entityType: 'Person',
          action: 'MERGE',
          before: { mergedName: 'Marie DUBOIS' },
          after: { keptName: 'Marie DUBOIS', events: 0, relationships: 0 },
        }),
      ).sentence,
    ).toBe('a fusionné Marie DUBOIS dans Marie DUBOIS');
  });

  it('names a member by their account, and not at all once it is erased', () => {
    const change = {
      entityType: 'TreeMember',
      action: 'UPDATE',
      summary: 'Rôle modifié : Contributeur → Éditeur',
      before: { role: 'CONTRIBUTOR', userId: 'u1' },
      after: { role: 'EDITOR', userId: 'u1' },
    };
    expect(told(facts({ ...change, subjectName: 'Léa' }))).toEqual({
      sentence: 'a changé le rôle de Léa : contributeur → éditeur',
      changes: [],
    });
    expect(told(facts({ ...change, subjectName: 'Émile' })).sentence).toBe(
      'a changé le rôle d’Émile : contributeur → éditeur',
    );
    expect(told(facts({ ...change, subjectName: null })).sentence).toBe(
      'a changé le rôle d’un ancien membre : contributeur → éditeur',
    );
  });

  it('tells joining and leaving from the member’s side', () => {
    expect(
      told(facts({ entityType: 'TreeMember', action: 'CREATE', after: { role: 'VIEWER' } }))
        .sentence,
    ).toBe('a rejoint l’arbre comme lecteur');
    expect(
      told(facts({ entityType: 'TreeMember', action: 'DELETE', summary: 'A quitté l’arbre' }))
        .sentence,
    ).toBe('a quitté l’arbre');
  });

  it('tells the tree’s own changes: settings, and every export', () => {
    expect(
      told(
        facts({
          entityType: 'Tree',
          action: 'UPDATE',
          before: { visibility: 'PRIVATE', redactLivingPeople: true },
          after: { visibility: 'LINK', redactLivingPeople: false },
        }),
      ).changes,
    ).toEqual([
      { field: 'lecture', before: 'membres seulement', after: 'par lien' },
      { field: 'vivants masqués aux visiteurs', before: 'oui', after: 'non' },
    ]);
    expect(
      told(
        facts({ entityType: 'Tree', action: 'EXPORT', after: { format: 'GEDCOM 7', people: 42 } }),
      ).sentence,
    ).toBe('a exporté l’arbre au format GEDCOM (42 personnes)');
  });

  it('tells the same revision in English', () => {
    const merge = facts({
      entityType: 'Person',
      action: 'MERGE',
      before: { mergedName: 'Jean CHASSAIGNE' },
      after: { keptName: 'Jean CHASSAGNE', events: 2, relationships: 1 },
    });
    expect(describeRevision(merge, english).sentence).toBe(
      'merged Jean CHASSAIGNE into Jean CHASSAGNE — 2 events, 1 link carried over',
    );

    const marriage = facts({
      entityType: 'Event',
      action: 'CREATE',
      after: { type: 'MARRIAGE', date: '1902', participants: ['Jean ROUX', 'Anne BRUN'] },
    });
    expect(describeRevision(marriage, english).sentence).toBe(
      'added the event “Marriage” of Jean ROUX and Anne BRUN (1902)',
    );

    // The elision belongs to French: English takes the name as it is.
    const roleChange = facts({
      entityType: 'TreeMember',
      action: 'UPDATE',
      subjectName: 'Émile',
      before: { role: 'CONTRIBUTOR' },
      after: { role: 'EDITOR' },
    });
    expect(describeRevision(roleChange, french, 'fr').sentence).toBe(
      'a changé le rôle d’Émile : contributeur → éditeur',
    );
    expect(describeRevision(roleChange, english, 'en').sentence).toBe(
      'changed the role of Émile: contributor → editor',
    );
  });

  it('falls back on the stored summary for what it cannot tell', () => {
    expect(
      told(
        facts({
          entityType: 'TreeInvitation',
          action: 'CREATE',
          summary: 'Invitation envoyée (Contributeur)',
          after: { role: 'CONTRIBUTOR' },
        }),
      ),
    ).toEqual({ sentence: '— Invitation envoyée (Contributeur)', changes: [] });
  });
});
