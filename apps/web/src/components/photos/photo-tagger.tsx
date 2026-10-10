'use client';

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { IDLE, type ActionState } from '@/server/action-state';
import { tagPersonAction, untagPersonAction } from '@/server/media-actions';
import type { PhotoTag } from '@/server/media';
import { ToolButton, ZoomViewer, useViewer } from '@/components/viewer/zoom-viewer';

/**
 * A photograph, and the people someone has recognised in it.
 *
 * To name someone, switch to "identify", draw a rectangle around them, and
 * choose who it is. That is the whole mechanism — a person's judgement, a
 * rectangle and a name. Nothing detects or compares faces (docs/PRIVACY.md).
 *
 * Hovering a name in the list lights up their rectangle, and the other way
 * round, so a group photograph of thirty is readable.
 */

type Region = { x: number; y: number; width: number; height: number };

export function PhotoTagger({
  treeSlug,
  mediaId,
  title,
  width,
  height,
  tags,
  people,
  canEdit,
}: {
  treeSlug: string;
  mediaId: string;
  title: string;
  /** Known once the worker has measured it; measured here until then. */
  width: number | null;
  height: number | null;
  tags: readonly PhotoTag[];
  people: ReadonlyArray<{ id: string; name: string }>;
  canEdit: boolean;
}) {
  const t = useTranslations('photos.tagger');
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(
    width && height ? { w: width, h: height } : null,
  );
  const router = useRouter();
  const [identifying, setIdentifying] = useState(false);
  const [draft, setDraft] = useState<Region | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [state, action, pending] = useActionState<ActionState, FormData>(tagPersonAction, IDLE);
  const [removing, startRemoving] = useTransition();
  const [handled, setHandled] = useState<ActionState>(IDLE);

  // A success closes the picker; derived, not set from an effect.
  const pickerOpen = draft !== null && !(state.status === 'success' && state !== handled);

  useEffect(() => {
    if (state.status === 'success') router.refresh();
  }, [state, router]);

  const remove = (personId: string) =>
    startRemoving(async () => {
      const form = new FormData();
      form.set('treeSlug', treeSlug);
      form.set('mediaId', mediaId);
      form.set('personId', personId);
      await untagPersonAction(IDLE, form);
      router.refresh();
    });

  const tagged = new Set(tags.map((tag) => tag.personId));
  const src = `/api/trees/${treeSlug}/media/${mediaId}?variant=preview`;

  if (!measured) {
    return (
      <div className="bg-surface-sunken flex h-[70vh] min-h-[26rem] items-center justify-center rounded-[var(--radius-lg)]">
        <span className="viewer-loading text-text-faint text-sm">{t('loading')}</span>
        <img
          src={src}
          alt=""
          className="hidden"
          onLoad={(event) =>
            setMeasured({
              w: event.currentTarget.naturalWidth,
              h: event.currentTarget.naturalHeight,
            })
          }
        />
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="h-[70vh] min-h-[26rem]">
        <ZoomViewer
          width={measured.w}
          height={measured.h}
          label={title}
          panEnabled={!identifying}
          overlay={
            <TagLayer
              tags={tags}
              draft={pickerOpen ? draft : null}
              identifying={identifying}
              highlighted={highlighted}
              onHighlight={setHighlighted}
              onDrawn={(region) => {
                setHandled(state);
                setDraft(region);
              }}
            />
          }
          toolbar={
            canEdit ? (
              <ToolButton
                label={identifying ? t('stopIdentifying') : t('identify')}
                pressed={identifying}
                onClick={() => {
                  setIdentifying((value) => !value);
                  setDraft(null);
                }}
              >
                <span className="px-1 text-xs">
                  {identifying ? t('stopIdentifying') : t('identify')}
                </span>
              </ToolButton>
            ) : null
          }
        >
          <img
            src={src}
            alt={title}
            width={measured.w}
            height={measured.h}
            draggable={false}
            className="block max-w-none"
          />
        </ZoomViewer>
        {identifying ? (
          <p className="text-text-muted mt-2 text-xs" role="status">
            {t('howTo')}
          </p>
        ) : null}
      </div>

      <aside className="flex flex-col gap-4">
        {pickerOpen && draft ? (
          <PersonPicker
            people={people.filter((person) => !tagged.has(person.id))}
            pending={pending}
            error={state.status === 'error' ? state.message : undefined}
            onCancel={() => setDraft(null)}
            action={action}
            hidden={{ treeSlug, mediaId, ...draft }}
          />
        ) : null}

        <section className="flex flex-col gap-2">
          <h2 className="text-text-faint text-xs tracking-wide uppercase">
            {t('inPhoto', { count: tags.length })}
          </h2>
          {tags.length === 0 ? (
            <p className="text-text-faint text-sm">{canEdit ? t('noneYetEditor') : t('noneYet')}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {tags.map((tag) => (
                <li
                  key={tag.personId}
                  onMouseEnter={() => setHighlighted(tag.personId)}
                  onMouseLeave={() => setHighlighted(null)}
                  className={`flex items-center justify-between gap-2 rounded-[var(--radius-md)] px-2 py-1.5 text-sm transition-colors duration-[var(--duration-fast)] ${
                    highlighted === tag.personId ? 'bg-accent/10' : ''
                  }`}
                >
                  <Link
                    href={`/app/${treeSlug}/personnes/${tag.personId}`}
                    className="text-text-primary hover:text-accent font-editorial"
                  >
                    {tag.name}
                  </Link>
                  {canEdit ? (
                    <button
                      type="button"
                      disabled={removing}
                      onClick={() => remove(tag.personId)}
                      aria-label={t('remove', { name: tag.name })}
                      className="text-text-faint hover:text-danger text-xs"
                    >
                      {t('removeShort')}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}

/** Tag rectangles, and the one being drawn, in content coordinates. */
function TagLayer({
  tags,
  draft,
  identifying,
  highlighted,
  onHighlight,
  onDrawn,
}: {
  tags: readonly PhotoTag[];
  draft: Region | null;
  identifying: boolean;
  highlighted: string | null;
  onHighlight: (personId: string | null) => void;
  onDrawn: (region: Region) => void;
}) {
  const viewer = useViewer();
  const layer = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [current, setCurrent] = useState<{ x: number; y: number } | null>(null);

  const size = () => {
    const element = layer.current;
    return { w: element?.offsetWidth ?? 1, h: element?.offsetHeight ?? 1 };
  };
  const point = (event: React.PointerEvent) => {
    const p = viewer?.toContent(event.clientX, event.clientY);
    if (!p) return null;
    const { w, h } = size();
    return { x: Math.min(Math.max(p.x / w, 0), 1), y: Math.min(Math.max(p.y / h, 0), 1) };
  };

  const drawing = useMemo(() => {
    if (!start || !current) return null;
    return {
      x: Math.min(start.x, current.x),
      y: Math.min(start.y, current.y),
      width: Math.abs(current.x - start.x),
      height: Math.abs(current.y - start.y),
    };
  }, [start, current]);

  const box = (region: Region) => ({
    left: `${region.x * 100}%`,
    top: `${region.y * 100}%`,
    width: `${region.width * 100}%`,
    height: `${region.height * 100}%`,
  });
  // Borders stay two screen pixels thick whatever the zoom.
  const stroke = 2 / (viewer?.scale ?? 1);

  return (
    <div
      ref={layer}
      className={`absolute inset-0 ${identifying ? 'cursor-crosshair' : 'pointer-events-none'}`}
      onPointerDown={(event) => {
        if (!identifying) return;
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        const p = point(event);
        setStart(p);
        setCurrent(p);
      }}
      onPointerMove={(event) => {
        if (start) setCurrent(point(event));
      }}
      onPointerUp={() => {
        // Too small to be a face: a click, not a rectangle.
        if (drawing && drawing.width > 0.01 && drawing.height > 0.01) onDrawn(drawing);
        setStart(null);
        setCurrent(null);
      }}
    >
      {tags.map((tag) =>
        tag.region ? (
          <div
            key={tag.personId}
            className="tag-box pointer-events-auto absolute rounded-[3px]"
            style={{
              ...box(tag.region),
              outline: `${stroke}px solid ${highlighted === tag.personId ? 'var(--accent-primary)' : 'oklch(1 0 0 / 0.85)'}`,
              boxShadow: `0 0 0 ${stroke}px oklch(0 0 0 / 0.35)`,
            }}
            onMouseEnter={() => onHighlight(tag.personId)}
            onMouseLeave={() => onHighlight(null)}
          >
            <span
              className={`bg-surface-floating text-text-primary absolute top-full left-0 mt-1 rounded px-1.5 py-0.5 whitespace-nowrap shadow-[var(--shadow-mid)] transition-opacity duration-[var(--duration-fast)] ${
                highlighted === tag.personId ? 'opacity-100' : 'opacity-0'
              }`}
              style={{ fontSize: 12 / (viewer?.scale ?? 1), transformOrigin: 'top left' }}
            >
              {tag.name}
            </span>
          </div>
        ) : null,
      )}
      {(() => {
        const shown = drawing ?? draft;
        return shown ? (
          <div
            className="absolute rounded-[3px]"
            style={{
              ...box(shown),
              outline: `${stroke}px dashed var(--accent-primary)`,
              background: 'oklch(0.76 0.115 76 / 0.12)',
            }}
          />
        ) : null;
      })()}
    </div>
  );
}

function PersonPicker({
  people,
  pending,
  error,
  onCancel,
  action,
  hidden,
}: {
  people: ReadonlyArray<{ id: string; name: string }>;
  pending: boolean;
  error: string | undefined;
  onCancel: () => void;
  action: (form: FormData) => void;
  hidden: { treeSlug: string; mediaId: string } & Region;
}) {
  const t = useTranslations('photos.tagger');
  const [query, setQuery] = useState('');
  const matches = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('fr').normalize('NFD').replace(/\p{M}/gu, '');
    const list = q
      ? people.filter((person) =>
          person.name.toLocaleLowerCase('fr').normalize('NFD').replace(/\p{M}/gu, '').includes(q),
        )
      : people;
    return list.slice(0, 12);
  }, [people, query]);

  return (
    <section className="timeline-panel border-accent/40 bg-surface-0 flex flex-col gap-2 rounded-[var(--radius-lg)] border p-3 shadow-[var(--shadow-mid)]">
      <h2 className="text-text-primary text-sm font-medium">{t('who')}</h2>
      <input
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('search')}
        aria-label={t('search')}
        className="border-border-default bg-surface-1 text-text-primary focus:border-accent rounded-[var(--radius-md)] border px-3 py-2 text-sm focus:outline-none"
      />
      <ul className="flex max-h-72 flex-col gap-0.5 overflow-auto">
        {matches.map((person) => (
          <li key={person.id}>
            <form action={action}>
              <input type="hidden" name="treeSlug" value={hidden.treeSlug} />
              <input type="hidden" name="mediaId" value={hidden.mediaId} />
              <input type="hidden" name="personId" value={person.id} />
              <input type="hidden" name="x" value={hidden.x} />
              <input type="hidden" name="y" value={hidden.y} />
              <input type="hidden" name="width" value={hidden.width} />
              <input type="hidden" name="height" value={hidden.height} />
              <button
                type="submit"
                disabled={pending}
                className="text-text-secondary hover:bg-surface-2 hover:text-text-primary w-full rounded-[var(--radius-md)] px-2 py-1.5 text-left text-sm transition-colors duration-[var(--duration-fast)] disabled:opacity-60"
              >
                {person.name}
              </button>
            </form>
          </li>
        ))}
        {matches.length === 0 ? (
          <li className="text-text-faint px-2 text-xs">{t('noMatch')}</li>
        ) : null}
      </ul>
      {error ? (
        <p role="status" className="text-danger text-xs">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={onCancel}
        className="text-text-muted hover:text-text-primary self-start text-xs"
      >
        {t('cancel')}
      </button>
    </section>
  );
}
