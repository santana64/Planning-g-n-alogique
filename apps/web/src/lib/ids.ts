/**
 * Whether a value from a URL or a form can be an id at all.
 *
 * Checked before the value reaches a query: the database refuses a malformed
 * uuid with an error, and an address like /personnes/not-a-uuid answered a
 * 500 — a server failure — where it is simply a page that does not exist.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID.test(value);
}
