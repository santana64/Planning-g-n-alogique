import { DAYS_PER_YEAR } from '@chronolignee/domain';
import { jdnToX, xToJdn, type TemporalViewport } from './scale';

/**
 * The temporal camera.
 *
 * Pure state plus pure transitions: no canvas, no events, no animation frame.
 * Interaction and easing live in the layer above, which is what makes the
 * camera's behaviour testable — and camera behaviour is exactly the kind of
 * thing that is impossible to debug once it is tangled with pointer handling.
 *
 * The invariant that matters, and the one users feel: zooming toward a point
 * leaves the day under that point exactly where it was. Get it wrong by half a
 * pixel per step and a minute of scrolling has silently carried the view
 * somewhere else.
 */

export interface CameraLimits {
  /** Narrowest visible span. One week is as far in as a genealogy is useful. */
  readonly minSpanDays: number;
  /** Widest visible span. */
  readonly maxSpanDays: number;
  /** Hard stops, normally the data extent plus padding. */
  readonly minJdn: number;
  readonly maxJdn: number;
}

export interface CameraState {
  readonly startJdn: number;
  readonly endJdn: number;
  readonly widthPx: number;
}

const DEFAULT_LIMITS: CameraLimits = {
  minSpanDays: 7,
  maxSpanDays: 2200 * DAYS_PER_YEAR,
  minJdn: 990_000, // roughly 4000 BCE
  maxJdn: 2_816_788, // roughly 2200 CE
};

export class TemporalCamera {
  private startJdn: number;
  private endJdn: number;
  private widthPx: number;
  private limits: CameraLimits;

  constructor(state: CameraState, limits: Partial<CameraLimits> = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.widthPx = Math.max(state.widthPx, 1);
    this.startJdn = state.startJdn;
    this.endJdn = state.endJdn;
    this.clamp();
  }

  viewport(): TemporalViewport {
    return { startJdn: this.startJdn, endJdn: this.endJdn, widthPx: this.widthPx };
  }

  get spanDays(): number {
    return this.endJdn - this.startJdn;
  }

  get centreJdn(): number {
    return (this.startJdn + this.endJdn) / 2;
  }

  /** Resize without moving time: the same days stay visible, wider or narrower. */
  setWidth(widthPx: number): void {
    this.widthPx = Math.max(widthPx, 1);
  }

  setLimits(limits: Partial<CameraLimits>): void {
    this.limits = { ...this.limits, ...limits };
    this.clamp();
  }

  panByPixels(deltaPx: number): void {
    const days = deltaPx * (this.spanDays / this.widthPx);
    this.startJdn -= days;
    this.endJdn -= days;
    this.clamp();
  }

  panByDays(days: number): void {
    this.startJdn += days;
    this.endJdn += days;
    this.clamp();
  }

  /**
   * Zoom about a screen position.
   *
   * `factor` below 1 zooms in. The day under `focusPx` is recomputed after
   * clamping and the view is nudged back, so hitting a zoom limit does not
   * drift the anchor — the case a naive implementation gets wrong precisely
   * when the user is scrolling hardest.
   */
  zoomAt(focusPx: number, factor: number): void {
    const anchorJdn = xToJdn(this.viewport(), focusPx);
    const targetSpan = this.clampSpan(this.spanDays * factor);
    const fraction = focusPx / this.widthPx;

    this.startJdn = anchorJdn - targetSpan * fraction;
    this.endJdn = this.startJdn + targetSpan;
    this.clamp();

    // Clamping may have shifted the anchor; put it back if there is room.
    const actual = xToJdn(this.viewport(), focusPx);
    const drift = anchorJdn - actual;
    if (drift !== 0) {
      const shifted = this.shiftWithin(drift);
      this.startJdn += shifted;
      this.endJdn += shifted;
    }
  }

  zoomBy(factor: number): void {
    this.zoomAt(this.widthPx / 2, factor);
  }

  /**
   * Frame a range, with padding as a fraction of the range.
   *
   * A zero-width range (a single day, a person who died the day they were
   * born) is widened to a readable window rather than producing a division by
   * zero or an infinitely deep zoom.
   */
  fitRange(startJdn: number, endJdn: number, paddingFraction = 0.08): void {
    const rawSpan = Math.max(endJdn - startJdn, 0);
    const span = rawSpan === 0 ? DAYS_PER_YEAR * 2 : rawSpan * (1 + paddingFraction * 2);
    const centre = (startJdn + endJdn) / 2;
    const clamped = this.clampSpan(span);

    this.startJdn = centre - clamped / 2;
    this.endJdn = centre + clamped / 2;
    this.clamp();
  }

  /** Centre on a day, keeping the current zoom. */
  goTo(jdn: number): void {
    const half = this.spanDays / 2;
    this.startJdn = jdn - half;
    this.endJdn = jdn + half;
    this.clamp();
  }

  /** Whether a day is currently visible. */
  contains(jdn: number): boolean {
    return jdn >= this.startJdn && jdn <= this.endJdn;
  }

  toX(jdn: number): number {
    return jdnToX(this.viewport(), jdn);
  }

  toJdn(x: number): number {
    return xToJdn(this.viewport(), x);
  }

  snapshot(): CameraState {
    return { startJdn: this.startJdn, endJdn: this.endJdn, widthPx: this.widthPx };
  }

  restore(state: CameraState): void {
    this.startJdn = state.startJdn;
    this.endJdn = state.endJdn;
    this.widthPx = Math.max(state.widthPx, 1);
    this.clamp();
  }

  private clampSpan(span: number): number {
    return Math.min(Math.max(span, this.limits.minSpanDays), this.limits.maxSpanDays);
  }

  /** How far the view may move in the requested direction before hitting a stop. */
  private shiftWithin(requested: number): number {
    if (requested > 0) {
      return Math.min(requested, this.limits.maxJdn - this.endJdn);
    }
    return Math.max(requested, this.limits.minJdn - this.startJdn);
  }

  private clamp(): void {
    const span = this.clampSpan(this.spanDays);

    // Keep the centre when the span had to change, so a clamped zoom does not
    // also slide the view sideways.
    if (span !== this.spanDays) {
      const centre = this.centreJdn;
      this.startJdn = centre - span / 2;
      this.endJdn = centre + span / 2;
    }

    const available = this.limits.maxJdn - this.limits.minJdn;
    if (span >= available) {
      // Zoomed out past the whole permitted range: show all of it.
      this.startJdn = this.limits.minJdn;
      this.endJdn = this.limits.maxJdn;
      return;
    }

    if (this.startJdn < this.limits.minJdn) {
      this.endJdn += this.limits.minJdn - this.startJdn;
      this.startJdn = this.limits.minJdn;
    }
    if (this.endJdn > this.limits.maxJdn) {
      this.startJdn -= this.endJdn - this.limits.maxJdn;
      this.endJdn = this.limits.maxJdn;
    }
  }
}

/**
 * Interpolate between two camera states.
 *
 * Interpolating the span geometrically rather than linearly is what makes a
 * long zoom feel even: linear interpolation of the span crawls at the wide end
 * and lurches at the narrow one, because what the eye reads as "speed" is the
 * proportional change, not the absolute one.
 */
export function interpolateCamera(from: CameraState, to: CameraState, t: number): CameraState {
  const clamped = Math.min(Math.max(t, 0), 1);

  const fromSpan = from.endJdn - from.startJdn;
  const toSpan = to.endJdn - to.startJdn;
  const span = fromSpan * Math.pow(toSpan / fromSpan, clamped);

  const fromCentre = (from.startJdn + from.endJdn) / 2;
  const toCentre = (to.startJdn + to.endJdn) / 2;
  const centre = fromCentre + (toCentre - fromCentre) * clamped;

  return {
    startJdn: centre - span / 2,
    endJdn: centre + span / 2,
    widthPx: to.widthPx,
  };
}
