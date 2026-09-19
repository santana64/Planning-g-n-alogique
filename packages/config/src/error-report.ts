/**
 * What an error report may carry off the server.
 *
 * Sentry receives the error's type and where it was thrown — the stack — and
 * nothing else. Not the request (URLs name trees and people, bodies carry
 * transcriptions), not the user, not the breadcrumbs (console lines), and not
 * the message: a database error quotes the value it refused, and that value
 * can be a living person's name or birth date. The same rule as the logs,
 * applied to the one channel that leaves the instance.
 *
 * Pure, so what is removed is tested rather than trusted.
 */

interface ReportedException {
  type?: string;
  value?: string;
}

/** The fields this touches; everything else on an event passes through. */
export interface ReportedEvent {
  request?: unknown;
  user?: unknown;
  breadcrumbs?: unknown;
  extra?: unknown;
  message?: unknown;
  exception?: { values?: ReportedException[] };
}

export function scrubErrorReport<E extends ReportedEvent>(event: E): E {
  delete event.request;
  delete event.user;
  delete event.breadcrumbs;
  delete event.extra;
  delete event.message;
  for (const exception of event.exception?.values ?? []) {
    exception.value = exception.type ?? 'Error';
  }
  return event;
}
