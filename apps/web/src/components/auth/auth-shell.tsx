import { Link } from '@/i18n/navigation';

/**
 * Frame shared by sign-in and sign-up.
 *
 * Two columns on wide screens: the form on the left, and on the right a quiet
 * statement of what the product is for. The right column is not a marketing
 * panel — it is the one place where someone deciding whether to trust this
 * with their family's research can read what happens to that research.
 */
export function AuthShell({
  title,
  aside,
  children,
}: {
  title: string;
  aside: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main id="main" className="bg-surface-0 min-h-dvh">
      <div className="mx-auto grid min-h-dvh max-w-[var(--content-max)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col justify-center px-6 py-14 sm:px-12">
          <Link
            href="/"
            className="font-editorial text-text-muted hover:text-text-primary mb-12 inline-block text-lg tracking-tight transition-colors duration-[var(--duration-fast)]"
          >
            Chronolignée
          </Link>

          <h1 className="font-editorial text-text-primary text-[length:var(--text-3xl)] leading-tight tracking-[-0.02em]">
            {title}
          </h1>

          <div className="mt-8 max-w-sm">{children}</div>
        </div>

        {/* Hidden below lg rather than stacked: on a phone this content would
            push the form below the fold, and the form is why anyone is here. */}
        <aside className="border-border-subtle bg-surface-sunken hidden flex-col justify-center border-l px-12 py-14 lg:flex">
          {aside}
        </aside>
      </div>
    </main>
  );
}
