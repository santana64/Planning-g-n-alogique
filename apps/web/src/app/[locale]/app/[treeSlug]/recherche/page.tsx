import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { can } from '@chronolignee/domain';
import { TreeNav } from '@/components/people/tree-nav';
import { FindingsPanel } from '@/components/research/findings-panel';
import { TaskBoard } from '@/components/research/task-board';
import { Link } from '@/i18n/navigation';
import { loadResearchDesk } from '@/server/research';

/** Dynamic, because it reads the database on every request. */
export const dynamic = 'force-dynamic';

export default async function ResearchPage({
  params,
}: {
  params: Promise<{ locale: string; treeSlug: string }>;
}) {
  const { locale, treeSlug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('research');

  const desk = await loadResearchDesk(treeSlug);
  if (!desk) notFound();
  const { access } = desk;
  const canEdit = can(access.role, 'contribute');

  const openTasks = desk.tasks.filter(
    (task) => task.status !== 'RESOLVED' && task.status !== 'ABANDONED',
  ).length;
  const problems = desk.findings.filter((f) => f.severity !== 'INFO').length;

  const summary = [
    {
      id: 'anomalies',
      label: t('summary.findings'),
      value: problems,
      tone: problems > 0 ? 'text-warning' : 'text-success',
    },
    {
      id: 'sans-source',
      label: t('summary.unsourced'),
      value: desk.unsourcedTotal,
      tone: desk.unsourcedTotal > 0 ? 'text-text-primary' : 'text-success',
    },
    {
      id: 'contestees',
      label: t('summary.contested'),
      value: desk.contested.length,
      tone: 'text-text-primary',
    },
    { id: 'pistes', label: t('summary.tasks'), value: openTasks, tone: 'text-accent' },
  ];

  return (
    <main id="main" className="bg-surface-0 min-h-dvh px-6 py-10">
      <div className="mx-auto flex max-w-[var(--content-max)] flex-col gap-10">
        <TreeNav
          treeSlug={treeSlug}
          treeName={access.treeName}
          role={access.role}
          current="research"
        />

        <div className="rise flex flex-col gap-2">
          <h1 className="font-editorial text-text-primary text-3xl tracking-tight">{t('title')}</h1>
          <p className="text-text-muted max-w-2xl text-sm">{t('lead')}</p>
        </div>

        <nav aria-label={t('summary.label')} className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {summary.map((item, index) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className="rise border-border-subtle bg-surface-1/60 hover:border-border-strong hover:bg-surface-1 flex flex-col gap-1 rounded-[var(--radius-lg)] border p-4 transition-colors duration-[var(--duration-fast)]"
              style={{ ['--delay' as string]: `${80 + index * 60}ms` }}
            >
              <span className={`font-editorial text-3xl tabular-nums ${item.tone}`}>
                {item.value}
              </span>
              <span className="text-text-muted text-xs">{item.label}</span>
            </a>
          ))}
        </nav>

        <section
          id="anomalies"
          aria-labelledby="anomalies-title"
          className="flex scroll-mt-6 flex-col gap-4"
        >
          <SectionTitle
            id="anomalies-title"
            title={t('findings.title')}
            lead={t('findings.lead')}
          />
          <FindingsPanel treeSlug={treeSlug} findings={desk.findings} />
        </section>

        <section
          id="sans-source"
          aria-labelledby="unsourced-title"
          className="flex scroll-mt-6 flex-col gap-4"
        >
          <SectionTitle
            id="unsourced-title"
            title={t('unsourced.title')}
            lead={t('unsourced.lead')}
          />
          {desk.unsourced.length === 0 ? (
            <p className="text-success text-sm">{t('unsourced.none')}</p>
          ) : (
            <>
              <ul className="divide-border-subtle border-border-subtle divide-y rounded-[var(--radius-lg)] border">
                {desk.unsourced.map((fact) => (
                  <li
                    key={`${fact.kind}-${fact.id}`}
                    className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-2.5 text-sm"
                  >
                    <span className="text-text-primary">{fact.label}</span>
                    {fact.detail ? <span className="text-text-muted">{fact.detail}</span> : null}
                    <span className="ml-auto flex flex-wrap gap-x-3">
                      {fact.people.map((person) => (
                        <Link
                          key={person.id}
                          href={`/app/${treeSlug}/personnes/${person.id}`}
                          className="text-accent hover:text-accent-hover text-xs"
                        >
                          {person.name}
                        </Link>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
              {desk.unsourcedTotal > desk.unsourced.length ? (
                <p className="text-text-faint text-xs">
                  {t('unsourced.more', {
                    shown: desk.unsourced.length,
                    total: desk.unsourcedTotal,
                  })}
                </p>
              ) : null}
              <p className="text-text-faint text-xs">
                {t.rich('unsourced.how', {
                  archive: (chunks) => (
                    <Link
                      href={`/app/${treeSlug}/archives`}
                      className="text-accent underline underline-offset-2"
                    >
                      {chunks}
                    </Link>
                  ),
                })}
              </p>
            </>
          )}
        </section>

        <section
          id="contestees"
          aria-labelledby="contested-title"
          className="flex scroll-mt-6 flex-col gap-4"
        >
          <SectionTitle
            id="contested-title"
            title={t('contested.title')}
            lead={t('contested.lead')}
          />
          {desk.contested.length === 0 ? (
            <p className="text-text-muted text-sm">{t('contested.none')}</p>
          ) : (
            <ul className="grid gap-2 md:grid-cols-2">
              {desk.contested.map((claim) => (
                <li
                  key={claim.id}
                  className="border-border-subtle bg-surface-0 flex flex-col gap-1 rounded-[var(--radius-md)] border px-4 py-3 text-sm shadow-[var(--shadow-low)]"
                >
                  <span className="text-text-faint text-xs">{claim.label}</span>
                  <span className="text-text-primary">{claim.value}</span>
                  {claim.note ? (
                    <span className="text-text-muted text-xs">{claim.note}</span>
                  ) : null}
                  <Link
                    href={`/app/${treeSlug}/personnes/${claim.personId}`}
                    className="text-accent hover:text-accent-hover self-start text-xs"
                  >
                    {claim.personName}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          id="pistes"
          aria-labelledby="tasks-title"
          className="flex scroll-mt-6 flex-col gap-4"
        >
          <SectionTitle id="tasks-title" title={t('tasks.title')} lead={t('tasks.lead')} />
          <TaskBoard
            treeSlug={treeSlug}
            tasks={desk.tasks}
            people={desk.people}
            canEdit={canEdit}
          />
        </section>
      </div>
    </main>
  );
}

function SectionTitle({ id, title, lead }: { id: string; title: string; lead: string }) {
  return (
    <div className="border-border-subtle flex flex-col gap-1 border-b pb-2">
      <h2 id={id} className="font-editorial text-text-primary text-xl tracking-tight">
        {title}
      </h2>
      <p className="text-text-muted text-sm">{lead}</p>
    </div>
  );
}
