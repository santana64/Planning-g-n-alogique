'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { searchTreeAction, type SearchResultItem } from '@/server/search-actions';

/**
 * The command palette.
 *
 * A genealogy is navigated by name, not by menu. Someone working through a
 * parish register has a name in their head and wants the record in front of
 * them, and every click between those two is a click that breaks the thread
 * they were following.
 *
 * Search happens on the server: the trigram index is there, the name folding
 * that matches what was stored is there, and — the part that is not an
 * optimisation — redaction is there. A client-side filter would mean shipping
 * every living person's name to the browser and then hiding it with CSS.
 */

interface Command {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly href: string;
  readonly requiresEdit: boolean;
  /** Importing is an editor's right, not a contributor's. */
  readonly requiresImport?: boolean;
}

export function CommandPalette({
  treeSlug,
  canEdit,
  canImport,
}: {
  treeSlug: string;
  canEdit: boolean;
  canImport: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const requestRef = useRef(0);

  const t = useTranslations('palette');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly SearchResultItem[]>([]);
  const [active, setActive] = useState(0);
  const [searching, setSearching] = useState(false);

  const commands: Command[] = [
    {
      id: 'people',
      label: t('commands.people'),
      hint: t('hints.list'),
      href: `/app/${treeSlug}/personnes`,
      requiresEdit: false,
    },
    {
      id: 'timeline',
      label: t('commands.timeline'),
      hint: t('hints.view'),
      href: `/app/${treeSlug}/chronologie`,
      requiresEdit: false,
    },
    {
      id: 'archive',
      label: t('commands.archive'),
      hint: t('hints.view'),
      href: `/app/${treeSlug}/archives`,
      requiresEdit: false,
    },
    {
      id: 'new',
      label: t('commands.new'),
      hint: t('hints.action'),
      href: `/app/${treeSlug}/personnes/nouvelle`,
      requiresEdit: true,
    },
    {
      id: 'import',
      label: t('commands.import'),
      hint: t('hints.action'),
      href: `/app/${treeSlug}/import`,
      requiresEdit: true,
      requiresImport: true,
    },
  ];

  const visibleCommands = commands.filter(
    (command) =>
      (canEdit || !command.requiresEdit) && (canImport || command.requiresImport !== true),
  );
  const showCommands = query.trim().length < 2;
  const rowCount = showCommands ? visibleCommands.length : results.length;

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setResults([]);
    setActive(0);
    // Focus goes back where it came from. Leaving it on a removed element
    // drops a keyboard user at the top of the document.
    restoreFocusRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const isPaletteShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      if (!isPaletteShortcut) return;
      event.preventDefault();
      restoreFocusRef.current = document.activeElement as HTMLElement | null;
      setOpen((current) => !current);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!open || trimmed.length < 2) return;

    // Every response carries the id of the request that asked for it. Without
    // that, a slow answer for "cha" lands after a fast answer for "chassagne"
    // and replaces the right list with a stale one.
    const ticket = (requestRef.current += 1);
    const timer = setTimeout(() => {
      setSearching(true);
      void searchTreeAction(treeSlug, trimmed).then((items) => {
        if (ticket !== requestRef.current) return;
        setResults(items);
        setActive(0);
        setSearching(false);
      });
    }, 160);

    return () => clearTimeout(timer);
  }, [query, open, treeSlug]);

  function go(index: number) {
    if (showCommands) {
      const command = visibleCommands[index];
      if (!command) return;
      close();
      router.push(command.href);
      return;
    }

    const item = results[index];
    if (!item) return;
    close();
    router.push(
      item.kind === 'PERSON'
        ? `/app/${treeSlug}/personnes/${item.id}`
        : // Places have no page of their own yet, so a place hit filters the
          // person list by that name rather than pretending to navigate.
          `/app/${treeSlug}/personnes?q=${encodeURIComponent(item.label)}`,
    );
  }

  if (!open) return null;

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[12vh]"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('label')}
        className="border-border-default bg-surface-floating w-full max-w-xl overflow-hidden rounded-[var(--radius-lg)] border shadow-[var(--shadow-high)]"
      >
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded
          aria-controls="palette-results"
          aria-activedescendant={rowCount > 0 ? `palette-row-${active}` : undefined}
          aria-label={t('inputLabel')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              close();
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((current) => (rowCount === 0 ? 0 : (current + 1) % rowCount));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((current) => (rowCount === 0 ? 0 : (current - 1 + rowCount) % rowCount));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              go(active);
            }
          }}
          placeholder={t('placeholder')}
          className="text-text-primary placeholder:text-text-faint border-border-subtle w-full border-b bg-transparent px-4 py-3.5 text-base focus:outline-none"
        />

        <ul
          id="palette-results"
          role="listbox"
          aria-label={t('results')}
          className="max-h-80 overflow-y-auto"
        >
          {showCommands
            ? visibleCommands.map((command, index) => (
                <li key={command.id}>
                  <button
                    type="button"
                    id={`palette-row-${index}`}
                    role="option"
                    aria-selected={index === active}
                    onMouseEnter={() => setActive(index)}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      go(index);
                    }}
                    className={`flex w-full items-baseline justify-between gap-4 px-4 py-2.5 text-left ${
                      index === active ? 'bg-surface-2' : ''
                    }`}
                  >
                    <span className="text-text-primary text-sm">{command.label}</span>
                    <span className="text-text-faint text-xs">{command.hint}</span>
                  </button>
                </li>
              ))
            : results.map((item, index) => (
                <li key={`${item.kind}-${item.id}`}>
                  <button
                    type="button"
                    id={`palette-row-${index}`}
                    role="option"
                    aria-selected={index === active}
                    onMouseEnter={() => setActive(index)}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      go(index);
                    }}
                    className={`flex w-full items-baseline justify-between gap-4 px-4 py-2.5 text-left ${
                      index === active ? 'bg-surface-2' : ''
                    }`}
                  >
                    <span className="flex items-baseline gap-2">
                      <span
                        className={
                          item.redacted
                            ? 'text-text-muted font-editorial text-sm italic'
                            : 'text-text-primary font-editorial text-sm'
                        }
                      >
                        {item.label}
                      </span>
                      {/* Said, not hidden: a near-miss presented as a match is
                       * a small lie about what the archive contains. */}
                      {item.approximate ? (
                        <span className="text-source text-xs">{t('approximate')}</span>
                      ) : null}
                      {item.kind === 'PLACE' ? (
                        <span className="text-text-faint text-xs">{t('place')}</span>
                      ) : null}
                    </span>
                    <span className="text-text-muted tabular text-xs">{item.detail}</span>
                  </button>
                </li>
              ))}

          {!showCommands && results.length === 0 ? (
            <li className="text-text-faint px-4 py-6 text-sm">
              {searching ? t('searching') : t('nothing')}
            </li>
          ) : null}
        </ul>

        <p className="border-border-subtle text-text-faint flex gap-4 border-t px-4 py-2 text-xs">
          <span>{t('browse')}</span>
          <span>{t('open')}</span>
          <span>{t('close')}</span>
        </p>
      </div>
    </div>
  );
}
