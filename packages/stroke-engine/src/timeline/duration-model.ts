import {
  OrderedStroke,
  TimelineConfig
} from './timeline-types';
import {
  getPhaseDurationMultiplier,
  getRoleDurationMultiplier
} from './phase-timing';

/**
 * Calculates the natural drawing duration in milliseconds for an individual OrderedStroke.
 *
 * Physical & Artistic Formula:
 * duration = clamp(
 *   baseDuration + lengthFactor * length * phaseMultiplier * roleMultiplier * (0.9 + 0.2 * importance),
 *   minDuration,
 *   maxDuration
 * )
 *
 * - Stroke length (L) is the primary physical driver: drawing longer arcs requires more time.
 * - Importance (I) gives deliberate weight to salient focal features.
 * - Phase & Role multipliers model the artist's shifting hand speed across anatomy.
 */
export function calculateStrokeDuration(
  orderedStroke: OrderedStroke,
  config: TimelineConfig
): number {
  const { stroke, phase } = orderedStroke;
  const length = stroke.length;
  const importance = stroke.importance;
  const role = stroke.semanticRole;

  const phaseMultiplier = getPhaseDurationMultiplier(phase, config);
  const roleMultiplier = getRoleDurationMultiplier(role);
  const salienceFactor = 0.9 + 0.2 * importance;

  const dynamicDuration = config.baseStrokeDurationMs +
    config.lengthFactor * length * phaseMultiplier * roleMultiplier * salienceFactor;

  // Round to nearest millisecond and clamp to configured physical bounds
  const clamped = Math.min(
    config.maxStrokeDurationMs,
    Math.max(config.minStrokeDurationMs, Math.round(dynamicDuration))
  );

  return clamped;
}
