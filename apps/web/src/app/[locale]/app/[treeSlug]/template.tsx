import type { ReactNode } from 'react';

/**
 * Every screen of a tree arrives rather than appears.
 *
 * A template, not a layout: it is mounted afresh on each navigation, so the
 * entrance plays every time someone moves from the timeline to the map —
 * short (260 ms), a fade and an eight-pixel rise, and nothing at all for
 * whoever has asked their system for less motion.
 */
export default function TreeTemplate({ children }: { children: ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
