'use client';

/**
 * The sound layer: a few quiet cues, off until someone turns them on.
 *
 * Synthesised with the Web Audio API — no file to download, nothing to
 * license — and kept to microfeedback: a soft tick as the time cursor
 * crosses a year, a two-note chime on choosing a life, a breath of paper as
 * a document opens, a low swell between the scenes of a story. No music, no
 * loop, nothing on page load: the audio context is created on the first cue
 * after the reader enabled sound, which is also what browsers' autoplay
 * policies require.
 */

export type Cue = 'tick' | 'select' | 'open' | 'transition';

const STORAGE_KEY = 'chronolignee.sound';
const CHANGE_EVENT = 'chronolignee:sound';

let context: AudioContext | null = null;
let lastTick = 0;

export function soundEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

export function setSoundEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // Storage refused (private mode): sound simply stays as it was.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
  if (enabled) play('select');
}

/** Subscribe to the setting, for a toggle that stays in step across the page. */
export function onSoundChange(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', listener);
  };
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  context ??= new AudioContext();
  if (context.state === 'suspended') void context.resume();
  return context;
}

function tone(ctx: AudioContext, frequency: number, start: number, length: number, gain: number) {
  const oscillator = ctx.createOscillator();
  const envelope = ctx.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = frequency;
  envelope.gain.setValueAtTime(0, start);
  envelope.gain.linearRampToValueAtTime(gain, start + 0.008);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + length);
  oscillator.connect(envelope).connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + length + 0.02);
}

function noise(ctx: AudioContext, start: number, length: number, gain: number, cutoff: number) {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * length), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = cutoff;
  filter.Q.value = 0.8;
  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0, start);
  envelope.gain.linearRampToValueAtTime(gain, start + length * 0.3);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + length);
  source.connect(filter).connect(envelope).connect(ctx.destination);
  source.start(start);
}

/** Play one cue, if the reader turned sound on. Never throws. */
export function play(cue: Cue): void {
  if (typeof window === 'undefined' || !soundEnabled()) return;
  try {
    const ctx = audio();
    if (!ctx) return;
    const now = ctx.currentTime;
    switch (cue) {
      case 'tick': {
        // At most one tick every 45 ms: dragging across a century is a
        // ripple, not a buzz.
        if (performance.now() - lastTick < 45) return;
        lastTick = performance.now();
        tone(ctx, 1760, now, 0.03, 0.025);
        break;
      }
      case 'select':
        tone(ctx, 660, now, 0.18, 0.05);
        tone(ctx, 990, now + 0.07, 0.22, 0.04);
        break;
      case 'open':
        noise(ctx, now, 0.32, 0.05, 2400);
        break;
      case 'transition':
        tone(ctx, 196, now, 0.9, 0.035);
        tone(ctx, 294, now + 0.05, 0.8, 0.02);
        break;
    }
  } catch {
    // An audio device that refuses is not an error worth surfacing.
  }
}
