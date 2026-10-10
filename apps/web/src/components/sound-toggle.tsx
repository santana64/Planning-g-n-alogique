'use client';

import { useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { onSoundChange, setSoundEnabled, soundEnabled } from '@/lib/sound';

/**
 * Sound on or off, for this browser. Off unless someone says otherwise; the
 * one control that turns it on is also the mute.
 */
export function SoundToggle() {
  const t = useTranslations('sound');
  const enabled = useSyncExternalStore(onSoundChange, soundEnabled, () => false);
  return (
    <button
      type="button"
      aria-pressed={enabled}
      onClick={() => setSoundEnabled(!enabled)}
      title={enabled ? t('turnOff') : t('turnOn')}
      className="text-text-faint hover:text-text-primary aria-pressed:text-accent inline-flex items-center gap-1.5 text-xs transition-colors duration-[var(--duration-fast)]"
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none">
        <path d="M2 6h3l4-3v10L5 10H2z" fill="currentColor" />
        {enabled ? (
          <path
            d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.5a6 6 0 0 1 0 9"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        ) : (
          <path
            d="M11 6l4 4M15 6l-4 4"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        )}
      </svg>
      {enabled ? t('on') : t('off')}
    </button>
  );
}
