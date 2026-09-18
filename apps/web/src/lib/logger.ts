import 'server-only';
import pino from 'pino';
import { env } from './env';

/**
 * The server log.
 *
 * Structured, and redacted by path as a second line of defence. The first
 * line is not logging private things at all — call sites pass ids, counts and
 * durations, never a transcription, a name or a date. The redaction list is
 * for the day someone passes a whole object without looking at what is in it.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'web' },
  redact: {
    paths: [
      'text',
      '*.text',
      'transcription',
      '*.transcription',
      'quotation',
      '*.quotation',
      'evidence',
      '*.evidence',
      'displayName',
      '*.displayName',
      'password',
      '*.password',
      'token',
      '*.token',
      'apiKey',
      '*.apiKey',
      'headers.authorization',
      'headers.cookie',
    ],
    censor: '[redacted]',
  },
});
