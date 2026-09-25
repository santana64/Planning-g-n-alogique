import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { EraseAccount } from '@/components/account/erase-account';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { Link, redirect } from '@/i18n/navigation';
import { loadAccount } from '@/server/account';
import { getAIStatus } from '@/server/ai';

/** Dynamic, because it reads the database on every request. */
export const dynamic = 'force-dynamic';

export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const account = await loadAccount();
  if (!account) {
    redirect({ href: { pathname: '/sign-in', query: { next: '/compte' } }, locale });
    return null;
  }
  const t = await getTranslations('account');
  const common = await getTranslations('common');
  // Each name in its own quotation marks, as the language sets them.
  const named = (trees: readonly { name: string }[]): string =>
    trees.map((tree) => common('quoted', { value: tree.name })).join(', ');
  const format = await getFormatter();
  const ai = getAIStatus();
  const { plan } = account;

  return (
    <main id="main" className="bg-surface-0 min-h-dvh px-6 py-14">
      <div className="mx-auto flex max-w-2xl flex-col gap-10">
        <Link href="/app" className="text-text-faint hover:text-accent text-sm">
          ← {t('myTrees')}
        </Link>

        <div className="flex flex-col gap-1">
          <h1 className="font-editorial text-text-primary text-3xl tracking-tight">{t('title')}</h1>
          <p className="text-text-muted text-sm">
            {t('identity', {
              name: account.name,
              email: account.email,
              date: format.dateTime(new Date(account.createdAt), {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              }),
            })}
          </p>
        </div>

        <section aria-labelledby="data-heading" className="flex flex-col gap-3">
          <h2 id="data-heading" className="text-text-faint text-xs tracking-wide uppercase">
            {t('myData')}
          </h2>
          <p className="text-text-secondary text-sm">{t('myDataLong')}</p>
          {/* A plain anchor: this is a download, not a page to prefetch. */}
          <a
            href="/api/account/export"
            download
            className="text-accent self-start text-sm underline underline-offset-2"
          >
            {t('download')}
          </a>
        </section>

        <section aria-labelledby="ai-heading" className="flex flex-col gap-3">
          <h2 id="ai-heading" className="text-text-faint text-xs tracking-wide uppercase">
            {t('automaticReading')}
          </h2>
          {ai.enabled ? (
            <p className="text-text-secondary text-sm">
              {t('readerConfigured', { label: ai.label })}{' '}
              {ai.sendsDataExternally ? t('sendsOut') : t('staysHere')}
            </p>
          ) : (
            <p className="text-text-secondary text-sm">{t('aiOff')}</p>
          )}
        </section>

        <section
          aria-labelledby="erase-heading"
          className="border-danger/30 flex flex-col gap-4 rounded-[var(--radius-lg)] border p-5"
        >
          <h2 id="erase-heading" className="text-danger text-xs tracking-wide uppercase">
            {t('deleteAccount')}
          </h2>

          {plan.blocking.length > 0 ? (
            <div className="flex flex-col gap-2 text-sm">
              <p className="text-text-secondary">{t('blocking')}</p>
              <ul className="flex flex-col gap-1">
                {plan.blocking.map((tree) => (
                  <li key={tree.treeId}>
                    <Link
                      href={`/app/${tree.slug}/partage`}
                      className="text-accent underline underline-offset-2"
                    >
                      {tree.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <>
              <div className="text-text-secondary flex flex-col gap-2 text-sm">
                <p>{t('erasePlan')}</p>
                {plan.erasedWithAccount.length > 0 ? (
                  <p>{t('erasedWith', { trees: named(plan.erasedWithAccount) })}</p>
                ) : null}
                {plan.left.length > 0 ? <p>{t('treesLeft', { trees: named(plan.left) })}</p> : null}
              </div>

              {account.freshSession ? (
                <EraseAccount email={account.email} />
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-text-muted text-sm">{t('freshSession')}</p>
                  <SignOutButton label={t('signInAgain')} returnTo="/sign-in?next=/compte" />
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
