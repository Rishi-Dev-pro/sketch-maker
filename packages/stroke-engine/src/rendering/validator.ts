import { StrokeTimeline, RenderState } from '@sketch-maker/shared-types';

export interface RenderStateValidationResult {
  readonly valid: boolean;
  readonly errors: string[];
}

/**
 * Validates the mathematical and structural integrity of a compiled RenderState
 * against its originating StrokeTimeline.
 */
export function validateRenderState(
  renderState: RenderState,
  timeline: StrokeTimeline
): RenderStateValidationResult {
  const errors: string[] = [];

  // 1. Monotonic timestamps and progress bounds
  if (renderState.timeMs < 0 || renderState.timeMs > timeline.totalDurationMs + 1e-4) {
    errors.push(`timeMs (${renderState.timeMs}) is out of bounds [0, ${timeline.totalDurationMs}]`);
  }

  if (renderState.overallProgress < 0.0 || renderState.overallProgress > 1.0) {
    errors.push(`overallProgress (${renderState.overallProgress}) is out of bounds [0, 1]`);
  }

  // 2. Count consistency
  if (renderState.activeCount !== renderState.activeStrokes.length) {
    errors.push(`activeCount (${renderState.activeCount}) does not match activeStrokes.length (${renderState.activeStrokes.length})`);
  }

  // 3. Inspect individual render strokes
  for (let i = 0; i < renderState.strokes.length; i++) {
    const s = renderState.strokes[i];

    if (s.progress < 0.0 || s.progress > 1.0) {
      errors.push(`Stroke ${s.strokeId} progress (${s.progress}) is out of bounds [0, 1]`);
    }

    if (s.status === 'complete' && s.progress < 0.9999) {
      errors.push(`Stroke ${s.strokeId} marked 'complete' but has progress ${s.progress}`);
    }

    if (s.status === 'drawing' && (s.progress <= 0.0 || s.progress >= 1.0)) {
      errors.push(`Stroke ${s.strokeId} marked 'drawing' but has invalid drawing progress ${s.progress}`);
    }

    // Geometry coordinate validation
    for (const pt of s.geometry.points) {
      if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
        errors.push(`Stroke ${s.strokeId} contains non-finite point (${pt.x}, ${pt.y})`);
      }
    }

    if (s.geometry.curves) {
      for (const curve of s.geometry.curves) {
        if (!Number.isFinite(curve.start.x) || !Number.isFinite(curve.start.y) ||
            !Number.isFinite(curve.end.x) || !Number.isFinite(curve.end.y)) {
          errors.push(`Stroke ${s.strokeId} contains non-finite curve endpoints`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
