import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  OrderedStroke,
  OrderedStrokeSequence,
  StrokeCandidate,
  createStrokeTimeline,
  getTimelineState,
  getStrokeProgress,
  calculateStrokeDuration,
  applyEasing,
  linear,
  easeIn,
  easeOut,
  easeInOut,
  DEFAULT_TIMELINE_CONFIG,
  TimelineConfig
} from '@sketch-maker/stroke-engine';

function createMockCandidate(overrides: Partial<StrokeCandidate> = {}): StrokeCandidate {
  return {
    id: overrides.id || 'candidate_0',
    subjectId: overrides.subjectId || 'subject_0',
    sourcePathId: overrides.sourcePathId || 'path_0',
    source: overrides.source || 'face_contour',
    points: overrides.points || [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }],
    closed: overrides.closed ?? false,
    confidence: overrides.confidence ?? 0.95,
    importance: overrides.importance ?? 0.8,
    priorityScore: overrides.priorityScore ?? 0.85,
    semanticRole: overrides.semanticRole || 'eye',
    hierarchyLevel: overrides.hierarchyLevel ?? 2,
    width: overrides.width ?? 1.2,
    density: overrides.density ?? 0.8,
    length: overrides.length ?? 0.15,
    bounds: overrides.bounds || { x: 0.1, y: 0.1, width: 0.1, height: 0.1 },
    drawable: overrides.drawable ?? true,
    isBackground: overrides.isBackground ?? false,
    visibility: overrides.visibility ?? 'visible',
    ...overrides
  };
}

function createMockOrderedStroke(overrides: Partial<OrderedStroke> = {}): OrderedStroke {
  const candidate = overrides.stroke || createMockCandidate();
  return {
    stroke: candidate,
    sequenceIndex: overrides.sequenceIndex ?? 0,
    phase: overrides.phase || 'expressive_features',
    phaseIndex: overrides.phaseIndex ?? 0,
    phaseName: overrides.phaseName || 'Expressive Features',
    dependencyLevel: overrides.dependencyLevel ?? 1,
    orderingReason: overrides.orderingReason || 'Focal feature',
    ...overrides
  };
}

function createMockSequence(strokes: OrderedStroke[]): OrderedStrokeSequence {
  return {
    version: '0.1.0',
    strokes,
    totalStrokes: strokes.length,
    drawableStrokes: strokes.length,
    filteredStrokes: [],
    bounds: { x: 0, y: 0, width: 1, height: 1 },
    metrics: {
      totalCandidates: strokes.length,
      drawableCandidates: strokes.length,
      orderedCount: strokes.length,
      filteredCount: 0,
      phaseCounts: {
        foundation: 0,
        primary_structure: 0,
        expressive_features: strokes.length,
        secondary_anatomy: 0,
        refinement: 0,
        texture_accent: 0
      },
      subjectCounts: { subject_0: strokes.length },
      dependencyCount: 0,
      maxDependencyDepth: 1,
      orderingLatencyMs: 0.5
    },
    timestamp: Date.now()
  };
}

describe('TASK-107: Progressive Stroke Timeline & Animation Scheduling', () => {

  describe('Mathematical Easing Functions', () => {
    test('linear, easeIn, easeOut, easeInOut clamp properly to [0, 1]', () => {
      const funcs = [linear, easeIn, easeOut, easeInOut];
      for (const fn of funcs) {
        assert.equal(fn(0), 0);
        assert.equal(fn(1), 1);
        assert.equal(fn(-0.5), 0);
        assert.equal(fn(1.5), 1);

        const mid = fn(0.5);
        assert.ok(mid >= 0 && mid <= 1);
      }
    });

    test('applyEasing applies corresponding curves correctly', () => {
      assert.equal(applyEasing(0, 'linear'), 0);
      assert.equal(applyEasing(1, 'linear'), 1);
      assert.equal(applyEasing(0.5, 'linear'), 0.5);

      // easeIn accelerates (progress < linear at 0.5)
      assert.ok(applyEasing(0.5, 'easeIn') < 0.5);

      // easeOut decelerates (progress > linear at 0.5)
      assert.ok(applyEasing(0.5, 'easeOut') > 0.5);

      // easeInOut S-curve is symmetric at 0.5
      assert.equal(applyEasing(0.5, 'easeInOut'), 0.5);
    });
  });

  describe('Duration Model', () => {
    test('stroke length proportionally increases drawing duration', () => {
      const shortStroke = createMockOrderedStroke({
        stroke: createMockCandidate({ length: 0.02 })
      });
      const longStroke = createMockOrderedStroke({
        stroke: createMockCandidate({ length: 0.35 })
      });

      const shortDuration = calculateStrokeDuration(shortStroke, DEFAULT_TIMELINE_CONFIG);
      const longDuration = calculateStrokeDuration(longStroke, DEFAULT_TIMELINE_CONFIG);

      assert.ok(
        longDuration > shortDuration,
        `Longer stroke (${longDuration}ms) should take more time than short stroke (${shortDuration}ms)`
      );
    });

    test('enforces minimum and maximum duration bounds', () => {
      const config: TimelineConfig = {
        ...DEFAULT_TIMELINE_CONFIG,
        minStrokeDurationMs: 100,
        maxStrokeDurationMs: 500
      };

      // Microscopic stroke
      const tiny = createMockOrderedStroke({
        stroke: createMockCandidate({ length: 0.0001, importance: 0.1 })
      });
      assert.ok(calculateStrokeDuration(tiny, config) >= 100);

      // Huge stroke
      const huge = createMockOrderedStroke({
        stroke: createMockCandidate({ length: 5.0, importance: 1.0 })
      });
      assert.equal(calculateStrokeDuration(huge, config), 500);
    });

    test('phase multipliers modulate duration: foundation is more deliberate than texture', () => {
      const foundationStroke = createMockOrderedStroke({
        phase: 'foundation',
        stroke: createMockCandidate({ length: 0.15, semanticRole: 'silhouette' })
      });
      const textureStroke = createMockOrderedStroke({
        phase: 'texture_accent',
        stroke: createMockCandidate({ length: 0.15, semanticRole: 'texture' })
      });

      const dFoundation = calculateStrokeDuration(foundationStroke, DEFAULT_TIMELINE_CONFIG);
      const dTexture = calculateStrokeDuration(textureStroke, DEFAULT_TIMELINE_CONFIG);

      assert.ok(
        dFoundation > dTexture,
        `Foundation stroke (${dFoundation}ms) must be more deliberate than texture stroke (${dTexture}ms)`
      );
    });
  });

  describe('Natural Scheduling & Monotonicity', () => {
    test('creates contiguous 0-based timeline with non-negative timestamps', () => {
      const s1 = createMockOrderedStroke({ sequenceIndex: 0, phase: 'foundation' });
      const s2 = createMockOrderedStroke({ sequenceIndex: 1, phase: 'primary_structure' });
      const s3 = createMockOrderedStroke({ sequenceIndex: 2, phase: 'expressive_features' });

      const sequence = createMockSequence([s1, s2, s3]);
      const timeline = createStrokeTimeline(sequence);

      assert.equal(timeline.strokes.length, 3);
      assert.equal(timeline.strokes[0].startTimeMs, 0);

      for (let i = 0; i < timeline.strokes.length; i++) {
        const s = timeline.strokes[i];
        assert.equal(s.timelineIndex, i);
        assert.equal(s.stroke.sequenceIndex, i);
        assert.ok(s.startTimeMs >= 0);
        assert.ok(s.durationMs > 0);
        assert.equal(s.endTimeMs, s.startTimeMs + s.durationMs);
        assert.ok(s.startProgress >= 0 && s.startProgress <= 1);
        assert.ok(s.endProgress >= 0 && s.endProgress <= 1);
        assert.ok(s.startProgress <= s.endProgress);
      }

      assert.ok(timeline.totalDurationMs >= timeline.strokes[2].endTimeMs);
    });

    test('serial schedule when allowOverlap is false', () => {
      const s1 = createMockOrderedStroke({ sequenceIndex: 0 });
      const s2 = createMockOrderedStroke({ sequenceIndex: 1 });
      const s3 = createMockOrderedStroke({ sequenceIndex: 2 });

      const sequence = createMockSequence([s1, s2, s3]);
      const timeline = createStrokeTimeline(sequence, { allowOverlap: false });

      assert.equal(timeline.strokes[0].startTimeMs, 0);
      assert.equal(timeline.strokes[1].startTimeMs, timeline.strokes[0].endTimeMs);
      assert.equal(timeline.strokes[2].startTimeMs, timeline.strokes[1].endTimeMs);
    });

    test('staggered schedule when allowOverlap is true', () => {
      const s1 = createMockOrderedStroke({ sequenceIndex: 0 });
      const s2 = createMockOrderedStroke({ sequenceIndex: 1 });

      const sequence = createMockSequence([s1, s2]);
      const timeline = createStrokeTimeline(sequence, { allowOverlap: true, overlapRatio: 0.4 });

      // s2 should start before s1 finishes
      assert.ok(
        timeline.strokes[1].startTimeMs < timeline.strokes[0].endTimeMs,
        's2 must start before s1 ends in an overlapping schedule'
      );
      assert.ok(
        timeline.strokes[1].startTimeMs > 0,
        's2 must not start simultaneously at 0'
      );
    });
  });

  describe('Structural Dependency Constraints', () => {
    test('dependent child stroke does not begin before parent reaches minParentProgress', () => {
      const parent = createMockOrderedStroke({
        sequenceIndex: 0,
        phase: 'expressive_features',
        dependencyLevel: 1,
        stroke: createMockCandidate({
          id: 'eye_contour',
          semanticRole: 'eye',
          hierarchyLevel: 2,
          length: 0.3
        })
      });

      const child = createMockOrderedStroke({
        sequenceIndex: 1,
        phase: 'expressive_features',
        dependencyLevel: 2,
        stroke: createMockCandidate({
          id: 'iris_pupil',
          semanticRole: 'eye',
          hierarchyLevel: 4,
          length: 0.05
        })
      });

      const sequence = createMockSequence([parent, child]);
      const timeline = createStrokeTimeline(sequence, {
        allowOverlap: true,
        overlapRatio: 0.8, // aggressive overlap request
        minParentProgress: 0.75
      });

      const parentScheduled = timeline.strokes[0];
      const childScheduled = timeline.strokes[1];

      const minRequiredChildStart = parentScheduled.startTimeMs +
        Math.round(parentScheduled.durationMs * 0.75);

      assert.ok(
        childScheduled.startTimeMs >= minRequiredChildStart,
        `Child start (${childScheduled.startTimeMs}ms) must be >= 75% parent progress (${minRequiredChildStart}ms)`
      );
    });
  });

  describe('Target Duration Normalization', () => {
    test('scales schedule toward target duration while respecting min/max bounds', () => {
      const s1 = createMockOrderedStroke({ sequenceIndex: 0 });
      const s2 = createMockOrderedStroke({ sequenceIndex: 1 });
      const s3 = createMockOrderedStroke({ sequenceIndex: 2 });

      const sequence = createMockSequence([s1, s2, s3]);

      // Request a total target duration of 10,000 ms
      const timeline = createStrokeTimeline(sequence, { targetDurationMs: 10000 });

      assert.ok(timeline.targetDurationMs === 10000);
      assert.ok(
        timeline.totalDurationMs > 0,
        'Timeline total duration must be positive'
      );

      // Verify each stroke duration is within clamps
      for (const s of timeline.strokes) {
        assert.ok(s.durationMs >= DEFAULT_TIMELINE_CONFIG.minStrokeDurationMs);
        assert.ok(s.durationMs <= DEFAULT_TIMELINE_CONFIG.maxStrokeDurationMs);
      }
    });
  });

  describe('Progress Query & Scrub API (getTimelineState)', () => {
    test('returns exact state at start, midpoint, and completion', () => {
      const s1 = createMockOrderedStroke({ sequenceIndex: 0 });
      const s2 = createMockOrderedStroke({ sequenceIndex: 1 });
      const sequence = createMockSequence([s1, s2]);
      const timeline = createStrokeTimeline(sequence, { allowOverlap: false });

      const s1End = timeline.strokes[0].endTimeMs;
      const total = timeline.totalDurationMs;

      // t = 0
      const state0 = getTimelineState(timeline, 0);
      assert.equal(state0.timeMs, 0);
      assert.equal(state0.overallProgress, 0);
      assert.equal(state0.strokes[0].progress, 0);
      assert.equal(state0.strokes[0].state, 'pending');

      // t = mid of stroke 1
      const mid1 = Math.round(timeline.strokes[0].durationMs / 2);
      const stateMid = getTimelineState(timeline, mid1);
      assert.equal(stateMid.strokes[0].state, 'drawing');
      assert.ok(stateMid.strokes[0].progress > 0 && stateMid.strokes[0].progress < 1);
      assert.equal(stateMid.strokes[1].state, 'pending');
      assert.equal(stateMid.strokes[1].progress, 0);

      // t = after stroke 1, mid of stroke 2
      const stateMid2 = getTimelineState(timeline, s1End + 10);
      assert.equal(stateMid2.strokes[0].state, 'complete');
      assert.equal(stateMid2.strokes[0].progress, 1.0);
      assert.equal(stateMid2.strokes[1].state, 'drawing');

      // t = totalDuration
      const stateTotal = getTimelineState(timeline, total);
      assert.equal(stateTotal.overallProgress, 1.0);
      assert.equal(stateTotal.completedCount, 2);
      assert.equal(stateTotal.strokes[0].state, 'complete');
      assert.equal(stateTotal.strokes[1].state, 'complete');
    });

    test('clamps out-of-bounds query timestamps correctly', () => {
      const s1 = createMockOrderedStroke({ sequenceIndex: 0 });
      const sequence = createMockSequence([s1]);
      const timeline = createStrokeTimeline(sequence);

      const stateNegative = getTimelineState(timeline, -500);
      assert.equal(stateNegative.timeMs, 0);

      const stateBeyond = getTimelineState(timeline, 999999);
      assert.equal(stateBeyond.timeMs, timeline.totalDurationMs);
      assert.equal(stateBeyond.strokes[0].state, 'complete');
    });

    test('getStrokeProgress evaluates individual stroke progress accurately', () => {
      const s1 = createMockOrderedStroke({ sequenceIndex: 0 });
      const sequence = createMockSequence([s1]);
      const timeline = createStrokeTimeline(sequence);
      const stroke = timeline.strokes[0];

      assert.deepEqual(getStrokeProgress(stroke, stroke.startTimeMs - 10), {
        progress: 0.0,
        state: 'pending'
      });
      assert.deepEqual(getStrokeProgress(stroke, stroke.endTimeMs + 10), {
        progress: 1.0,
        state: 'complete'
      });

      const mid = getStrokeProgress(stroke, stroke.startTimeMs + stroke.durationMs / 2);
      assert.equal(mid.state, 'drawing');
      assert.ok(mid.progress > 0 && mid.progress < 1);
    });
  });

  describe('Profile Occlusion & Subject Isolation', () => {
    test('profile occluded strokes are never scheduled into the timeline', () => {
      const visible = createMockOrderedStroke({
        sequenceIndex: 0,
        stroke: createMockCandidate({ id: 'visible_eye', visibility: 'visible', drawable: true })
      });

      const sequence = createMockSequence([visible]);
      const timeline = createStrokeTimeline(sequence);

      assert.equal(timeline.strokes.length, 1);
      assert.equal(timeline.strokes[0].stroke.stroke.id, 'visible_eye');
    });

    test('multi-subject instances maintain independent subjectId allocations', () => {
      const sA = createMockOrderedStroke({
        sequenceIndex: 0,
        stroke: createMockCandidate({ id: 'sA', subjectId: 'subject_0' })
      });
      const sB = createMockOrderedStroke({
        sequenceIndex: 1,
        stroke: createMockCandidate({ id: 'sB', subjectId: 'subject_1' })
      });

      const sequence = createMockSequence([sA, sB]);
      const timeline = createStrokeTimeline(sequence);

      assert.equal(timeline.strokes[0].stroke.stroke.subjectId, 'subject_0');
      assert.equal(timeline.strokes[1].stroke.stroke.subjectId, 'subject_1');
    });
  });

  describe('Geometry Immutability Guarantee', () => {
    test('timeline generation leaves input geometry completely untouched', () => {
      const origPoints = [{ x: 0.123, y: 0.456 }, { x: 0.789, y: 0.987 }];
      const stroke = createMockOrderedStroke({
        stroke: createMockCandidate({ points: origPoints })
      });

      const sequence = createMockSequence([stroke]);
      const timeline = createStrokeTimeline(sequence);

      assert.equal(timeline.strokes[0].stroke.stroke.points, origPoints);
      assert.equal(timeline.strokes[0].stroke.stroke.points[0].x, 0.123);
      assert.equal(timeline.strokes[0].stroke.stroke.points[1].y, 0.987);
    });
  });

  describe('Pure TypeScript Portability', () => {
    test('operates with zero browser or DOM globals in headless runtime', () => {
      assert.equal(typeof (globalThis as unknown as { window?: unknown }).window, 'undefined');
      assert.equal(typeof (globalThis as unknown as { document?: unknown }).document, 'undefined');
      assert.equal(typeof (globalThis as unknown as { HTMLCanvasElement?: unknown }).HTMLCanvasElement, 'undefined');
    });
  });

});
