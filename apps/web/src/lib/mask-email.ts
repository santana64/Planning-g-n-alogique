/**
 * An address, shown just enough to be recognised.
 *
 * The invitation page tells whoever holds the link which account it was
 * meant for. Whoever holds it may not be that person — links get forwarded —
 * so the page says "c•••@exemple.fr", which its owner recognises and a
 * stranger learns little from.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '•••';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return `${local.slice(0, 1)}•••@${domain}`;
}

/**
 * A path to return to after signing in, or null.
 *
 * Only the application's own invitation, tree and account paths. Anything else — an
 * absolute URL, `//evil.example`, a backslash — would turn the sign-in page
 * into an open redirect that sends a fresh session wherever a link says.
 */
export function safeReturnPath(value: string | null | undefined): string | null {
  if (!value || value.length > 300) return null;
  return /^\/(?:invitation|app|compte)(?:\/[A-Za-z0-9_-]+)*\/?$/.test(value) ? value : null;
}
