import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMailSender, passwordResetMessage, type MailSender } from '../src/index';

/**
 * Sending, for real, through the transport the application uses.
 *
 * Against Mailpit from docker-compose: a genuine SMTP server that keeps
 * every message instead of delivering it. What is proven here is what a unit
 * test cannot — that the transport connects, that the message leaves, and
 * that what arrives carries the link in both its parts.
 */

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // CI injects the variables directly.
}

const SMTP_URL = process.env['SMTP_URL'] ?? 'smtp://localhost:1025';
/** Mailpit's HTTP API, beside its SMTP port. */
const MAILPIT = process.env['MAILPIT_URL'] ?? 'http://localhost:8025';

interface MailpitMessage {
  readonly ID: string;
  readonly To: ReadonlyArray<{ Address: string }>;
  readonly Subject: string;
}

async function findMessage(to: string): Promise<MailpitMessage> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`,
    );
    if (response.ok) {
      const body = (await response.json()) as { messages?: MailpitMessage[] };
      const found = body.messages?.[0];
      if (found) return found;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`no message for ${to} after 10 s`);
}

let sender: MailSender;
const to = `reset-${Date.now()}@chronolignee.invalid`;

beforeAll(() => {
  const built = createMailSender({
    transport: 'smtp',
    smtpUrl: SMTP_URL,
    from: 'Chronolignée <chronolignee@localhost>',
  });
  if (!built) throw new Error('the SMTP sender did not build');
  sender = built;
});

afterAll(async () => {
  await sender.close();
});

describe('sending through SMTP', () => {
  it('answers when the transport is reachable', async () => {
    await expect(sender.verify()).resolves.not.toThrow();
  });

  it('delivers a reset message that carries its link', async () => {
    const url = 'https://chronolignee.test/mot-de-passe?token=integration-token';
    await sender.send(passwordResetMessage({ to, url, validForHours: 1 }));

    const message = await findMessage(to);
    expect(message.Subject).toContain('réinitialiser');
    expect(message.To[0]?.Address).toBe(to);

    const full = await fetch(`${MAILPIT}/api/v1/message/${message.ID}`);
    const body = (await full.json()) as { Text: string; HTML: string; From: { Address: string } };
    expect(body.Text).toContain(url);
    expect(body.HTML).toContain(url);
    expect(body.From.Address).toBe('chronolignee@localhost');
  });

  it('refuses to build a sender for an unreachable transport only when used', async () => {
    const dead = createMailSender({
      transport: 'smtp',
      smtpUrl: 'smtp://localhost:1',
      from: 'a@b.c',
    });
    // Building never touches the network; verifying does, and fails plainly.
    expect(dead).not.toBeNull();
    await expect(dead?.verify()).rejects.toThrow();
    await dead?.close();
  });
});
