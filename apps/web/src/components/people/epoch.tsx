import { getFormatter, getTranslations } from 'next-intl/server';
import { periodLabel } from '@/components/timeline/period';
import type { EpochEvent } from '@/server/epoch';

/**
 * "Son époque": the history a life ran through, as a thread with an age on
 * each knot — "19 ans : Prise de la Bastille". The major events are shown;
 * the rest are one click away, so a life of eighty years does not read as a
 * history textbook.
 */
export async function Epoch({ events, name }: { events: readonly EpochEvent[]; name: string }) {
  if (events.length === 0) return null;
  const t = await getTranslations('person.epoch');
  const history = await getTranslations('timeline.history');
  const format = await getFormatter();
  const major = events.filter((event) => event.significance >= 3);
  const minor = events.filter((event) => event.significance < 3);

  const item = (event: EpochEvent, index: number) => (
    <li
      key={event.id}
      className="research-row relative flex gap-3 pb-4 last:pb-0"
      style={{ animationDelay: `${Math.min(index, 14) * 45}ms` }}
    >
      <span
        aria-hidden="true"
        className="relative z-10 mt-1 h-3 w-3 shrink-0 rounded-full ring-4 ring-[var(--surface-0)]"
        style={{ background: `var(--hist-${event.category.toLowerCase()})` }}
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-text-faint text-[11px] tracking-wide uppercase">
          {event.bornDuring
            ? t('beforeBirth')
            : event.age !== null
              ? t('atAge', { age: event.age })
              : periodLabel(event.startJdn, event.startJdn, format)}
          <span className="ml-2 tracking-normal normal-case">
            {history(`categories.${event.category}`)}
          </span>
        </p>
        <p className="font-editorial text-text-primary text-[15px] leading-snug">{event.title}</p>
        <p className="text-text-muted text-xs tabular-nums">
          {periodLabel(event.startJdn, event.endJdn, format)}
        </p>
        {event.summary ? <p className="text-text-secondary text-xs">{event.summary}</p> : null}
      </div>
    </li>
  );

  return (
    <section aria-labelledby="epoch-title" className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 id="epoch-title" className="text-text-faint text-xs tracking-wide uppercase">
          {t('title')}
        </h2>
        <p className="text-text-muted text-xs">{t('lead', { name, count: events.length })}</p>
      </div>
      <ol className="before:bg-border-default relative flex flex-col before:absolute before:top-2 before:bottom-2 before:left-[5px] before:w-px">
        {major.map(item)}
      </ol>
      {minor.length > 0 ? (
        <details className="group">
          <summary className="text-text-muted hover:text-text-primary cursor-pointer text-xs select-none">
            {t('more', { count: minor.length })}
          </summary>
          <ol className="before:bg-border-default relative mt-3 flex flex-col before:absolute before:top-2 before:bottom-2 before:left-[5px] before:w-px">
            {minor.map(item)}
          </ol>
        </details>
      ) : null}
      <p className="text-text-faint text-[11px]">{t('caveat')}</p>
    </section>
  );
}
