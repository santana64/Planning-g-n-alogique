'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { IDLE, type ActionState } from '@/server/action-state';
import { createRelationshipAction, deleteRelationshipAction } from '@/server/person-actions';
import type { PersonLinkRow } from '@/server/people';
import { Field, Select, SubmitButton, TextInput } from './fields';
import { PersonPicker } from './person-picker';

/**
 * The relationship editor.
 *
 * Direction is the whole difficulty. "Parent" and "child" are the same edge
 * read from two ends, and a UI that asks for "relation" and a person has
 * already lost the information — so the control asks the question from the
 * subject's point of view ("X est le parent de…" / "X est l'enfant de…") and
 * builds the directed edge from that. The database stores one direction; the
 * screen never makes the user work out which.
 *
 * A refusal is shown with its reasons, because "impossible" without "because
 * Y is already your ancestor" leaves the user to guess which of two people is
 * wrong.
 */

const PARENT_KINDS = [
  'PARENT_BIOLOGICAL',
  'PARENT_ADOPTIVE',
  'PARENT_FOSTER',
  'PARENT_STEP',
  'PARENT_GUARDIAN',
  'PARENT_UNKNOWN',
] as const;

const PEER_KINDS = ['SPOUSE', 'PARTNER', 'DIVORCED_PARTNER', 'SIBLING', 'OTHER'] as const;

type Stance = 'PARENT_OF' | 'CHILD_OF' | 'PEER';

const STANCES = ['PARENT_OF', 'CHILD_OF', 'PEER'] as const;

export function RelationshipEditor({
  treeSlug,
  personId,
  personName,
  links,
  canEdit,
  canDelete,
}: {
  treeSlug: string;
  personId: string;
  personName: string;
  links: readonly PersonLinkRow[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const t = useTranslations('relationshipEditor');
  const types = useTranslations('relationships');
  const [createState, createAction, creating] = useActionState<ActionState, FormData>(
    createRelationshipAction,
    IDLE,
  );
  const [deleteState, deleteAction] = useActionState<ActionState, FormData>(
    deleteRelationshipAction,
    IDLE,
  );
  const [stance, setStance] = useState<Stance>('PARENT_OF');

  const parents = links.filter((link) => link.direction === 'CHILD');
  const children = links.filter((link) => link.direction === 'PARENT');
  const peers = links.filter((link) => link.direction === 'PEER');
  const kinds = (stance === 'PEER' ? PEER_KINDS : PARENT_KINDS).map(
    (code) => [code, t(`kinds.${code}`)] as const,
  );
  const typeLabel = (type: string): string => (types.has(type) ? types(type) : type);

  return (
    <div className="flex flex-col gap-6">
      <LinkGroup
        title={t('parents')}
        links={parents}
        treeSlug={treeSlug}
        canDelete={canDelete}
        action={deleteAction}
        typeLabel={typeLabel}
      />
      <LinkGroup
        title={t('children')}
        links={children}
        treeSlug={treeSlug}
        canDelete={canDelete}
        action={deleteAction}
        typeLabel={typeLabel}
      />
      <LinkGroup
        title={t('peers')}
        links={peers}
        treeSlug={treeSlug}
        canDelete={canDelete}
        action={deleteAction}
        typeLabel={typeLabel}
      />

      {deleteState.status === 'error' && deleteState.message ? (
        <p
          role="status"
          className="text-danger border-danger/30 bg-danger/10 rounded-[var(--radius-md)] border px-3 py-2 text-sm"
        >
          {deleteState.message}
        </p>
      ) : null}

      {canEdit ? (
        <form
          action={createAction}
          className="border-border-subtle bg-surface-1/40 flex flex-col gap-4 rounded-[var(--radius-md)] border p-4"
        >
          <h3 className="font-editorial text-text-primary text-base">{t('addLink')}</h3>

          <p className="text-text-secondary text-sm">
            <span className="text-text-primary font-medium">{personName}</span>{' '}
            <select
              aria-label={t('direction')}
              value={stance}
              onChange={(event) => setStance(event.target.value as Stance)}
              className="border-border-default bg-surface-1 text-text-primary rounded-[var(--radius-sm)] border px-2 py-1"
            >
              {STANCES.map((value) => (
                <option key={value} value={value}>
                  {t(`stance.${value}`)}
                </option>
              ))}
            </select>
          </p>

          <input type="hidden" name="treeSlug" value={treeSlug} />
          {/* The directed edge is assembled here from the sentence above, so
           * the user never has to know which end the database calls source. */}
          <input
            type="hidden"
            name={stance === 'CHILD_OF' ? 'targetId' : 'sourceId'}
            value={personId}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <PersonPicker
              allowCreate
              key={stance}
              name={stance === 'CHILD_OF' ? 'sourceId' : 'targetId'}
              label={stance === 'CHILD_OF' ? t('theParent') : t('theOtherPerson')}
              treeSlug={treeSlug}
              excludeId={personId}
            />

            <Field id="type" label={t('kind')}>
              <Select
                id="type"
                name="type"
                options={kinds}
                defaultValue={stance === 'PEER' ? 'SPOUSE' : 'PARENT_BIOLOGICAL'}
              />
            </Field>

            {stance === 'PEER' ? (
              <>
                <Field id="startDate" label={t('start')}>
                  <TextInput id="startDate" name="startDate" placeholder={t('startPlaceholder')} />
                </Field>
                <Field id="endDate" label={t('end')}>
                  <TextInput id="endDate" name="endDate" placeholder={t('endPlaceholder')} />
                </Field>
              </>
            ) : null}
          </div>

          {createState.status !== 'idle' && createState.message ? (
            <p
              role="status"
              className={`rounded-[var(--radius-md)] border px-3 py-2 text-sm ${
                createState.status === 'error'
                  ? 'text-danger border-danger/30 bg-danger/10'
                  : 'text-success border-success/30 bg-success/10'
              }`}
            >
              {createState.message}
            </p>
          ) : null}

          {createState.warnings && createState.warnings.length > 0 ? (
            <ul className="border-warning/30 bg-warning/10 flex flex-col gap-1 rounded-[var(--radius-md)] border px-3 py-2">
              {createState.warnings.map((warning) => (
                <li key={warning} className="text-warning text-sm">
                  {warning}
                </li>
              ))}
            </ul>
          ) : null}

          <SubmitButton pending={creating}>{t('create')}</SubmitButton>
        </form>
      ) : null}
    </div>
  );
}

function LinkGroup({
  title,
  links,
  treeSlug,
  canDelete,
  action,
  typeLabel,
}: {
  title: string;
  links: readonly PersonLinkRow[];
  treeSlug: string;
  canDelete: boolean;
  action: (formData: FormData) => void;
  typeLabel: (type: string) => string;
}) {
  const t = useTranslations('relationshipEditor');
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-text-faint text-xs tracking-wide uppercase">{title}</h3>
      {links.length === 0 ? (
        <p className="text-text-faint text-sm">{t('none')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {links.map((link) => (
            <li
              key={link.relationshipId}
              className="border-border-subtle flex items-center justify-between gap-3 border-b py-1.5 last:border-b-0"
            >
              <span className="flex items-baseline gap-2">
                {link.otherRedacted ? (
                  <span className="text-text-muted italic">{link.otherName}</span>
                ) : (
                  <Link
                    href={`/app/${treeSlug}/personnes/${link.otherId}`}
                    className="text-text-primary hover:text-accent"
                  >
                    {link.otherName}
                  </Link>
                )}
                <span className="text-text-faint text-xs">{typeLabel(link.type)}</span>
              </span>

              {canDelete ? (
                <form action={action}>
                  <input type="hidden" name="treeSlug" value={treeSlug} />
                  <input type="hidden" name="relationshipId" value={link.relationshipId} />
                  <button type="submit" className="text-text-faint hover:text-danger text-xs">
                    {t('remove')}
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
