'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { searchPeopleAction } from '@/server/person-actions';
import type { PersonSummary } from '@/server/people';

/**
 * Choosing a person by name.
 *
 * A `<select>` cannot do this job. Listing every person breaks at a few
 * thousand, and listing the first sixty is worse: it looks complete while
 * being quietly unable to reach anyone else. So the list comes from the
 * server as the user types, which is also the only place that knows how to
 * fold "Lefevre" into the stored "lefevre" — and the only place that can
 * decide not to reveal a living person to a stranger.
 *
 * The chosen id lives in a hidden input, so the surrounding form submits an
 * identifier rather than a name. Two Marie Chassagne born nine years apart is
 * not an edge case in genealogy; it is Tuesday.
 */
export function PersonPicker({
  name,
  label,
  treeSlug,
  excludeId,
}: {
  name: string;
  label: string;
  treeSlug: string;
  excludeId: string;
}) {
  const inputId = useId();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly PersonSummary[]>([]);
  const [chosen, setChosen] = useState<PersonSummary | null>(null);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const requestRef = useRef(0);

  // Whether the query is even worth asking about. Derived rather than stored:
  // clearing results in the effect would set state during the effect that
  // reads them, which is the cascade React warns about.
  const active = !chosen && query.trim().length >= 2;
  const visible = active ? results : [];

  useEffect(() => {
    if (!active) return;

    // Debounced, and every response carries the id of the request that asked
    // for it: without that, a slow answer for "ma" lands after a fast answer
    // for "marie" and replaces the right list with a stale one.
    const ticket = (requestRef.current += 1);
    const timer = setTimeout(() => {
      setSearching(true);
      void searchPeopleAction(treeSlug, query).then((people) => {
        if (ticket !== requestRef.current) return;
        setResults(people.filter((person) => person.personId !== excludeId));
        setSearching(false);
        setOpen(true);
      });
    }, 180);

    return () => {
      clearTimeout(timer);
    };
  }, [query, active, treeSlug, excludeId]);

  return (
    <div className="relative flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-text-secondary text-sm font-medium">
        {label}
      </label>

      <input type="hidden" name={name} value={chosen?.personId ?? ''} />

      <input
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={chosen ? chosen.displayName : query}
        onChange={(event) => {
          setChosen(null);
          setQuery(event.target.value);
        }}
        onFocus={() => setOpen(visible.length > 0)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder="Taper un nom…"
        className="border-border-default bg-surface-1 text-text-primary placeholder:text-text-faint hover:border-border-strong focus:border-accent w-full rounded-[var(--radius-md)] border px-3 py-2 transition-colors duration-[var(--duration-fast)] focus:outline-none"
      />

      {chosen ? (
        <button
          type="button"
          onClick={() => {
            setChosen(null);
            setQuery('');
          }}
          className="text-text-faint hover:text-accent self-start text-xs"
        >
          Changer
        </button>
      ) : active && !searching && visible.length === 0 ? (
        <p className="text-text-faint text-xs">Aucune personne de ce nom dans cet arbre.</p>
      ) : null}

      {open && visible.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          className="border-border-default bg-surface-floating absolute top-full right-0 left-0 z-10 mt-1 max-h-64 overflow-y-auto rounded-[var(--radius-md)] border shadow-[var(--shadow-mid)]"
        >
          {visible.map((person) => (
            <li key={person.personId}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                // onMouseDown, not onClick: the input's blur fires first and
                // would close the list before a click could land.
                onMouseDown={(event) => {
                  event.preventDefault();
                  setChosen(person);
                  setOpen(false);
                }}
                className="hover:bg-surface-2 flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left"
                disabled={person.redacted}
              >
                <span className={person.redacted ? 'text-text-muted italic' : 'text-text-primary'}>
                  {person.displayName}
                </span>
                <span className="text-text-faint tabular text-xs">{person.lifespanLabel}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
