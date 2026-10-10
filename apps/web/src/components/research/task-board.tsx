'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { Field, Select, SubmitButton, TextArea, TextInput } from '@/components/people/fields';
import { IDLE, type ActionState } from '@/server/action-state';
import { createResearchTaskAction, updateResearchTaskAction } from '@/server/research-actions';
import type { ResearchTaskView } from '@/server/research';

/**
 * Research tasks: open questions on top, answered ones below.
 *
 * An answered task stays visible, folded: "searched the 1836 census of
 * Saché, nothing" is the result that saves the next afternoon.
 */

const STATUSES = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'RESOLVED', 'ABANDONED'] as const;
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
const CLOSED = new Set<ResearchTaskView['status']>(['RESOLVED', 'ABANDONED']);

const PRIORITY_TONE: Record<ResearchTaskView['priority'], string> = {
  LOW: 'text-text-faint border-border-subtle',
  NORMAL: 'text-text-muted border-border-default',
  HIGH: 'text-warning border-warning/40',
  URGENT: 'text-danger border-danger/40',
};

const STATUS_DOT: Record<ResearchTaskView['status'], string> = {
  TODO: 'bg-text-faint',
  IN_PROGRESS: 'bg-accent',
  BLOCKED: 'bg-warning',
  RESOLVED: 'bg-success',
  ABANDONED: 'bg-border-strong',
};

export function TaskBoard({
  treeSlug,
  tasks,
  people,
  canEdit,
}: {
  treeSlug: string;
  tasks: readonly ResearchTaskView[];
  people: ReadonlyArray<{ id: string; name: string }>;
  canEdit: boolean;
}) {
  const t = useTranslations('research.tasks');
  const open = tasks.filter((task) => !CLOSED.has(task.status));
  const closed = tasks.filter((task) => CLOSED.has(task.status));

  return (
    <div className="flex flex-col gap-5">
      {canEdit ? <NewTaskForm treeSlug={treeSlug} people={people} /> : null}

      {open.length === 0 ? (
        <p className="text-text-muted text-sm">{t('noneOpen')}</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {open.map((task) => (
            <TaskCard key={task.id} treeSlug={treeSlug} task={task} canEdit={canEdit} />
          ))}
        </ul>
      )}

      {closed.length > 0 ? (
        <details className="group">
          <summary className="text-text-secondary hover:text-text-primary cursor-pointer text-sm select-none">
            {t('closed', { count: closed.length })}
          </summary>
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {closed.map((task) => (
              <TaskCard key={task.id} treeSlug={treeSlug} task={task} canEdit={canEdit} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function TaskCard({
  treeSlug,
  task,
  canEdit,
}: {
  treeSlug: string;
  task: ResearchTaskView;
  canEdit: boolean;
}) {
  const t = useTranslations('research.tasks');
  const router = useRouter();
  const [state, action, pending] = useActionState<ActionState, FormData>(
    updateResearchTaskAction,
    IDLE,
  );
  // The state the form was opened at. A success arriving after it closes the
  // form, derived during render rather than set from an effect.
  const [openedAt, setOpenedAt] = useState<ActionState | null>(null);
  const editing = openedAt !== null && !(state.status === 'success' && state !== openedAt);
  const setEditing = (open: boolean) => setOpenedAt(open ? state : null);

  useEffect(() => {
    if (state.status === 'success') router.refresh();
  }, [state, router]);

  const where = [task.repository, task.callNumber, task.placeLabel].filter(Boolean).join(' · ');

  return (
    <li className="research-row border-border-subtle bg-surface-0 hover:border-border-default flex flex-col gap-2 rounded-[var(--radius-lg)] border p-4 shadow-[var(--shadow-low)] transition-colors duration-[var(--duration-fast)]">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-editorial text-text-primary text-base leading-snug">{task.title}</h3>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${PRIORITY_TONE[task.priority]}`}
        >
          {t(`priority.${task.priority}`)}
        </span>
      </div>

      <p className="text-text-muted inline-flex items-center gap-2 text-xs">
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${STATUS_DOT[task.status]}`} />
        {t(`status.${task.status}`)}
        {task.period ? <span className="text-text-faint">· {task.period}</span> : null}
      </p>

      {task.hypothesis ? <p className="text-text-secondary text-sm">{task.hypothesis}</p> : null}
      {where ? <p className="text-text-faint text-xs">{where}</p> : null}
      {task.personName && task.personId ? (
        <Link
          href={`/app/${treeSlug}/personnes/${task.personId}`}
          className="text-accent hover:text-accent-hover self-start text-xs"
        >
          {task.personName}
        </Link>
      ) : null}
      {task.url ? (
        <a
          href={task.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:text-accent-hover self-start text-xs break-all"
        >
          {t('openOnline')}
        </a>
      ) : null}
      {task.outcome ? (
        <p className="border-border-subtle text-text-secondary border-l-2 pl-3 text-sm">
          <span className="text-text-faint block text-[11px] tracking-wide uppercase">
            {t('outcome')}
          </span>
          {task.outcome}
        </p>
      ) : null}

      {canEdit && !editing ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-text-muted hover:text-text-primary self-start text-xs underline-offset-2 hover:underline"
        >
          {t('update')}
        </button>
      ) : null}

      {canEdit && editing ? (
        <form action={action} className="timeline-panel flex flex-col gap-3 pt-1">
          <input type="hidden" name="treeSlug" value={treeSlug} />
          <input type="hidden" name="taskId" value={task.id} />
          <Field id={`status-${task.id}`} label={t('statusLabel')}>
            <Select
              id={`status-${task.id}`}
              name="status"
              defaultValue={task.status}
              options={STATUSES.map((value) => [value, t(`status.${value}`)] as const)}
            />
          </Field>
          <Field id={`outcome-${task.id}`} label={t('outcome')}>
            <TextArea
              id={`outcome-${task.id}`}
              name="outcome"
              rows={3}
              defaultValue={task.outcome ?? ''}
              placeholder={t('outcomePlaceholder')}
            />
          </Field>
          {state.status === 'error' && state.message ? (
            <p role="status" className="text-danger text-xs">
              {state.message}
            </p>
          ) : null}
          <div className="flex items-center gap-3">
            <SubmitButton pending={pending}>{t('save')}</SubmitButton>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-text-muted hover:text-text-primary text-sm"
            >
              {t('cancel')}
            </button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

function NewTaskForm({
  treeSlug,
  people,
}: {
  treeSlug: string;
  people: ReadonlyArray<{ id: string; name: string }>;
}) {
  const t = useTranslations('research.form');
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<ActionState, FormData>(
    createResearchTaskAction,
    IDLE,
  );

  useEffect(() => {
    if (state.status === 'success') {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);

  const errors = state.fieldErrors ?? {};

  return (
    <details className="border-border-subtle bg-surface-1/40 group rounded-[var(--radius-lg)] border">
      <summary className="text-text-primary hover:bg-surface-1 flex cursor-pointer items-center gap-2 rounded-[var(--radius-lg)] px-4 py-3 text-sm font-medium select-none">
        <span
          aria-hidden="true"
          className="text-accent inline-block transition-transform duration-[var(--duration-fast)] group-open:rotate-45"
        >
          +
        </span>
        {t('open')}
      </summary>
      <form ref={formRef} action={action} className="flex flex-col gap-4 px-4 pt-1 pb-4">
        <input type="hidden" name="treeSlug" value={treeSlug} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="task-title" label={t('title')} error={errors['title']}>
            <TextInput
              id="task-title"
              name="title"
              placeholder={t('titlePlaceholder')}
              error={errors['title']}
            />
          </Field>
          <Field id="task-person" label={t('person')} error={errors['personId']}>
            <Select
              id="task-person"
              name="personId"
              defaultValue=""
              options={[['', t('nobody')] as const, ...people.map((p) => [p.id, p.name] as const)]}
            />
          </Field>
        </div>
        <Field id="task-hypothesis" label={t('hypothesis')} hint={t('hypothesisHint')}>
          <TextArea id="task-hypothesis" name="hypothesis" rows={2} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="task-repository" label={t('repository')}>
            <TextInput
              id="task-repository"
              name="repository"
              placeholder={t('repositoryPlaceholder')}
            />
          </Field>
          <Field id="task-call-number" label={t('callNumber')}>
            <TextInput id="task-call-number" name="callNumber" placeholder="3 E 12/45" />
          </Field>
          <Field id="task-place" label={t('place')}>
            <TextInput id="task-place" name="placeLabel" />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field id="task-from" label={t('from')} error={errors['searchFrom']}>
            <TextInput
              id="task-from"
              name="searchFrom"
              placeholder="1698"
              error={errors['searchFrom']}
            />
          </Field>
          <Field id="task-to" label={t('to')} error={errors['searchTo']}>
            <TextInput id="task-to" name="searchTo" placeholder="1710" error={errors['searchTo']} />
          </Field>
          <Field id="task-priority" label={t('priority')}>
            <Select
              id="task-priority"
              name="priority"
              defaultValue="NORMAL"
              options={PRIORITIES.map((value) => [value, t(`priorities.${value}`)] as const)}
            />
          </Field>
          <Field id="task-url" label={t('url')} error={errors['url']}>
            <TextInput id="task-url" name="url" placeholder="https://" error={errors['url']} />
          </Field>
        </div>
        {state.status !== 'idle' && state.message ? (
          <p
            role="status"
            className={`rounded-[var(--radius-md)] border px-3 py-2 text-sm ${
              state.status === 'error'
                ? 'text-danger border-danger/30 bg-danger/10'
                : 'text-success border-success/30 bg-success/10'
            }`}
          >
            {state.message}
          </p>
        ) : null}
        <div>
          <SubmitButton pending={pending}>{t('submit')}</SubmitButton>
        </div>
      </form>
    </details>
  );
}
