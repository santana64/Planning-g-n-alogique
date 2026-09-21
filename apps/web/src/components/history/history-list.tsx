import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import type { HistoryLine } from '@/server/history';

/** The reader's own calendar, not the product's. */
const formatters = (locale: string) => ({
  day: new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Paris',
  }),
  time: new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  }),
});

/**
 * The history, grouped by day.
 *
 * A server component: the lines are already filtered for this reader, and
 * nothing here needs the browser.
 */
export async function HistoryList({
  treeSlug,
  lines,
  linkPeople = true,
}: {
  treeSlug: string;
  lines: readonly HistoryLine[];
  /** Off on a record page, where every line is about the record being read. */
  linkPeople?: boolean;
}) {
  const t = await getTranslations('history');
  const { day: DAY, time: TIME } = formatters(await getLocale());

  if (lines.length === 0) {
    return <p className="text-text-faint text-sm">{t('noChange')}</p>;
  }

  const days = new Map<string, HistoryLine[]>();
  for (const line of lines) {
    const day = DAY.format(new Date(line.at));
    days.set(day, [...(days.get(day) ?? []), line]);
  }

  return (
    <div className="flex flex-col gap-6">
      {[...days.entries()].map(([day, dayLines]) => (
        <section key={day} className="flex flex-col gap-2">
          <h3 className="text-text-faint text-xs tracking-wide uppercase">{day}</h3>
          <ol className="flex flex-col">
            {dayLines.map((line) => (
              <li
                key={line.id}
                className="border-border-subtle flex flex-col gap-1 border-b py-2 last:border-b-0"
              >
                <p className="text-sm">
                  <time dateTime={line.at} className="text-text-faint tabular mr-2">
                    {TIME.format(new Date(line.at))}
                  </time>
                  <span className="text-text-primary font-medium">{line.author}</span>{' '}
                  <span className="text-text-secondary">{line.sentence}</span>
                  {linkPeople && line.personId ? (
                    <>
                      {' '}
                      <Link
                        href={`/app/${treeSlug}/personnes/${line.personId}`}
                        className="text-accent text-xs underline underline-offset-2"
                      >
                        {t('seeRecord')}
                      </Link>
                    </>
                  ) : null}
                </p>
                {line.changes.length > 0 ? (
                  <ul className="text-text-muted flex flex-col gap-0.5 pl-12 text-xs">
                    {line.changes.map((change) => (
                      <li key={change.field}>
                        {change.field} :{' '}
                        {change.before !== null ? (
                          <>
                            <span className="line-through decoration-1">{change.before}</span>
                            {change.after !== null ? ' → ' : ` ${t('removed')}`}
                          </>
                        ) : null}
                        {change.after !== null ? (
                          <span className="text-text-secondary">{change.after}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
