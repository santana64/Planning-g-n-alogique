/**
 * Reading the mail the application sends.
 *
 * The end-to-end suite runs against Mailpit (docker-compose), a real SMTP
 * server that keeps everything instead of delivering it. A confirmation or a
 * reset link is therefore exercised the way a person receives it — through a
 * message — rather than by calling an endpoint the interface never calls.
 */

const MAILPIT = process.env['MAILPIT_URL'] ?? 'http://localhost:8025';

interface Summary {
  readonly ID: string;
  readonly Subject: string;
}

async function search(to: string): Promise<Summary[]> {
  const response = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
  if (!response.ok) return [];
  const body = (await response.json()) as { messages?: Summary[] };
  return body.messages ?? [];
}

/** The text of the newest message to an address, waiting for it to arrive. */
export async function waitForMail(
  to: string,
  options: { subject?: RegExp; timeoutMs?: number } = {},
): Promise<{ subject: string; text: string }> {
  const deadline = Date.now() + (options.timeoutMs ?? 15_000);
  let seen = '';
  while (Date.now() < deadline) {
    for (const summary of await search(to)) {
      seen = summary.Subject;
      if (options.subject && !options.subject.test(summary.Subject)) continue;
      const full = await fetch(`${MAILPIT}/api/v1/message/${summary.ID}`);
      if (!full.ok) continue;
      const body = (await full.json()) as { Subject: string; Text: string };
      return { subject: body.Subject, text: body.Text };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no message for ${to}${seen ? ` (last subject: ${seen})` : ''}`);
}

/** The first link in the newest message to an address. */
export async function waitForMailLink(
  to: string,
  options: { subject?: RegExp; timeoutMs?: number } = {},
): Promise<string> {
  const message = await waitForMail(to, options);
  const link = /https?:\/\/\S+/.exec(message.text)?.[0];
  if (!link) throw new Error(`no link in the message to ${to}`);
  // Mail clients and this regex both stop at whitespace; a trailing full stop
  // would otherwise become part of the token.
  return link.replace(/[.,)]+$/, '');
}
