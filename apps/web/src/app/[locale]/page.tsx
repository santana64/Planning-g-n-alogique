import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { OpeningTimeline } from '@/components/landing/opening-timeline';

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('landing');

  const pillars = ['time', 'evidence', 'uncertainty'] as const;

  return (
    <main id="main" className="bg-surface-0 relative min-h-dvh overflow-hidden">
      {/* A single soft light from above, the way a reading-room lamp falls on a
          table. Purely atmospheric, so it is marked decorative and disappears
          under prefers-reduced-motion policies that strip non-essentials. */}
      <div
        aria-hidden="true"
        data-motion="decorative"
        className="pointer-events-none absolute inset-x-0 top-0 h-[60vh]"
        style={{
          background:
            'radial-gradient(ellipse 80% 55% at 50% -10%, var(--accent-primary-muted), transparent 70%)',
          opacity: 0.22,
        }}
      />

      <header className="relative z-10 mx-auto flex max-w-[var(--content-max)] items-center justify-between px-6 py-5">
        <span className="font-editorial text-text-primary text-lg tracking-tight">
          {t('title')}
        </span>
        <Link
          href="/sign-in"
          className="border-border-default text-text-secondary hover:border-border-strong hover:text-text-primary rounded-[var(--radius-md)] border px-3.5 py-1.5 text-sm transition-colors duration-[var(--duration-fast)]"
        >
          {t('signIn')}
        </Link>
      </header>

      <section className="relative z-10 mx-auto max-w-[var(--content-max)] px-6 pt-10 pb-4 sm:pt-16">
        <h1
          className="rise font-editorial text-text-primary text-[length:var(--text-display)] leading-[0.95] tracking-[-0.03em]"
          style={{ '--delay': '0.15s' } as React.CSSProperties}
        >
          {t('title')}
        </h1>

        <p
          className="rise text-text-secondary mt-5 max-w-2xl text-lg sm:text-xl"
          style={{ '--delay': '0.35s' } as React.CSSProperties}
        >
          {t('subtitle')}
        </p>

        <p
          className="rise text-text-muted mt-4 max-w-2xl text-pretty"
          style={{ '--delay': '0.5s' } as React.CSSProperties}
        >
          {t('lead')}
        </p>

        <div
          className="rise mt-9 flex flex-wrap items-center gap-3"
          style={{ '--delay': '0.65s' } as React.CSSProperties}
        >
          <Link
            href="/sign-up"
            className="bg-accent text-accent-contrast hover:bg-accent-hover rounded-[var(--radius-md)] px-5 py-2.5 font-medium shadow-[var(--shadow-mid)] transition-colors duration-[var(--duration-fast)]"
          >
            {t('cta')}
          </Link>
          <Link
            href="/demo"
            className="border-border-default text-text-secondary hover:border-border-strong hover:text-text-primary rounded-[var(--radius-md)] border px-5 py-2.5 transition-colors duration-[var(--duration-fast)]"
          >
            {t('ctaSecondary')}
          </Link>
        </div>
      </section>

      {/* The core idea, shown rather than described: lives as intervals, with
          relationships between them, and edges that admit what is not known. */}
      <section className="relative z-10 mx-auto mt-10 max-w-[var(--content-max)] px-6 sm:mt-14">
        <OpeningTimeline />
      </section>

      <section className="relative z-10 mx-auto mt-16 max-w-[var(--content-max)] px-6 pb-24">
        <div className="border-border-subtle bg-border-subtle grid gap-px overflow-hidden rounded-[var(--radius-lg)] border sm:grid-cols-3">
          {pillars.map((key, index) => (
            <article
              key={key}
              className="rise bg-surface-1 p-6"
              style={{ '--delay': `${1.5 + index * 0.12}s` } as React.CSSProperties}
            >
              <h2 className="font-editorial text-text-primary text-lg">
                {t(`pillars.${key}.title`)}
              </h2>
              <p className="text-text-muted mt-2 text-sm leading-relaxed">
                {t(`pillars.${key}.body`)}
              </p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
