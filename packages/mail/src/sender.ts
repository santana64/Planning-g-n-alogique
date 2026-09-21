import { createTransport, type Transporter } from 'nodemailer';

/**
 * Sending mail, behind one interface.
 *
 * Three things a family instance needs from this and nothing more: send a
 * message, say whether sending is possible at all, and never — under any
 * circumstance — write a link or a token anywhere but in the message itself.
 * A reset link in a log file is a password in a log file.
 *
 * `createMailSender` returns **null** when no transport is configured, the
 * same shape the AI provider uses: the caller then decides what "no mail"
 * looks like on its screen, rather than offering a button that fails.
 */

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  /** Plain text. Always present: it is what a text-only reader receives. */
  readonly text: string;
  /** Optional HTML, which must say exactly the same thing. */
  readonly html?: string;
}

export interface MailSender {
  /** For logs and for the account page: a transport, never an address. */
  readonly label: string;
  send(message: MailMessage): Promise<void>;
  /** Checks the transport answers, for the readiness probe. */
  verify(): Promise<void>;
  close(): Promise<void>;
}

export type MailTransport = 'none' | 'smtp';

export interface MailConfig {
  readonly transport: MailTransport;
  /** `smtp://user:password@host:port` or `smtps://…`. */
  readonly smtpUrl?: string | undefined;
  /** The `From:` of every message, e.g. `Chronolignée <archives@example.org>`. */
  readonly from: string;
}

class SmtpMailSender implements MailSender {
  readonly label: string;
  private readonly transporter: Transporter;

  constructor(
    private readonly from: string,
    smtpUrl: string,
  ) {
    const url = new URL(smtpUrl);
    // The host, never the credentials: this string reaches logs and screens.
    this.label = `SMTP ${url.hostname}:${url.port || (url.protocol === 'smtps:' ? '465' : '587')}`;
    this.transporter = createTransport(smtpUrl, { from });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    });
  }

  async verify(): Promise<void> {
    await this.transporter.verify();
  }

  async close(): Promise<void> {
    this.transporter.close();
  }
}

export function createMailSender(config: MailConfig): MailSender | null {
  if (config.transport === 'none') return null;
  if (!config.smtpUrl) throw new Error('MAIL_TRANSPORT=smtp requires SMTP_URL');
  return new SmtpMailSender(config.from, config.smtpUrl);
}
