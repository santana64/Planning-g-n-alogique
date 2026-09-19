import { describe, expect, it } from 'vitest';
import { describeRevision, type RevisionFacts } from './history-sentences';

const facts = (partial: Partial<RevisionFacts> & Pick<RevisionFacts, 'entityType' | 'action'>) => ({
  summary: null,
  before: null,
  after: null,
  ...partial,
});

describe('describeRevision', () => {
  it('tells a corrected birth as before and after', () => {
    const described = describeRevision(
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
    const described = describeRevision(
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
    const described = describeRevision(
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
      describeRevision(
        facts({ entityType: 'Event', action: 'UPDATE', summary: 'MARRIAGE corrigé' }),
      ).sentence,
    ).toBe('a corrigé l’événement « Mariage »');
    expect(
      describeRevision(
        facts({
          entityType: 'Relationship',
          action: 'CREATE',
          after: { type: 'PARENT_BIOLOGICAL', source: 'Jean ROUX', target: 'Paul ROUX' },
        }),
      ).sentence,
    ).toBe('a relié Jean ROUX à Paul ROUX (parent biologique)');
    expect(
      describeRevision(
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
      describeRevision(
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
      describeRevision(
        facts({
          entityType: 'Tree',
          action: 'IMPORT',
          after: { people: 4, relationships: 5, events: 6, refused: 0 },
        }),
      ).sentence,
    ).toBe('a importé un fichier GEDCOM : 4 personnes, 5 liens, 6 événements');
  });

  it('names a member by their account, and not at all once it is erased', () => {
    const change = {
      entityType: 'TreeMember',
      action: 'UPDATE',
      summary: 'Rôle modifié : Contributeur → Éditeur',
      before: { role: 'CONTRIBUTOR', userId: 'u1' },
      after: { role: 'EDITOR', userId: 'u1' },
    };
    expect(describeRevision(facts({ ...change, subjectName: 'Léa' }))).toEqual({
      sentence: 'a changé le rôle de Léa : contributeur → éditeur',
      changes: [],
    });
    expect(describeRevision(facts({ ...change, subjectName: 'Émile' })).sentence).toBe(
      'a changé le rôle d’Émile : contributeur → éditeur',
    );
    expect(describeRevision(facts({ ...change, subjectName: null })).sentence).toBe(
      'a changé le rôle d’un ancien membre : contributeur → éditeur',
    );
  });

  it('tells joining and leaving from the member’s side', () => {
    expect(
      describeRevision(
        facts({ entityType: 'TreeMember', action: 'CREATE', after: { role: 'VIEWER' } }),
      ).sentence,
    ).toBe('a rejoint l’arbre comme lecteur');
    expect(
      describeRevision(
        facts({ entityType: 'TreeMember', action: 'DELETE', summary: 'A quitté l’arbre' }),
      ).sentence,
    ).toBe('a quitté l’arbre');
  });

  it('tells the tree’s own changes: settings, and every export', () => {
    expect(
      describeRevision(
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
      describeRevision(
        facts({ entityType: 'Tree', action: 'EXPORT', after: { format: 'GEDCOM 7', people: 42 } }),
      ).sentence,
    ).toBe('a exporté l’arbre au format GEDCOM (42 personnes)');
  });

  it('falls back on the stored summary for what it cannot tell', () => {
    expect(
      describeRevision(
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
