'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

/**
 * When a screen of a tree fails to render.
 *
 * Says what happened in one sentence, offers to try again, and gives a way
 * back to the tree — never the error's message, which can quote a value
 * from someone's record. The digest is shown so a report can be matched to
 * the server's log line without either side seeing the other's data.
 */
export default function TreeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('errors');
  return (
    <main id="main" className="bg-surface-0 flex min-h-dvh items-center justify-center px-6 py-16">
      <div className="page-enter border-border-subtle bg-surface-1/50 flex max-w-md flex-col items-start gap-4 rounded-[var(--radius-lg)] border p-8">
        <span aria-hidden="true" className="text-warning font-editorial text-4xl">
          ⁂
        </span>
        <h1 className="font-editorial text-text-primary text-2xl tracking-tight">{t('title')}</h1>
        <p className="text-text-secondary text-sm">{t('lead')}</p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={reset}
            className="bg-accent text-accent-contrast hover:bg-accent-hover rounded-[var(--radius-md)] px-4 py-2 text-sm font-medium transition-colors duration-[var(--duration-fast)]"
          >
            {t('retry')}
          </button>
          <Link
            href="/app"
            className="border-border-default text-text-secondary hover:border-border-strong hover:text-text-primary rounded-[var(--radius-md)] border px-4 py-2 text-sm transition-colors duration-[var(--duration-fast)]"
          >
            {t('backToTrees')}
          </Link>
        </div>
        {error.digest ? (
          <p className="text-text-faint text-xs">{t('reference', { digest: error.digest })}</p>
        ) : null}
      </div>
    </main>
  );
}
