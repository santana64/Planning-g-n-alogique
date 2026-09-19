import { describe, expect, it } from 'vitest';
import { scrubErrorReport } from './error-report';

describe('scrubErrorReport', () => {
  it('keeps what was thrown and where, and nothing that could name anyone', () => {
    const scrubbed = scrubErrorReport({
      level: 'error',
      request: { url: '/app/famille-chassagne/personnes/…', cookies: 'session=…' },
      user: { email: 'claire@exemple.fr', ip_address: '192.0.2.1' },
      breadcrumbs: [{ message: 'console: Claire CHASSAGNE, née le 3 mars 1962' }],
      extra: { form: 'Claire' },
      message: 'Claire CHASSAGNE',
      exception: {
        values: [
          {
            type: 'PrismaClientKnownRequestError',
            value: 'Unique constraint failed on the value "Claire CHASSAGNE"',
            stacktrace: { frames: [{ filename: 'person.ts', lineno: 42 }] },
          },
        ],
      },
    });

    expect(scrubbed).toEqual({
      level: 'error',
      exception: {
        values: [
          {
            type: 'PrismaClientKnownRequestError',
            value: 'PrismaClientKnownRequestError',
            stacktrace: { frames: [{ filename: 'person.ts', lineno: 42 }] },
          },
        ],
      },
    });
    expect(JSON.stringify(scrubbed)).not.toContain('Claire');
  });
});
