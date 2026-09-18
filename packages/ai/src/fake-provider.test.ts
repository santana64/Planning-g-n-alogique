import { describe, expect, it } from 'vitest';
import { FakeAIProvider } from './fake-provider';
import { evidenceOccursIn } from './extraction';
import { ExtractionError, MAX_TRANSCRIPTION_CHARS } from './provider';

/**
 * The test double.
 *
 * It is what CI and the end-to-end suite run against, so its behaviour has
 * to be exactly predictable — and every statement it makes has to survive the
 * same evidence check a real model's output does.
 */

const BIRTH_ACT =
  "L'an mil huit cent vingt-deux, le douze juin, est comparu Pierre Chassagne, tonnelier, lequel nous a présenté un enfant du sexe masculin, né le 12 juin 1822 à Tours, fils de Pierre Chassagne et de Marie Lefèvre.";

describe('reading a birth act', () => {
  it('finds the birth date, normalised to GEDCOM', async () => {
    const result = await new FakeAIProvider().extract({
      text: BIRTH_ACT,
      subjectHint: 'Jean-Baptiste CHASSAGNE',
    });
    const birth = result.facts.find((fact) => fact.predicate === 'BIRTH_DATE');
    expect(birth?.valueText).toBe('12 juin 1822');
    expect(birth?.normalised).toBe('12 JUN 1822');
    // Attributed to the person whose page this came from.
    expect(birth?.subjectName).toBe('Jean-Baptiste CHASSAGNE');
  });

  it('finds the place, the sex and both parents', async () => {
    const result = await new FakeAIProvider().extract({ text: BIRTH_ACT });
    const byPredicate = (predicate: string) =>
      result.facts.filter((fact) => fact.predicate === predicate).map((fact) => fact.valueText);

    expect(byPredicate('BIRTH_PLACE')).toEqual(['Tours']);
    expect(byPredicate('PARENT')).toEqual(['Pierre Chassagne', 'Marie Lefèvre']);
    expect(result.facts.find((fact) => fact.predicate === 'RECORDED_SEX')?.normalised).toBe('MALE');
  });

  it('attributes an occupation to the person named with it', async () => {
    const result = await new FakeAIProvider().extract({ text: BIRTH_ACT });
    const trade = result.facts.find((fact) => fact.predicate === 'OCCUPATION');
    // The father's trade, not the child's.
    expect(trade?.subjectName).toBe('Pierre Chassagne');
    expect(trade?.valueText).toBe('tonnelier');
  });

  it('quotes only words that are in the source', async () => {
    const result = await new FakeAIProvider().extract({ text: BIRTH_ACT });
    for (const fact of result.facts) {
      expect(evidenceOccursIn(fact.evidence, BIRTH_ACT), fact.evidence).toBe(true);
    }
    expect(result.discarded).toBe(0);
  });

  it('says what it is on every result', async () => {
    const result = await new FakeAIProvider().extract({ text: BIRTH_ACT });
    // Nobody should mistake a regular expression for a reading.
    expect(result.provenance.provider).toBe('fake');
    expect(result.provenance.model).toBe('rules-fr-1');
    expect(result.caveats.some((caveat) => caveat.includes('expressions régulières'))).toBe(true);
  });

  it('is deterministic', async () => {
    const provider = new FakeAIProvider();
    const first = await provider.extract({ text: BIRTH_ACT });
    const second = await provider.extract({ text: BIRTH_ACT });
    expect(second).toEqual(first);
  });
});

describe('what it cannot read', () => {
  it('reads a death as a death', async () => {
    const result = await new FakeAIProvider().extract({
      text: 'Marie Lefèvre, veuve, décédée le 3 mars 1889 en son domicile.',
      subjectHint: 'Marie LEFÈVRE',
    });
    expect(result.documentKind).toBe('DEATH_ACT');
    expect(result.facts.find((fact) => fact.predicate === 'DEATH_DATE')?.normalised).toBe(
      '3 MAR 1889',
    );
  });

  it('proposes nothing from text it does not recognise, and says so', async () => {
    const result = await new FakeAIProvider().extract({ text: 'Liste des objets du grenier.' });
    expect(result.facts).toEqual([]);
    expect(result.caveats[0]).toContain('Aucune formule reconnue');
  });

  it('does not pretend to convert a Republican date', async () => {
    // "4 germinal an VII" has digits and a month name that is not in the
    // Gregorian list. Reading "4 germinal" as the 4th of some month would be
    // exactly the plausible fabrication this whole pipeline exists to stop.
    const result = await new FakeAIProvider().extract({
      text: 'né le 4 germinal an VII à Tours',
    });
    expect(result.facts.find((fact) => fact.predicate === 'BIRTH_DATE')).toBeUndefined();
  });

  it('refuses an empty transcription', async () => {
    await expect(new FakeAIProvider().extract({ text: '   ' })).rejects.toMatchObject({
      code: 'EMPTY',
    });
  });

  it('refuses a transcription longer than one record could be', async () => {
    const error = await new FakeAIProvider()
      .extract({ text: 'x'.repeat(MAX_TRANSCRIPTION_CHARS + 1) })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ExtractionError);
    expect((error as ExtractionError).code).toBe('TOO_LONG');
  });

  it('never sends anything anywhere', () => {
    expect(new FakeAIProvider().sendsDataExternally).toBe(false);
  });
});
