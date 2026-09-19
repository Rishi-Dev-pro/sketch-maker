import { TimelineEasing } from './timeline-types';

/**
 * Pure mathematical easing functions for progressive stroke reveal.
 * All functions accept a normalized progress p in [0.0, 1.0] and return an eased value in [0.0, 1.0].
 */

export function linear(p: number): number {
  return clampProgress(p);
}

export function easeIn(p: number): number {
  const t = clampProgress(p);
  return t * t;
}

export function easeOut(p: number): number {
  const t = clampProgress(p);
  return 1 - (1 - t) * (1 - t);
}

export function easeInOut(p: number): number {
  const t = clampProgress(p);
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function clampProgress(p: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  return p;
}

/**
 * Applies the specified easing curve to a normalized progress value [0.0, 1.0].
 */
export function applyEasing(progress: number, easing: TimelineEasing): number {
  switch (easing) {
    case 'linear':
      return linear(progress);
    case 'easeIn':
      return easeIn(progress);
    case 'easeOut':
      return easeOut(progress);
    case 'easeInOut':
      return easeInOut(progress);
    default:
      return easeOut(progress);
  }
}
