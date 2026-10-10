'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { ResearchFinding } from '@/server/research';

/**
 * What the dates say, filterable by how much it matters.
 *
 * "Impossible" first, because it means a date is wrong somewhere; "à
 * vérifier" next; "à noter" last. The filter is a set of toggle buttons
 * rather than a select so the counts are visible before anyone clicks.
 */

type Filter = 'ALL' | ResearchFinding['severity'];

const TONE: Record<ResearchFinding['severity'], string> = {
  ERROR: 'text-danger border-danger/30 bg-danger/10',
  WARNING: 'text-warning border-warning/30 bg-warning/10',
  INFO: 'text-text-muted border-border-subtle bg-surface-1/50',
};

export function FindingsPanel({
  treeSlug,
  findings,
}: {
  treeSlug: string;
  findings: readonly ResearchFinding[];
}) {
  const t = useTranslations('research.findings');
  const severity = useTranslations('findings.severity');
  const [filter, setFilter] = useState<Filter>('ALL');

  const counts = useMemo(() => {
    const result: Record<Filter, number> = { ALL: findings.length, ERROR: 0, WARNING: 0, INFO: 0 };
    for (const finding of findings) result[finding.severity] += 1;
    return result;
  }, [findings]);

  const shown = filter === 'ALL' ? findings : findings.filter((f) => f.severity === filter);

  if (findings.length === 0) {
    return <p className="text-text-muted text-sm">{t('none')}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label={t('filter')} className="flex flex-wrap gap-2">
        {(['ALL', 'ERROR', 'WARNING', 'INFO'] as const).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            disabled={key !== 'ALL' && counts[key] === 0}
            onClick={() => setFilter(key)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors duration-[var(--duration-fast)] disabled:cursor-default disabled:opacity-40 ${
              filter === key
                ? 'border-accent bg-accent/10 text-text-primary'
                : 'border-border-default text-text-muted hover:text-text-primary'
            }`}
          >
            {key === 'ALL' ? t('all') : severity(key)}{' '}
            <span className="text-text-faint tabular-nums">{counts[key]}</span>
          </button>
        ))}
      </div>

      <ul className="flex flex-col gap-1.5">
        {shown.map((finding, index) => (
          <li
            key={`${finding.code}-${finding.personId ?? 'tree'}-${index}`}
            className={`research-row flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-[var(--radius-md)] border px-3 py-2 text-sm ${TONE[finding.severity]}`}
            style={{ animationDelay: `${Math.min(index, 12) * 25}ms` }}
          >
            <span className="shrink-0 text-xs tracking-wide uppercase">
              {severity(finding.severity)}
            </span>
            <span className="min-w-0 flex-1">{finding.message}</span>
            {finding.personId ? (
              <Link
                href={`/app/${treeSlug}/personnes/${finding.personId}`}
                className="text-accent hover:text-accent-hover shrink-0 text-xs"
              >
                {t('open')}
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
