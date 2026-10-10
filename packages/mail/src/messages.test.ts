import { describe, expect, it } from 'vitest';
import { emailVerificationMessage, passwordResetMessage, treeInvitationMessage } from './messages';
import { createMailSender } from './sender';

const URL_ = 'https://chronolignee.example/mot-de-passe?token=abc.123-DEF';

describe('the messages', () => {
  it('carries the link in both parts, and says what to do if it was not expected', () => {
    const message = passwordResetMessage({ to: 'x@example.org', url: URL_, validForHours: 1 });
    expect(message.subject).toContain('réinitialiser');
    expect(message.text).toContain(URL_);
    expect(message.html).toContain(URL_);
    expect(message.text).toContain('ignorez ce message');
    expect(message.text).toContain('valable 1 heure');
  });

  it('confirms an address without claiming the account exists', () => {
    const message = emailVerificationMessage({ to: 'x@example.org', url: URL_ });
    expect(message.subject).toContain('confirmez votre adresse');
    expect(message.text).toContain(URL_);
    expect(message.text).toContain("Si vous n'avez pas créé de compte");
  });

  it('escapes a tree name that looks like markup', () => {
    const message = treeInvitationMessage({
      to: 'x@example.org',
      url: URL_,
      treeName: '<script>alert(1)</script>',
      inviterName: 'Marie & Cie',
      roleLabel: 'Contributeur',
      validForDays: 7,
    });
    // The subject and the text part are plain text: the name stays as typed.
    expect(message.subject).toContain('<script>alert(1)</script>');
    expect(message.text).toContain('comme contributeur');
    // The HTML part must not carry a tag or a bare ampersand from the name.
    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;script&gt;');
    expect(message.html).toContain('Marie &amp; Cie');
  });
});

describe('choosing a transport', () => {
  it('returns nothing at all when mail is turned off', () => {
    expect(createMailSender({ transport: 'none', from: 'a@b.c' })).toBeNull();
  });

  it('refuses to pretend it can send without an address to send through', () => {
    expect(() => createMailSender({ transport: 'smtp', from: 'a@b.c' })).toThrow('SMTP_URL');
  });

  it('names the host it will talk to, never the credentials', () => {
    const sender = createMailSender({
      transport: 'smtp',
      from: 'Chronolignée <a@b.c>',
      smtpUrl: 'smtp://someone:hunter2@mail.example.org:1025',
    });
    expect(sender?.label).toBe('SMTP mail.example.org:1025');
    expect(sender?.label).not.toContain('hunter2');
  });
});

describe('messages in the reader’s language', () => {
  const url = 'https://example.test/reset?token=abc';

  it('writes French by default, and English when asked', () => {
    const fr = passwordResetMessage({ to: 'a@example.test', url, validForHours: 1 });
    expect(fr.subject).toBe('Chronolignée — réinitialiser votre mot de passe');
    expect(fr.html).toContain('<html lang="fr">');

    const en = passwordResetMessage({ to: 'a@example.test', url, validForHours: 2, locale: 'en' });
    expect(en.subject).toBe('Chronolignée — reset your password');
    expect(en.text).toContain('This link is valid for 2 hours and works only once.');
    expect(en.text).toContain(url);
    expect(en.html).toContain('<html lang="en">');
    expect(en.html).toContain('If the link does not work');
    expect(en.html).not.toMatch(/Si le lien|mot de passe/);
  });

  it('confirms an address in English', () => {
    const en = emailVerificationMessage({ to: 'a@example.test', url, locale: 'en' });
    expect(en.subject).toBe('Chronolignée — confirm your address');
    expect(en.text.split('\n')).toContain(url);
  });

  it('escapes what a user typed, in either language', () => {
    const en = treeInvitationMessage({
      to: 'a@example.test',
      url,
      treeName: '<script>alert(1)</script>',
      inviterName: 'Ana',
      roleLabel: 'Editor',
      validForDays: 7,
      locale: 'en',
    });
    expect(en.subject).toBe('Chronolignée — invitation to “<script>alert(1)</script>”');
    expect(en.html).not.toContain('<script>');
    expect(en.html).toContain('&lt;script&gt;');
    expect(en.text).toContain('as editor.');
  });
});
