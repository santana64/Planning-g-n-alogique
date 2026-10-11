'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { IDLE, type ActionState } from '@/server/action-state';
import { acceptProposalAction, rejectProposalAction } from '@/server/proposal-actions';
import type { ProposalRow } from '@/server/proposals';
import { PersonPicker } from '@/components/people/person-picker';

/**
 * Deciding, one statement at a time.
 *
 * Each proposal is shown with the words it was read from, beside the value it
 * proposes, so the reviewer compares the claim to its evidence rather than to
 * their memory. There is no "accept all": a batch accept would turn review
 * into a formality, and the whole point of the proposal step is that it is
 * not one.
 *
 * The model's confidence is shown as what it is — the model's own opinion of
 * itself. It is never a reason to skip reading the evidence.
 */

export function ProposalReview({
  treeSlug,
  rows,
  showSubject,
}: {
  treeSlug: string;
  rows: readonly ProposalRow[];
  /** On the tree-wide page each row says whom it is about. */
  showSubject: boolean;
}) {
  // The rows as they were when the reviewer started, plus any that arrive
  // later — never fewer. Each decision revalidates the page, and the server
  // then sends the list without the proposal just decided. Rendering that
  // list as is would drop the decided item and pull the next one up into its
  // place, under the reviewer's cursor: a second click meant to confirm would
  // accept a different statement. So decided items stay where they were,
  // showing their outcome, until the reviewer leaves the page.
  const t = useTranslations('proposals');
  const [initial] = useState(rows);
  const known = new Set(initial.map((row) => row.proposalId));
  const shown = [...initial, ...rows.filter((row) => !known.has(row.proposalId))];

  if (shown.length === 0) {
    return <p className="text-text-faint text-sm">{t('none')}</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {shown.map((row) => (
        <li key={row.proposalId}>
          <ProposalItem treeSlug={treeSlug} row={row} showSubject={showSubject} />
        </li>
      ))}
    </ul>
  );
}

function ProposalItem({
  treeSlug,
  row,
  showSubject,
}: {
  treeSlug: string;
  row: ProposalRow;
  showSubject: boolean;
}) {
  const [acceptState, acceptAction, accepting] = useActionState<ActionState, FormData>(
    acceptProposalAction,
    IDLE,
  );
  const [rejectState, rejectAction, rejecting] = useActionState<ActionState, FormData>(
    rejectProposalAction,
    IDLE,
  );
  const t = useTranslations('proposals');
  const predicateLabel = t.has(`predicates.${row.predicate}`)
    ? t(`predicates.${row.predicate}`)
    : row.predicate;
  const [editing, setEditing] = useState(false);
  const [rejectingOpen, setRejectingOpen] = useState(false);

  const decided = acceptState.status === 'success' || rejectState.status === 'success';
  const error =
    acceptState.status === 'error'
      ? acceptState.message
      : rejectState.status === 'error'
        ? rejectState.message
        : null;

  if (decided) {
    return (
      <p
        role="status"
        className="text-text-muted border-border-subtle rounded-[var(--radius-md)] border border-dashed px-3 py-2 text-sm"
      >
        {predicateLabel} — {row.valueText} :{' '}
        {acceptState.status === 'success' ? acceptState.message : rejectState.message}
      </p>
    );
  }

  return (
    <article
      aria-label={t('rowLabel', { predicate: predicateLabel, value: row.valueText })}
      className="border-border-default bg-surface-1/60 flex flex-col gap-3 rounded-[var(--radius-md)] border p-3"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="flex flex-wrap items-baseline gap-2">
          <span className="text-text-faint text-xs tracking-wide uppercase">{predicateLabel}</span>
          <span className="font-editorial text-text-primary text-base">{row.valueText}</span>
          {showSubject ? (
            <span className="text-text-muted text-xs">
              {row.personName
                ? t('about', { name: row.personName })
                : t('unlinked', { name: row.subjectName })}
            </span>
          ) : null}
        </p>
        <span className="text-text-faint text-xs">
          {t('proposedBy', { reader: row.readBy ?? t('byRules') })}
          {row.modelConfidence !== null
            ? t('declaredConfidence', { percent: Math.round(row.modelConfidence * 100) })
            : ''}
        </span>
      </header>

      {/* The words the value was read from, in the register's own spelling.
       * This is what the reviewer is actually judging. */}
      <blockquote className="border-source/50 text-text-secondary border-l-2 pl-3 text-sm italic">
        « {row.evidence} »
        {row.sourceTitle ? (
          <footer className="text-text-faint mt-1 text-xs not-italic">
            {row.sourceTitle}
            {row.locator ? `, ${row.locator}` : ''}
          </footer>
        ) : null}
      </blockquote>

      <form action={acceptAction} className="flex flex-col gap-3">
        <input type="hidden" name="treeSlug" value={treeSlug} />
        <input type="hidden" name="proposalId" value={row.proposalId} />

        {row.personId ? null : (
          // The record names someone the tree could not match without
          // guessing. The reviewer says who, or rejects.
          <PersonPicker
            allowCreate
            name="personId"
            label={t('whoIs', { name: row.subjectName })}
            treeSlug={treeSlug}
            excludeId=""
          />
        )}

        {editing ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`edit-${row.proposalId}`} className="text-text-secondary text-sm">
              {t('correctedValue')}
            </label>
            <input
              id={`edit-${row.proposalId}`}
              name="editedValue"
              defaultValue={row.valueText}
              className="border-border-default bg-surface-1 text-text-primary focus:border-accent rounded-[var(--radius-md)] border px-3 py-2 focus:outline-none"
            />
            <p className="text-text-faint text-xs">{t('correctedNote')}</p>
          </div>
        ) : null}

        {error ? (
          <p role="status" className="text-danger text-sm">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={accepting || rejecting}
            className="bg-accent text-accent-contrast hover:bg-accent-hover rounded-[var(--radius-md)] px-3 py-1.5 text-sm font-medium transition-colors duration-[var(--duration-fast)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {accepting ? t('saving') : editing ? t('acceptCorrection') : t('accept')}
          </button>
          {editing ? null : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-text-muted hover:text-text-primary text-sm"
            >
              {t('correctThenAccept')}
            </button>
          )}
          <button
            type="button"
            onClick={() => setRejectingOpen((current) => !current)}
            className="text-text-muted hover:text-danger text-sm"
          >
            {t('reject')}
          </button>
        </div>
      </form>

      {rejectingOpen ? (
        <form action={rejectAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="treeSlug" value={treeSlug} />
          <input type="hidden" name="proposalId" value={row.proposalId} />
          <div className="flex min-w-60 flex-1 flex-col gap-1.5">
            <label htmlFor={`note-${row.proposalId}`} className="text-text-secondary text-sm">
              {t('why')} <span className="text-text-faint">{t('optional')}</span>
            </label>
            <input
              id={`note-${row.proposalId}`}
              name="note"
              placeholder={t('whyPlaceholder')}
              className="border-border-default bg-surface-1 text-text-primary focus:border-accent rounded-[var(--radius-md)] border px-3 py-2 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={rejecting || accepting}
            className="border-danger/40 text-danger hover:bg-danger/10 rounded-[var(--radius-md)] border px-3 py-1.5 text-sm disabled:opacity-60"
          >
            {rejecting ? t('saving') : t('confirmReject')}
          </button>
        </form>
      ) : null}
    </article>
  );
}
