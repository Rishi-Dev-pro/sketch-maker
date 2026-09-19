import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Point2D,
  BezierCurve,
  StrokeCandidate,
  OrderedStroke,
  OrderedStrokeSequence,
  DEFAULT_STROKE_GENERATION_CONFIG,
  StrokeTimeline
} from '@sketch-maker/shared-types';
import {
  evaluateCubicBezier,
  evaluateCubicBezierDerivative,
  trimCubicBezier,
  approximateCubicBezierLength,
  getPartialStrokeGeometry,
  createRenderState,
  validateRenderState
} from '../../packages/stroke-engine/src/rendering';
import { createStrokeTimeline } from '../../packages/stroke-engine/src/timeline';

// Helper to create a mock StrokeCandidate
function createMockCandidate(overrides: Partial<StrokeCandidate> = {}): StrokeCandidate {
  const points: Point2D[] = overrides.points ?? [
    { x: 0.1, y: 0.1 },
    { x: 0.5, y: 0.5 },
    { x: 0.9, y: 0.9 }
  ];

  return {
    id: overrides.id ?? 'mock-candidate-1',
    subjectId: overrides.subjectId ?? 'subject-0',
    sourcePathId: overrides.sourcePathId ?? 'path-1',
    source: overrides.source ?? 'deterministic_face',
    points,
    curves: overrides.curves,
    closed: overrides.closed ?? false,
    confidence: overrides.confidence ?? 0.95,
    importance: overrides.importance ?? 0.85,
    priorityScore: overrides.priorityScore ?? 0.8,
    semanticRole: overrides.semanticRole ?? 'eye',
    hierarchyLevel: overrides.hierarchyLevel ?? 2,
    width: overrides.width ?? 1.5,
    density: overrides.density ?? 0.7,
    length: overrides.length ?? 0.25,
    bounds: overrides.bounds ?? { minX: 0.1, minY: 0.1, maxX: 0.9, maxY: 0.9 },
    drawable: overrides.drawable ?? true,
    isBackground: overrides.isBackground ?? false,
    ...overrides
  };
}

// Helper to create a mock OrderedStrokeSequence
function createMockSequence(candidates: StrokeCandidate[]): OrderedStrokeSequence {
  const orderedStrokes: OrderedStroke[] = candidates
    .filter(c => c.drawable)
    .map((c, idx) => ({
      stroke: c,
      sequenceIndex: idx,
      phase: 'expressive_features',
      phaseIndex: idx,
      phaseName: 'Expressive Features',
      dependencyLevel: 1,
      orderingReason: 'Mock ordering'
    }));

  const filteredStrokes = candidates.filter(c => !c.drawable);

  return {
    version: '0.1.0',
    strokes: orderedStrokes,
    totalStrokes: candidates.length,
    drawableStrokes: orderedStrokes.length,
    filteredStrokes,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    metrics: {
      totalCandidates: candidates.length,
      drawableCandidates: orderedStrokes.length,
      orderedCount: orderedStrokes.length,
      filteredCount: filteredStrokes.length,
      phaseCounts: {
        foundation: 0,
        primary_structure: 0,
        expressive_features: orderedStrokes.length,
        secondary_anatomy: 0,
        refinement: 0,
        texture_accent: 0
      },
      subjectCounts: { 'subject-0': orderedStrokes.length },
      dependencyCount: 0,
      maxDependencyDepth: 1,
      orderingLatencyMs: 0.5
    },
    timestamp: Date.now()
  };
}

test('TASK-108: Procedural Stroke Renderer & Partial Geometry', async (t) => {

  await t.test('De Casteljau Cubic Bézier Subdivision', () => {
    const curve: BezierCurve = {
      start: { x: 0.0, y: 0.0 },
      cp1: { x: 0.0, y: 1.0 },
      cp2: { x: 1.0, y: 1.0 },
      end: { x: 1.0, y: 0.0 }
    };

    // Test evaluation at t = 0, 0.5, 1.0
    const pStart = evaluateCubicBezier(curve, 0.0);
    assert.equal(pStart.x, 0.0);
    assert.equal(pStart.y, 0.0);

    const pMid = evaluateCubicBezier(curve, 0.5);
    assert.equal(pMid.x, 0.5);
    assert.equal(pMid.y, 0.75);

    const pEnd = evaluateCubicBezier(curve, 1.0);
    assert.equal(pEnd.x, 1.0);
    assert.equal(pEnd.y, 0.0);

    // Test De Casteljau subdivision at t = 0.5
    const trimmed = trimCubicBezier(curve, 0.5);
    assert.equal(trimmed.subCurve.start.x, 0.0);
    assert.equal(trimmed.subCurve.start.y, 0.0);
    assert.equal(trimmed.tipPoint.x, 0.5);
    assert.equal(trimmed.tipPoint.y, 0.75);

    // Tangent at midpoint should be horizontal: dx > 0, dy approx 0
    assert.ok(trimmed.tipTangent.x > 0.99);
    assert.ok(Math.abs(trimmed.tipTangent.y) < 1e-4);

    // Arc length approximation should be positive and greater than chord
    const arcLen = approximateCubicBezierLength(curve);
    assert.ok(arcLen > 1.0); // Chord is 1.0, curve loops up to y=0.75
  });

  await t.test('Arc-Length Traversal for Polylines', () => {
    // Non-uniformly spaced polyline:
    // P0(0,0) -> P1(0.1, 0) (length 0.1)
    // P1(0.1, 0) -> P2(1.0, 0) (length 0.9)
    // Total length = 1.0
    const nonUniformCandidate = createMockCandidate({
      points: [
        { x: 0.0, y: 0.0 },
        { x: 0.1, y: 0.0 },
        { x: 1.0, y: 0.0 }
      ]
    });

    // At 50% progress, travel distance = 0.5
    // Segment 1 absorbs 0.1, remaining 0.4 into Segment 2 (length 0.9)
    // Target x should be 0.1 + 0.4 = 0.5 (NOT point-index based!)
    const partial50 = getPartialStrokeGeometry(nonUniformCandidate, 0.5);
    assert.ok(partial50.tipPoint);
    assert.ok(Math.abs(partial50.tipPoint.x - 0.5) < 1e-4);
    assert.equal(partial50.tipPoint.y, 0.0);
    assert.equal(partial50.isComplete, false);

    // At 0% progress: empty geometry
    const partial0 = getPartialStrokeGeometry(nonUniformCandidate, 0.0);
    assert.equal(partial0.points.length, 0);
    assert.equal(partial0.tipPoint, undefined);
    assert.equal(partial0.isComplete, false);

    // At 100% progress: full geometry
    const partial100 = getPartialStrokeGeometry(nonUniformCandidate, 1.0);
    assert.equal(partial100.points.length, 3);
    assert.equal(partial100.tipPoint?.x, 1.0);
    assert.equal(partial100.isComplete, true);
  });

  await t.test('Arc-Length Traversal for Bézier Curves', () => {
    const curve1: BezierCurve = {
      start: { x: 0.0, y: 0.0 },
      cp1: { x: 0.1, y: 0.2 },
      cp2: { x: 0.3, y: 0.2 },
      end: { x: 0.5, y: 0.0 }
    };
    const curve2: BezierCurve = {
      start: { x: 0.5, y: 0.0 },
      cp1: { x: 0.7, y: -0.2 },
      cp2: { x: 0.9, y: -0.2 },
      end: { x: 1.0, y: 0.0 }
    };

    const curveCandidate = createMockCandidate({
      curves: [curve1, curve2]
    });

    // 25% progress: trimmed within curve 1
    const p25 = getPartialStrokeGeometry(curveCandidate, 0.25);
    assert.ok(p25.curves);
    assert.equal(p25.curves.length, 1);
    assert.ok(p25.tipPoint);
    assert.ok(p25.tipPoint.x < 0.5);
    assert.equal(p25.isComplete, false);

    // 75% progress: curve 1 complete + curve 2 partially trimmed
    const p75 = getPartialStrokeGeometry(curveCandidate, 0.75);
    assert.ok(p75.curves);
    assert.equal(p75.curves.length, 2);
    assert.ok(p75.tipPoint);
    assert.ok(p75.tipPoint.x > 0.5);
    assert.equal(p75.isComplete, false);

    // 100% progress: both curves complete
    const p100 = getPartialStrokeGeometry(curveCandidate, 1.0);
    assert.ok(p100.curves);
    assert.equal(p100.curves.length, 2);
    assert.equal(p100.tipPoint?.x, 1.0);
    assert.equal(p100.isComplete, true);
  });

  await t.test('Boundary & Clamping Behavior', () => {
    const candidate = createMockCandidate();

    // Negative progress clamped to 0
    const neg = getPartialStrokeGeometry(candidate, -0.5);
    assert.equal(neg.progress, 0.0);
    assert.equal(neg.points.length, 0);

    // > 1 progress clamped to 1
    const over = getPartialStrokeGeometry(candidate, 1.5);
    assert.equal(over.progress, 1.0);
    assert.equal(over.isComplete, true);
  });

  await t.test('RenderState Compilation from StrokeTimeline', () => {
    const c1 = createMockCandidate({ id: 'c1', points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }] });
    const c2 = createMockCandidate({ id: 'c2', points: [{ x: 0.5, y: 0.5 }, { x: 1, y: 1 }] });
    const seq = createMockSequence([c1, c2]);
    const timeline = createStrokeTimeline(seq, { targetDurationMs: 1000 });

    // At t = 0: no completed strokes, initial stroke starting
    const state0 = createRenderState(timeline, 0);
    assert.equal(state0.timeMs, 0);
    assert.equal(state0.completedCount, 0);

    // At mid-time: active strokes present with partial geometry
    const midTime = timeline.totalDurationMs * 0.5;
    const stateMid = createRenderState(timeline, midTime);
    assert.ok(stateMid.strokes.length > 0);
    const validationMid = validateRenderState(stateMid, timeline);
    assert.equal(validationMid.valid, true);

    // At end of timeline: all strokes completed
    const stateEnd = createRenderState(timeline, timeline.totalDurationMs);
    assert.equal(stateEnd.isComplete, true);
    assert.equal(stateEnd.completedCount, timeline.strokes.length);
    assert.equal(stateEnd.activeCount, 0);
    const validationEnd = validateRenderState(stateEnd, timeline);
    assert.equal(validationEnd.valid, true);
  });

  await t.test('BM-02 Profile Occlusion Enforcement', () => {
    const visibleCandidate = createMockCandidate({ id: 'vis-1', drawable: true });
    const occludedCandidate = createMockCandidate({
      id: 'occ-1',
      drawable: false,
      filteredReason: 'occluded'
    });

    const seq = createMockSequence([visibleCandidate, occludedCandidate]);
    const timeline = createStrokeTimeline(seq);

    const renderState = createRenderState(timeline, timeline.totalDurationMs);
    const ids = renderState.strokes.map(s => s.strokeId);

    // Occluded stroke must NOT appear anywhere in the rendered strokes
    assert.ok(ids.includes('vis-1'));
    assert.ok(!ids.includes('occ-1'));
  });

  await t.test('BM-11 Multi-Person Subject Isolation & Filtering', () => {
    const s0 = createMockCandidate({ id: 's0-stroke', subjectId: 'subject-0', drawable: true });
    const s1 = createMockCandidate({ id: 's1-stroke', subjectId: 'subject-1', drawable: true });

    const seq = createMockSequence([s0, s1]);
    const timeline = createStrokeTimeline(seq);

    // All subjects
    const stateAll = createRenderState(timeline, timeline.totalDurationMs);
    assert.equal(stateAll.strokes.length, 2);

    // Filter subject 0
    const stateS0 = createRenderState(timeline, timeline.totalDurationMs, { filterSubjectId: 'subject-0' });
    assert.equal(stateS0.strokes.length, 1);
    assert.equal(stateS0.strokes[0].subjectId, 'subject-0');

    // Filter subject 1
    const stateS1 = createRenderState(timeline, timeline.totalDurationMs, { filterSubjectId: 'subject-1' });
    assert.equal(stateS1.strokes.length, 1);
    assert.equal(stateS1.strokes[0].subjectId, 'subject-1');
  });

  await t.test('Geometry Immutability Guarantee', () => {
    const origPoints = [{ x: 0.123, y: 0.456 }, { x: 0.789, y: 0.987 }];
    const candidate = createMockCandidate({ points: origPoints });
    const seq = createMockSequence([candidate]);
    const timeline = createStrokeTimeline(seq);

    // Generate render states across various timestamps
    createRenderState(timeline, 0);
    createRenderState(timeline, 500);
    createRenderState(timeline, 1000);

    // Ensure source points are identical
    assert.equal(candidate.points[0].x, 0.123);
    assert.equal(candidate.points[0].y, 0.456);
    assert.equal(candidate.points[1].x, 0.789);
    assert.equal(candidate.points[1].y, 0.987);
  });

  await t.test('Pure TypeScript Portability Guarantee', () => {
    // Assert zero DOM globals in test environment
    assert.equal(typeof (globalThis as any).window, 'undefined');
    assert.equal(typeof (globalThis as any).document, 'undefined');
    assert.equal(typeof (globalThis as any).HTMLCanvasElement, 'undefined');
  });
});
