import { getTranslations } from 'next-intl/server';
import type { AtAgeRow } from '@chronolignee/genealogy';
import { Link } from '@/i18n/navigation';

/**
 * The same birthday, a generation apart, as a table: a comparison is read
 * across a row and down a column, which is what a table is for.
 */
export async function AtAgeTable({
  treeSlug,
  rows,
  age,
}: {
  treeSlug: string;
  rows: readonly AtAgeRow[];
  age: number;
}) {
  const t = await getTranslations('statistics.atAge');
  const unknown = <span className="text-text-faint">—</span>;
  const yesNo = (value: boolean | null) => (value === null ? unknown : value ? t('yes') : t('no'));

  return (
    <div className="border-border-subtle overflow-x-auto rounded-[var(--radius-lg)] border">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{t('caption', { age })}</caption>
        <thead className="bg-surface-1 text-text-secondary">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">
              {t('who')}
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              {t('year', { age })}
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              {t('alive')}
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              {t('married')}
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              {t('children')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={row.personId}
              className="research-row border-border-subtle border-t"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <th scope="row" className="px-4 py-2 font-normal">
                <span className="text-text-faint mr-2 text-xs">
                  {t(`generation.${Math.min(row.generation, 4)}`)}
                </span>
                <Link
                  href={`/app/${treeSlug}/personnes/${row.personId}`}
                  className="text-text-primary hover:text-accent font-editorial"
                >
                  {row.name}
                </Link>
              </th>
              <td className="text-text-secondary px-4 py-2 tabular-nums">{row.year ?? unknown}</td>
              <td className="text-text-secondary px-4 py-2">{yesNo(row.alive)}</td>
              <td className="text-text-secondary px-4 py-2">{yesNo(row.married)}</td>
              <td className="text-text-secondary px-4 py-2 tabular-nums">
                {row.year === null ? unknown : row.children}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
