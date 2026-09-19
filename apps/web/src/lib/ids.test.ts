import { describe, expect, it } from 'vitest';
import { isUuid } from './ids';

describe('isUuid', () => {
  it('accepts the ids the database hands out', () => {
    expect(isUuid('01a0b9d0-3c7c-7114-b054-4f798af032b6')).toBe(true);
  });

  it('refuses anything a query would choke on', () => {
    for (const value of [
      'not-a-uuid',
      '',
      ' 01a0b9d0-3c7c-7114-b054-4f798af032b6',
      null,
      undefined,
    ]) {
      expect(isUuid(value)).toBe(false);
    }
  });
});
