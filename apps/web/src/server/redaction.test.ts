import { describe, expect, it } from 'vitest';
import { REDACTED_LABEL, redactPerson, type RedactablePerson } from './redaction';

const CLAIRE: RedactablePerson & { readonly personId: string; readonly row: number } = {
  personId: 'claire',
  row: 7,
  displayName: 'Claire CHASSAGNE',
  isLiving: true,
  birthLabel: '12 mars 1962',
  deathLabel: '—',
  lifespanLabel: '1962 –',
  earliestJdn: 2_437_736,
  latestJdn: 2_461_303,
  birthEarliestJdn: 2_437_736,
  birthLatestJdn: 2_437_736,
  deathEarliestJdn: null,
  deathLatestJdn: null,
  startCertainty: 'EXACT',
  endCertainty: 'INFERRED',
  redacted: false,
};

describe('redactPerson', () => {
  it('leaves a visible person untouched', () => {
    expect(redactPerson(CLAIRE, false)).toBe(CLAIRE);
  });

  it('keeps nothing that dates, names or explains a hidden person', () => {
    const hidden = redactPerson(CLAIRE, true);
    expect(hidden).toEqual({
      personId: 'claire',
      row: 7,
      displayName: REDACTED_LABEL,
      isLiving: false,
      birthLabel: '—',
      deathLabel: '—',
      lifespanLabel: '',
      earliestJdn: null,
      latestJdn: null,
      birthEarliestJdn: null,
      birthLatestJdn: null,
      deathEarliestJdn: null,
      deathLatestJdn: null,
      startCertainty: 'UNKNOWN',
      endCertainty: 'UNKNOWN',
      redacted: true,
    });
  });

  it('hides the recorded sex of a hidden person, and adds none to a record without one', () => {
    expect(redactPerson({ ...CLAIRE, sex: 'FEMALE' as const }, true).sex).toBe('UNKNOWN');
    expect('sex' in redactPerson(CLAIRE, true)).toBe(false);
  });

  it('leaves no trace of the birth year anywhere in the serialised record', () => {
    const serialised = JSON.stringify(redactPerson(CLAIRE, true));
    expect(serialised).not.toContain('1962');
    expect(serialised).not.toContain('Claire');
    expect(serialised).not.toContain(String(CLAIRE.birthEarliestJdn));
  });
});
