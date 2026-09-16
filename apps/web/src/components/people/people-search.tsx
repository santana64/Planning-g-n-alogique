'use client';

import { useEffect, useState, useTransition } from 'react';
import { usePathname, useRouter } from '@/i18n/navigation';

/**
 * The list filter.
 *
 * The query lives in the URL rather than in component state, so a filtered
 * list can be bookmarked, shared with a collaborator, and survives the back
 * button. A research session is not one sitting.
 */
export function PeopleSearch({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(initialQuery);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (value === initialQuery) return;

    const timer = setTimeout(() => {
      const target = value.trim() ? `${pathname}?q=${encodeURIComponent(value.trim())}` : pathname;
      startTransition(() => router.replace(target));
    }, 220);

    return () => {
      clearTimeout(timer);
    };
  }, [value, initialQuery, pathname, router]);

  return (
    <div className="flex items-center gap-3">
      <input
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Chercher un nom…"
        aria-label="Chercher une personne"
        className="border-border-default bg-surface-1 text-text-primary placeholder:text-text-faint hover:border-border-strong focus:border-accent w-full max-w-sm rounded-[var(--radius-md)] border px-3 py-2 transition-colors duration-[var(--duration-fast)] focus:outline-none"
      />
      {/* Accents are folded on both sides, so this is worth saying once rather
       * than leaving the user to discover it by failing to find someone. */}
      <span className="text-text-faint hidden text-xs sm:inline">
        {pending ? 'Recherche…' : 'Les accents et la casse sont ignorés.'}
      </span>
    </div>
  );
}
