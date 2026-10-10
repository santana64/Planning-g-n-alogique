import type { MailMessage } from './sender';

/**
 * The three messages the application sends.
 *
 * Written like the rest of the product: sober, saying exactly what happened
 * and what to do — in French, or in English for a reader who uses the
 * product in English. No logo, no tracking pixel, no marketing
 * footer — a message about someone's family archive is not a campaign.
 *
 * Each one carries the link as plain text as well as a link, because mail
 * clients mangle both in turn; and each says what to do when the message was
 * not expected, which is the only useful thing to say to someone whose
 * address was typed by mistake.
 *
 * Every interpolated value is escaped in the HTML part: a tree called
 * `<script>` is a perfectly legal tree name.
 */

const PRODUCT = 'Chronolignée';

/** The languages a message can be written in. */
export type MailLocale = 'fr' | 'en';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * A plain, readable HTML body: one column, system fonts, nothing to load.
 * `safeParagraphs` must already be HTML-safe — anything coming from a user
 * (a tree name, a member's name) goes through `escapeHtml` first.
 */
function html(
  safeParagraphs: readonly string[],
  action: { label: string; url: string },
  locale: MailLocale,
): string {
  const body = safeParagraphs.map((text) => `    <p>${text}</p>`).join('\n');
  const safeUrl = escapeHtml(action.url);
  return `<!doctype html>
<html lang="${locale}">
  <body style="font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; line-height: 1.55; color: #1f2430; max-width: 34rem">
${body}
    <p><a href="${safeUrl}" style="color: #8a5a12">${escapeHtml(action.label)}</a></p>
    <p style="color: #5a6072; font-size: 0.875rem">${
      locale === 'en'
        ? 'If the link does not work, copy this address into your browser:'
        : 'Si le lien ne fonctionne pas, copiez cette adresse dans votre navigateur :'
    }<br />${safeUrl}</p>
  </body>
</html>`;
}

export function passwordResetMessage(input: {
  readonly to: string;
  readonly url: string;
  readonly validForHours: number;
  readonly locale?: MailLocale;
}): MailMessage {
  if (input.locale === 'en') {
    const hours = `${input.validForHours} hour${input.validForHours > 1 ? 's' : ''}`;
    const validityEn = `This link is valid for ${hours} and works only once.`;
    const ignore =
      'If you did not ask for this, ignore this message: your password does not change.';
    return {
      to: input.to,
      subject: `${PRODUCT} — reset your password`,
      text: [
        'You asked to change the password of your Chronolignée account.',
        '',
        'Open this link to choose a new one:',
        input.url,
        '',
        validityEn,
        ignore,
      ].join('\n'),
      html: html(
        ['You asked to change the password of your Chronolignée account.', validityEn, ignore],
        { label: 'Choose a new password', url: input.url },
        'en',
      ),
    };
  }
  const validity = `Ce lien est valable ${input.validForHours} heure${input.validForHours > 1 ? 's' : ''} et ne sert qu'une fois.`;
  return {
    to: input.to,
    subject: `${PRODUCT} — réinitialiser votre mot de passe`,
    text: [
      'Vous avez demandé à changer le mot de passe de votre compte Chronolignée.',
      '',
      'Ouvrez ce lien pour en choisir un nouveau :',
      input.url,
      '',
      validity,
      "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe ne change pas.",
    ].join('\n'),
    html: html(
      [
        'Vous avez demandé à changer le mot de passe de votre compte Chronolignée.',
        validity,
        "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe ne change pas.",
      ],
      { label: 'Choisir un nouveau mot de passe', url: input.url },
      'fr',
    ),
  };
}

export function emailVerificationMessage(input: {
  readonly to: string;
  readonly url: string;
  readonly locale?: MailLocale;
}): MailMessage {
  if (input.locale === 'en') {
    const ignore =
      'If you did not create an account, ignore this message: no account will be usable with this address.';
    return {
      to: input.to,
      subject: `${PRODUCT} — confirm your address`,
      text: [
        'Welcome to Chronolignée.',
        '',
        'Confirm this address to activate your account:',
        input.url,
        '',
        ignore,
      ].join('\n'),
      html: html(
        ['Welcome to Chronolignée.', 'Confirm this address to activate your account.', ignore],
        { label: 'Confirm my address', url: input.url },
        'en',
      ),
    };
  }
  return {
    to: input.to,
    subject: `${PRODUCT} — confirmez votre adresse`,
    text: [
      'Bienvenue sur Chronolignée.',
      '',
      'Confirmez cette adresse pour activer votre compte :',
      input.url,
      '',
      "Si vous n'avez pas créé de compte, ignorez ce message : aucun compte ne sera utilisable avec cette adresse.",
    ].join('\n'),
    html: html(
      [
        'Bienvenue sur Chronolignée.',
        'Confirmez cette adresse pour activer votre compte.',
        "Si vous n'avez pas créé de compte, ignorez ce message : aucun compte ne sera utilisable avec cette adresse.",
      ],
      { label: 'Confirmer mon adresse', url: input.url },
      'fr',
    ),
  };
}

export function treeInvitationMessage(input: {
  readonly to: string;
  readonly url: string;
  readonly treeName: string;
  readonly inviterName: string;
  readonly roleLabel: string;
  readonly validForDays: number;
  readonly locale?: MailLocale;
}): MailMessage {
  if (input.locale === 'en') {
    const openingEn = `${input.inviterName} invites you to join the tree “${input.treeName}” on Chronolignée, as ${input.roleLabel.toLowerCase()}.`;
    const validityEn = `The invitation is for this address only, once, for ${input.validForDays} days.`;
    const ignore = 'If this invitation is not for you, ignore this message.';
    return {
      to: input.to,
      subject: `${PRODUCT} — invitation to “${input.treeName}”`,
      text: [openingEn, '', 'Open this link to accept:', input.url, '', validityEn, ignore].join(
        '\n',
      ),
      html: html(
        [escapeHtml(openingEn), escapeHtml(validityEn), ignore],
        { label: 'Accept the invitation', url: input.url },
        'en',
      ),
    };
  }
  const opening = `${input.inviterName} vous invite à rejoindre l'arbre « ${input.treeName} » sur Chronolignée, comme ${input.roleLabel.toLowerCase()}.`;
  const validity = `L'invitation vaut pour cette adresse seulement, une fois, pendant ${input.validForDays} jours.`;
  return {
    to: input.to,
    subject: `${PRODUCT} — invitation à « ${input.treeName} »`,
    text: [
      opening,
      '',
      'Ouvrez ce lien pour accepter :',
      input.url,
      '',
      validity,
      'Si cette invitation ne vous concerne pas, ignorez ce message.',
    ].join('\n'),
    html: html(
      [
        escapeHtml(opening),
        escapeHtml(validity),
        'Si cette invitation ne vous concerne pas, ignorez ce message.',
      ],
      { label: "Accepter l'invitation", url: input.url },
      'fr',
    ),
  };
}
