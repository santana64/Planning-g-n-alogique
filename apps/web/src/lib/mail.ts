import 'server-only';
import { createMailSender } from '@chronolignee/mail';
import { env } from './env';
import { logger } from './logger';
import { maskEmail } from './mask-email';

/**
 * The instance's mail sender, or null when it cannot send.
 *
 * Built once per process. Everything that offers to send a message asks this
 * first: with no transport, the password reset and the address confirmation
 * are **absent** rather than broken, and an invitation rests on its link.
 */
export const mailSender = createMailSender({
  transport: env.MAIL_TRANSPORT,
  smtpUrl: env.SMTP_URL,
  from: env.MAIL_FROM,
});

export const mailEnabled = mailSender !== null;

/**
 * Send, and record that it happened — never what it said.
 *
 * A reset link is a password: it goes in the message and nowhere else. The
 * log keeps the kind of message, a masked address and whether it left, which
 * is what someone asking "did my invitation go out?" needs.
 */
export async function sendMail(
  kind: 'password-reset' | 'email-verification' | 'tree-invitation',
  message: { to: string; subject: string; text: string; html?: string },
): Promise<boolean> {
  if (!mailSender) return false;
  try {
    await mailSender.send(message);
    logger.info({ event: 'mail.sent', kind, to: maskEmail(message.to) }, 'mail sent');
    return true;
  } catch (error) {
    logger.error(
      {
        event: 'mail.failed',
        kind,
        to: maskEmail(message.to),
        error: error instanceof Error ? error.name : typeof error,
      },
      'mail could not be sent',
    );
    return false;
  }
}
