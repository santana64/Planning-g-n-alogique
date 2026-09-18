'use client';

import { useEffect, useRef, useState } from 'react';
import { collectNotes, sourceText, type RenderedChapter, type StorySentence } from './sentences';

/**
 * The story, one generation at a time.
 *
 * A native modal dialog: the browser traps focus, closes it on Escape and
 * hands focus back to the button that opened it, which is the "return to
 * normal navigation instantly" the story mode owes its reader. Closing also
 * brings the written story below to the chapter the reader stopped at.
 *
 * Between two chapters the year runs from one to the other — the one piece of
 * motion here that carries information, since the whole point of the climb
 * is going back in time. With reduced motion it simply changes. Focus starts
 * on "Suivant", not on "Quitter": the reflex key press should move the story
 * on, not throw the reader out of it.
 */

const AUTOPLAY_MS = 8000;
const CLOCK_MS = 700;

function Sentences({
  sentences,
  notes,
}: {
  sentences: readonly StorySentence[];
  notes: readonly string[];
}) {
  return (
    <>
      {sentences.map((sentence) => (
        <p key={sentence.text}>
          {sentence.text}
          {sentence.sources.map((source) => (
            <sup key={sourceText(source)} className="ml-0.5 text-xs text-[#f0b35a]">
              {notes.indexOf(sourceText(source)) + 1}
            </sup>
          ))}
          {sentence.factual && sentence.sources.length === 0 ? (
            <span className="ml-2 text-xs text-[#a9b0c0]">(sans source)</span>
          ) : null}
        </p>
      ))}
    </>
  );
}

export function StoryPlayer({
  chapters,
  title,
}: {
  chapters: readonly RenderedChapter[];
  title: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const [index, setIndex] = useState(0);
  const [autoplay, setAutoplay] = useState(false);
  const [shownYear, setShownYear] = useState<number | null>(chapters[0]?.year ?? null);
  const yearRef = useRef<number | null>(chapters[0]?.year ?? null);
  const chapter = chapters[index];

  function open() {
    setIndex(0);
    setAutoplay(false);
    yearRef.current = chapters[0]?.year ?? null;
    setShownYear(yearRef.current);
    dialogRef.current?.showModal();
    // Not the autofocus attribute: React does not render it, and focuses at
    // mount instead — when this dialog, mounted closed, cannot take focus.
    nextRef.current?.focus();
  }

  function close() {
    dialogRef.current?.close();
  }

  function go(next: number) {
    setIndex(Math.max(0, Math.min(chapters.length - 1, next)));
  }

  // The clock: from the year on screen to the year of the new chapter.
  useEffect(() => {
    const target = chapter?.year ?? null;
    const from = yearRef.current;
    if (target === null || from === null || target === from) {
      yearRef.current = target ?? from;
      const settle = requestAnimationFrame(() => setShownYear(target ?? from));
      return () => cancelAnimationFrame(settle);
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = reduced ? 1 : Math.min(1, (now - start) / CLOCK_MS);
      const eased = 1 - (1 - t) ** 3;
      const value = Math.round(from + (target - from) * eased);
      yearRef.current = value;
      setShownYear(value);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [chapter?.year, chapter?.key]);

  useEffect(() => {
    if (!autoplay) return;
    if (index >= chapters.length - 1) {
      const stop = setTimeout(() => setAutoplay(false), 0);
      return () => clearTimeout(stop);
    }
    const timer = setTimeout(() => setIndex((current) => current + 1), AUTOPLAY_MS);
    return () => clearTimeout(timer);
  }, [autoplay, index, chapters.length]);

  function onKeyDown(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setAutoplay(false);
      go(index + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setAutoplay(false);
      go(index - 1);
    }
  }

  function onClose() {
    setAutoplay(false);
    const current = chapters[index];
    if (current) {
      document
        .getElementById(`chapter-${current.key}`)
        ?.scrollIntoView({ block: 'start', behavior: 'auto' });
    }
  }

  const notes = chapter ? collectNotes(chapter) : [];

  return (
    <>
      <button
        type="button"
        onClick={open}
        disabled={chapters.length === 0}
        className="bg-accent text-accent-contrast hover:bg-accent-hover self-start rounded-[var(--radius-md)] px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        Lire comme un récit
      </button>

      <dialog
        ref={dialogRef}
        aria-label={title}
        onKeyDown={onKeyDown}
        onClose={onClose}
        className="m-0 h-dvh max-h-none w-screen max-w-none bg-[#0b1020] p-0 text-[#e9e4d8] backdrop:bg-black/70"
      >
        {chapter ? (
          <div className="mx-auto flex h-full max-w-3xl flex-col px-6 py-8">
            <div className="flex items-center justify-between text-xs text-[#a9b0c0]">
              <span>{title}</span>
              <button
                type="button"
                onClick={close}
                className="rounded-[var(--radius-sm)] px-2 py-1 hover:text-white"
              >
                Quitter <span className="text-[#7d8799]">(Échap)</span>
              </button>
            </div>

            <div
              key={chapter.key}
              aria-live="polite"
              className="story-scene flex flex-1 flex-col justify-center gap-5 overflow-y-auto py-6"
            >
              <p className="font-editorial tabular text-6xl tracking-tight text-[#f0b35a] sm:text-7xl">
                {chapter.marker === null
                  ? ' '
                  : shownYear !== null && chapter.marker === String(chapter.year)
                    ? shownYear
                    : chapter.marker}
              </p>
              <p className="text-xs tracking-wide text-[#a9b0c0] uppercase">{chapter.eyebrow}</p>
              <h2 className="font-editorial text-3xl tracking-tight">{chapter.title}</h2>
              <div className="flex flex-col gap-2 text-lg">
                <Sentences sentences={chapter.sentences} notes={notes} />
              </div>
              {chapter.asides.map((aside) => (
                <div
                  key={aside.key}
                  className="flex flex-col gap-1 border-l-2 border-[#6f86a8] pl-4 text-base text-[#c9ccd6]"
                >
                  <p className="text-xs tracking-wide text-[#a9b0c0] uppercase">
                    {aside.eyebrow}
                    {aside.marker ? ` · ${aside.marker}` : ''}
                  </p>
                  <p className="font-editorial text-xl text-[#e9e4d8]">{aside.title}</p>
                  <Sentences sentences={aside.sentences} notes={notes} />
                </div>
              ))}
              {notes.length > 0 ? (
                <ol className="flex flex-col gap-0.5 text-xs text-[#a9b0c0]">
                  {notes.map((note, position) => (
                    <li key={note}>
                      <span className="text-[#f0b35a]">{position + 1}</span> {note}
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-4">
              <button
                type="button"
                onClick={() => {
                  setAutoplay(false);
                  go(index - 1);
                }}
                disabled={index === 0}
                className="rounded-[var(--radius-md)] border border-white/15 px-4 py-2 text-sm disabled:opacity-40"
              >
                ← Précédent
              </button>
              <div className="flex items-center gap-4 text-xs text-[#a9b0c0]">
                <span className="tabular">
                  {index + 1} / {chapters.length}
                </span>
                <button
                  type="button"
                  aria-pressed={autoplay}
                  onClick={() => setAutoplay((value) => !value)}
                  disabled={index >= chapters.length - 1}
                  className="rounded-[var(--radius-sm)] px-2 py-1 hover:text-white disabled:opacity-40"
                >
                  {autoplay ? 'Pause' : 'Lecture automatique'}
                </button>
              </div>
              <button
                ref={nextRef}
                type="button"
                onClick={() => {
                  setAutoplay(false);
                  go(index + 1);
                }}
                disabled={index >= chapters.length - 1}
                className="rounded-[var(--radius-md)] border border-white/15 px-4 py-2 text-sm disabled:opacity-40"
              >
                Suivant →
              </button>
            </div>
          </div>
        ) : null}
      </dialog>
    </>
  );
}
