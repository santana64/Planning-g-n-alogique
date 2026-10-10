import type { MailLocale } from '@chronolignee/mail';

/**
 * The language of a message sent in answer to a request.
 *
 * The person asking for a password reset or creating an account is the
 * person the message goes to, so the page they asked from says which
 * language they read: an English page has an `/en` prefix, and French — the
 * default — has none. The locale cookie is the fallback for a request whose
 * referrer was withheld. Anything else reads French.
 */
export function localeOfRequest(request: Request | null | undefined): MailLocale {
  if (!request) return 'fr';
  const referrer = request.headers.get('referer');
  if (referrer) {
    try {
      const first = new URL(referrer).pathname.split('/')[1];
      if (first === 'en') return 'en';
      return 'fr';
    } catch {
      // A malformed referrer says nothing; fall through to the cookie.
    }
  }
  const cookie = request.headers.get('cookie') ?? '';
  return /(?:^|;\s*)NEXT_LOCALE=en(?:;|$)/.test(cookie) ? 'en' : 'fr';
}
