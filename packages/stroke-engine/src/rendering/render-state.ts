import {
  StrokeTimeline,
  RenderState,
  RenderStroke,
  RenderConfig,
  DEFAULT_RENDER_CONFIG
} from '@sketch-maker/shared-types';
import { getTimelineState, getStrokeProgress } from '../timeline';
import { getPartialStrokeGeometry } from './partial-geometry';

/**
 * Pure, deterministic transformer converting a progressive StrokeTimeline at timestamp timeMs
 * into a platform-independent RenderState ready for canvas rendering.
 *
 * Guaranteed properties:
 * 1. Zero DOM or browser global references (100% pure TypeScript).
 * 2. Immutable: leaves input timeline and source geometry completely untouched.
 * 3. Exact partial geometry: active strokes have trimmed Bézier / polyline geometry matching timeMs.
 * 4. Strictly deterministic: same (timeline, timeMs, config) produces identical RenderState.
 */
export function createRenderState(
  timeline: StrokeTimeline,
  timeMs: number,
  config?: Partial<RenderConfig>
): RenderState {
  const mergedConfig: RenderConfig = {
    ...DEFAULT_RENDER_CONFIG,
    ...config
  };

  const timelineState = getTimelineState(timeline, timeMs);
  const renderStrokes: RenderStroke[] = [];
  const activeStrokes: RenderStroke[] = [];

  for (let i = 0; i < timeline.strokes.length; i++) {
    const tStroke = timeline.strokes[i];
    const candidate = tStroke.stroke.stroke;

    // Optional subject filtering for multi-person debugging (BM-11)
    if (mergedConfig.filterSubjectId && candidate.subjectId !== mergedConfig.filterSubjectId) {
      continue;
    }

    const { progress, state } = getStrokeProgress(tStroke, timelineState.timeMs);

    // Filter pending strokes unless explicitly requested for diagnostics
    if (state === 'pending' && !mergedConfig.showPending) {
      continue;
    }

    // Extract partial geometry according to state and progress
    const geometry = getPartialStrokeGeometry(candidate, progress);

    const renderStroke: RenderStroke = {
      strokeId: candidate.id,
      subjectId: candidate.subjectId,
      sequenceIndex: tStroke.stroke.sequenceIndex,
      timelineIndex: tStroke.timelineIndex,
      status: state,
      progress,
      geometry,
      lineWidth: Math.max(0.5, candidate.width * mergedConfig.baseLineWidth),
      opacity: state === 'pending' ? 0.0 : 1.0,
      semanticRole: candidate.semanticRole,
      phase: tStroke.phase,
      importance: candidate.importance,
      isBackground: candidate.isBackground
    };

    renderStrokes.push(renderStroke);

    if (state === 'drawing') {
      activeStrokes.push(renderStroke);
    }
  }

  return {
    timeMs: timelineState.timeMs,
    overallProgress: timelineState.overallProgress,
    strokes: renderStrokes,
    activeStrokes,
    activeCount: activeStrokes.length,
    completedCount: timelineState.completedCount,
    pendingCount: timelineState.pendingCount,
    totalStrokes: timeline.strokes.length,
    isComplete: timelineState.overallProgress >= 1.0,
    bounds: timeline.bounds
  };
}
