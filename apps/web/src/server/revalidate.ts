import { revalidatePath } from 'next/cache';
import { routing } from '@/i18n/routing';

/**
 * Invalidating what one write actually changed.
 *
 * The route pattern — `/[locale]/app/[treeSlug]` — is tempting and wrong: it
 * matches every tree, so one person adding an ancestor invalidates the cached
 * pages of every other family on the instance. Under concurrent use that is
 * not only wasteful, it is visible: a client-side refresh remounts whatever
 * the other user had on screen, and an in-progress form loses its contents.
 *
 * So: concrete paths, one per locale, for the one tree that changed. The
 * locales come from the routing config rather than a literal list, because
 * adding a third locale must not silently stop revalidating it.
 */
export function revalidateTree(treeSlug: string): void {
  for (const path of treePaths(treeSlug)) {
    revalidatePath(path, 'layout');
  }
}

/** Every URL this tree is served at. `as-needed` leaves the default unprefixed. */
export function treePaths(treeSlug: string): string[] {
  return routing.locales.map((locale) =>
    locale === routing.defaultLocale ? `/app/${treeSlug}` : `/${locale}/app/${treeSlug}`,
  );
}

/**
 * The dashboard, which lists the trees an account belongs to.
 *
 * As a page, not a layout. Every tree lives at `/app/<slug>/…`, so
 * revalidating `/app` as a layout invalidates the whole application beneath
 * it — creating one tree would refresh every other tree's pages for every
 * other user, remounting whatever they had on screen.
 */
export function revalidateDashboard(): void {
  for (const locale of routing.locales) {
    revalidatePath(locale === routing.defaultLocale ? '/app' : `/${locale}/app`, 'page');
  }
}
