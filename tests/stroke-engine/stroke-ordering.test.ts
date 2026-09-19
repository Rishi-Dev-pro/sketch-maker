import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  StrokeCandidate,
  StrokeCandidateSet,
  StrokeSemanticRole,
  CompositionPhase,
  PathHierarchyLevel
} from '@sketch-maker/shared-types';
import {
  orderStrokeCandidates,
  assignCompositionPhase,
  analyzeDependencies,
  validateOrderedStrokeSequence,
  COMPOSITION_PHASES
} from '@sketch-maker/stroke-engine';

describe('TASK-106: Stroke Ordering & Composition', () => {

  // Helper to create valid StrokeCandidate for testing
  function createTestCandidate(overrides?: Partial<StrokeCandidate>): StrokeCandidate {
    return {
      id: 'test_stroke_1',
      subjectId: 'subject_0',
      sourcePathId: 'path_1',
      source: 'face_contour',
      points: [
        { x: 0.3, y: 0.3 },
        { x: 0.35, y: 0.32 },
        { x: 0.4, y: 0.3 }
      ],
      closed: false,
      confidence: 0.9,
      importance: 0.85,
      priorityScore: 0.82,
      semanticRole: 'eye',
      hierarchyLevel: 2,
      width: 1.6,
      density: 0.9,
      length: 0.105,
      bounds: { x: 0.3, y: 0.3, width: 0.1, height: 0.02 },
      visibility: 'visible',
      drawable: true,
      isBackground: false,
      ...overrides
    };
  }

  function createTestCandidateSet(candidates: StrokeCandidate[]): StrokeCandidateSet {
    return {
      version: '0.1.0',
      candidates,
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      metrics: {
        totalCandidates: candidates.length,
        drawableCandidates: candidates.filter((c) => c.drawable).length,
        filteredCandidates: candidates.filter((c) => !c.drawable).length,
        totalLength: candidates.reduce((s, c) => s + c.length, 0),
        averageLength: 0.1,
        averageConfidence: 0.9,
        averageImportance: 0.8,
        averageWidth: 1.5,
        strokesBySemanticRole: {},
        strokesByHierarchy: {},
        strokesBySubject: {},
        generationLatencyMs: 1.2
      },
      timestamp: 1726700000000
    };
  }

  describe('Composition Phase Assignment', () => {
    it('assigns all 12 semantic roles to valid progressive composition phases', () => {
      const roles: StrokeSemanticRole[] = [
        'silhouette',
        'facial_contour',
        'eye',
        'eyebrow',
        'nose',
        'mouth',
        'ear',
        'hair',
        'body_structure',
        'clothing_boundary',
        'semantic_boundary',
        'texture',
        'detail',
        'background'
      ];

      for (const role of roles) {
        const candidate = createTestCandidate({ semanticRole: role });
        const info = assignCompositionPhase(candidate);

        assert.ok(info.phase in COMPOSITION_PHASES, `Role ${role} mapped to invalid phase ${info.phase}`);
        assert.equal(info.phaseIndex, COMPOSITION_PHASES[info.phase].index);
        assert.ok(info.phaseName.length > 0);
      }
    });

    it('maps silhouette to foundation (phase 0)', () => {
      const candidate = createTestCandidate({ semanticRole: 'silhouette', hierarchyLevel: 0 });
      const info = assignCompositionPhase(candidate);
      assert.equal(info.phase, 'foundation');
      assert.equal(info.phaseIndex, 0);
    });

    it('maps facial_contour and body_structure to primary_structure (phase 1)', () => {
      const jaw = createTestCandidate({ semanticRole: 'facial_contour', hierarchyLevel: 1 });
      assert.equal(assignCompositionPhase(jaw).phase, 'primary_structure');

      const pose = createTestCandidate({ semanticRole: 'body_structure', hierarchyLevel: 1 });
      assert.equal(assignCompositionPhase(pose).phase, 'primary_structure');
    });

    it('maps eyes, eyebrows, nose, mouth to expressive_features (phase 2)', () => {
      const eye = createTestCandidate({ semanticRole: 'eye' });
      const brow = createTestCandidate({ semanticRole: 'eyebrow' });
      const nose = createTestCandidate({ semanticRole: 'nose' });
      const mouth = createTestCandidate({ semanticRole: 'mouth' });

      assert.equal(assignCompositionPhase(eye).phase, 'expressive_features');
      assert.equal(assignCompositionPhase(brow).phase, 'expressive_features');
      assert.equal(assignCompositionPhase(nose).phase, 'expressive_features');
      assert.equal(assignCompositionPhase(mouth).phase, 'expressive_features');
    });

    it('maps hair and clothing to secondary_anatomy (phase 3)', () => {
      const hair = createTestCandidate({ semanticRole: 'hair' });
      const cloth = createTestCandidate({ semanticRole: 'clothing_boundary' });
      assert.equal(assignCompositionPhase(hair).phase, 'secondary_anatomy');
      assert.equal(assignCompositionPhase(cloth).phase, 'secondary_anatomy');
    });

    it('maps background strokes to texture_accent (phase 5)', () => {
      const bg = createTestCandidate({ semanticRole: 'background', isBackground: true });
      assert.equal(assignCompositionPhase(bg).phase, 'texture_accent');
      assert.equal(assignCompositionPhase(bg).phaseIndex, 5);
    });
  });

  describe('Structural Dependency Analysis', () => {
    it('computes hierarchy levels: foundation/structure at 0, expressive at 1, details at 2', () => {
      const candidates = [
        createTestCandidate({ id: 's0', semanticRole: 'silhouette', hierarchyLevel: 0 }),
        createTestCandidate({ id: 's1', semanticRole: 'facial_contour', hierarchyLevel: 1 }),
        createTestCandidate({ id: 's2', semanticRole: 'eye', hierarchyLevel: 2 }),
        createTestCandidate({ id: 's3', semanticRole: 'detail', hierarchyLevel: 4 })
      ];

      const phaseMap = new Map<string, CompositionPhase>();
      for (const c of candidates) {
        phaseMap.set(c.id, assignCompositionPhase(c).phase);
      }

      const { dependencyLevels, totalEdges, maxDepth } = analyzeDependencies(candidates, phaseMap);

      assert.equal(dependencyLevels.get('s0'), 0);
      assert.equal(dependencyLevels.get('s1'), 0);
      assert.equal(dependencyLevels.get('s2'), 1);
      assert.equal(dependencyLevels.get('s3'), 2);
      assert.equal(maxDepth, 2);
      assert.equal(totalEdges, 2); // s2 and s3 are dependent
    });
  });

  describe('Deterministic Multi-Factor Ordering', () => {
    it('structures progression from foundation to expressive features to details', () => {
      const candidates = [
        createTestCandidate({ id: 'stroke_detail', semanticRole: 'detail', hierarchyLevel: 4, bounds: { x: 0.3, y: 0.35, width: 0.1, height: 0.01 } }),
        createTestCandidate({ id: 'stroke_eye', semanticRole: 'eye', hierarchyLevel: 2, bounds: { x: 0.3, y: 0.3, width: 0.1, height: 0.02 } }),
        createTestCandidate({ id: 'stroke_jaw', semanticRole: 'facial_contour', hierarchyLevel: 1, bounds: { x: 0.2, y: 0.4, width: 0.4, height: 0.2 } }),
        createTestCandidate({ id: 'stroke_silh', semanticRole: 'silhouette', hierarchyLevel: 0, bounds: { x: 0.1, y: 0.1, width: 0.7, height: 0.8 } })
      ];

      const set = createTestCandidateSet(candidates);
      const sequence = orderStrokeCandidates(set);

      assert.equal(sequence.strokes.length, 4);
      // Phase 0: silhouette
      assert.equal(sequence.strokes[0].stroke.id, 'stroke_silh');
      assert.equal(sequence.strokes[0].phase, 'foundation');
      // Phase 1: jawline
      assert.equal(sequence.strokes[1].stroke.id, 'stroke_jaw');
      assert.equal(sequence.strokes[1].phase, 'primary_structure');
      // Phase 2: eye
      assert.equal(sequence.strokes[2].stroke.id, 'stroke_eye');
      assert.equal(sequence.strokes[2].phase, 'expressive_features');
      // Phase 4: detail
      assert.equal(sequence.strokes[3].stroke.id, 'stroke_detail');
      assert.equal(sequence.strokes[3].phase, 'refinement');
    });

    it('enforces expressive role precedence: eye before eyebrow before nose before mouth', () => {
      const candidates = [
        createTestCandidate({ id: 'mouth_1', semanticRole: 'mouth', bounds: { x: 0.4, y: 0.5, width: 0.2, height: 0.05 } }),
        createTestCandidate({ id: 'nose_1', semanticRole: 'nose', bounds: { x: 0.45, y: 0.4, width: 0.1, height: 0.08 } }),
        createTestCandidate({ id: 'brow_1', semanticRole: 'eyebrow', bounds: { x: 0.3, y: 0.25, width: 0.15, height: 0.03 } }),
        createTestCandidate({ id: 'eye_1', semanticRole: 'eye', bounds: { x: 0.3, y: 0.3, width: 0.1, height: 0.03 } })
      ];

      const set = createTestCandidateSet(candidates);
      const sequence = orderStrokeCandidates(set);

      const orderedRoles = sequence.strokes.map((s) => s.stroke.semanticRole);
      assert.deepEqual(orderedRoles, ['eye', 'eyebrow', 'nose', 'mouth']);
    });

    it('produces byte-for-byte identical ordered sequences across repeated executions', () => {
      const candidates = [
        createTestCandidate({ id: 'mouth_1', semanticRole: 'mouth', importance: 0.85 }),
        createTestCandidate({ id: 'eye_r', semanticRole: 'eye', importance: 0.92 }),
        createTestCandidate({ id: 'eye_l', semanticRole: 'eye', importance: 0.95 }),
        createTestCandidate({ id: 'silh_1', semanticRole: 'silhouette', hierarchyLevel: 0 }),
        createTestCandidate({ id: 'jaw_1', semanticRole: 'facial_contour', hierarchyLevel: 1 })
      ];

      const set = createTestCandidateSet(candidates);
      const seqA = orderStrokeCandidates(set);
      const seqB = orderStrokeCandidates(set);

      assert.equal(seqA.strokes.length, seqB.strokes.length);
      for (let i = 0; i < seqA.strokes.length; i++) {
        assert.equal(seqA.strokes[i].stroke.id, seqB.strokes[i].stroke.id);
        assert.equal(seqA.strokes[i].sequenceIndex, seqB.strokes[i].sequenceIndex);
        assert.equal(seqA.strokes[i].phase, seqB.strokes[i].phase);
      }
    });
  });

  describe('Multi-Person Isolation (BM-11)', () => {
    it('preserves distinct subjectId attributes with harmonized phase progression', () => {
      const candidates = [
        createTestCandidate({ id: 'p0_silh', subjectId: 'subject_0', semanticRole: 'silhouette', hierarchyLevel: 0 }),
        createTestCandidate({ id: 'p1_silh', subjectId: 'subject_1', semanticRole: 'silhouette', hierarchyLevel: 0 }),
        createTestCandidate({ id: 'p0_eye', subjectId: 'subject_0', semanticRole: 'eye', hierarchyLevel: 2 }),
        createTestCandidate({ id: 'p1_eye', subjectId: 'subject_1', semanticRole: 'eye', hierarchyLevel: 2 })
      ];

      const set = createTestCandidateSet(candidates);
      const sequence = orderStrokeCandidates(set, { multiSubjectStrategy: 'harmonized_phase' });

      // Both silhouettes (Phase 0) must precede both eyes (Phase 2)
      assert.equal(sequence.strokes[0].phase, 'foundation');
      assert.equal(sequence.strokes[1].phase, 'foundation');
      assert.equal(sequence.strokes[2].phase, 'expressive_features');
      assert.equal(sequence.strokes[3].phase, 'expressive_features');

      // Subject tags are strictly preserved
      const subjects = sequence.strokes.map((s) => s.stroke.subjectId);
      assert.deepEqual(subjects, ['subject_0', 'subject_1', 'subject_0', 'subject_1']);
    });

    it('supports sequential subject strategy when configured', () => {
      const candidates = [
        createTestCandidate({ id: 'p0_eye', subjectId: 'subject_0', semanticRole: 'eye', hierarchyLevel: 2 }),
        createTestCandidate({ id: 'p1_silh', subjectId: 'subject_1', semanticRole: 'silhouette', hierarchyLevel: 0 }),
        createTestCandidate({ id: 'p0_silh', subjectId: 'subject_0', semanticRole: 'silhouette', hierarchyLevel: 0 }),
        createTestCandidate({ id: 'p1_eye', subjectId: 'subject_1', semanticRole: 'eye', hierarchyLevel: 2 })
      ];

      const set = createTestCandidateSet(candidates);
      const sequence = orderStrokeCandidates(set, { multiSubjectStrategy: 'sequential_subject' });

      // All subject_0 strokes first, then all subject_1 strokes
      assert.equal(sequence.strokes[0].stroke.subjectId, 'subject_0');
      assert.equal(sequence.strokes[1].stroke.subjectId, 'subject_0');
      assert.equal(sequence.strokes[2].stroke.subjectId, 'subject_1');
      assert.equal(sequence.strokes[3].stroke.subjectId, 'subject_1');
    });
  });

  describe('Profile Occlusion Enforcement (BM-02)', () => {
    it('strictly excludes occluded candidates from drawable sequence while preserving them in filteredStrokes', () => {
      const candidates = [
        createTestCandidate({ id: 'visible_eye', semanticRole: 'eye', drawable: true, visibility: 'visible' }),
        createTestCandidate({
          id: 'occluded_eye',
          semanticRole: 'eye',
          drawable: false,
          visibility: 'occluded',
          filteredReason: 'occluded'
        })
      ];

      const set = createTestCandidateSet(candidates);
      const sequence = orderStrokeCandidates(set);

      assert.equal(sequence.drawableStrokes, 1);
      assert.equal(sequence.strokes.length, 1);
      assert.equal(sequence.strokes[0].stroke.id, 'visible_eye');

      // Occluded stroke is safely preserved in filteredStrokes for diagnostics
      assert.equal(sequence.filteredStrokes.length, 1);
      assert.equal(sequence.filteredStrokes[0].id, 'occluded_eye');
      assert.equal(sequence.filteredStrokes[0].filteredReason, 'occluded');
    });
  });

  describe('Geometry Immutability Guarantee', () => {
    it('leaves input candidate points, curves, length, and width completely unmodified', () => {
      const originalPoints = [
        { x: 0.123, y: 0.456 },
        { x: 0.234, y: 0.567 },
        { x: 0.345, y: 0.678 }
      ];

      const candidate = createTestCandidate({
        points: [...originalPoints],
        width: 2.15,
        length: 0.312
      });

      const set = createTestCandidateSet([candidate]);
      const sequence = orderStrokeCandidates(set);

      const ordered = sequence.strokes[0].stroke;
      assert.deepEqual(ordered.points, originalPoints);
      assert.equal(ordered.width, 2.15);
      assert.equal(ordered.length, 0.312);
    });
  });

  describe('Sequence Integrity & Validation', () => {
    it('validates contiguous 0-based sequence indices without gaps or duplicates', () => {
      const candidates = [
        createTestCandidate({ id: 's1', semanticRole: 'silhouette' }),
        createTestCandidate({ id: 's2', semanticRole: 'facial_contour' }),
        createTestCandidate({ id: 's3', semanticRole: 'eye' })
      ];

      const set = createTestCandidateSet(candidates);
      const sequence = orderStrokeCandidates(set);
      const validation = validateOrderedStrokeSequence(sequence);

      assert.equal(validation.isValid, true);
      assert.equal(validation.issues.length, 0);

      // Verify sequence indices
      sequence.strokes.forEach((s, idx) => {
        assert.equal(s.sequenceIndex, idx);
      });
    });

    it('rejects sequence with index gaps or duplicate stroke IDs', () => {
      const candidate = createTestCandidate({ id: 's1' });
      const badSequence = {
        version: '0.1.0',
        strokes: [
          {
            stroke: candidate,
            sequenceIndex: 0,
            phase: 'foundation' as CompositionPhase,
            phaseIndex: 0,
            phaseName: 'Foundation',
            dependencyLevel: 0,
            orderingReason: 'test'
          },
          {
            stroke: candidate, // Duplicate!
            sequenceIndex: 2,  // Gap!
            phase: 'foundation' as CompositionPhase,
            phaseIndex: 0,
            phaseName: 'Foundation',
            dependencyLevel: 0,
            orderingReason: 'test'
          }
        ],
        totalStrokes: 2,
        drawableStrokes: 2,
        filteredStrokes: [],
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        metrics: {
          totalCandidates: 2,
          drawableCandidates: 2,
          orderedCount: 2,
          filteredCount: 0,
          phaseCounts: { foundation: 2, primary_structure: 0, expressive_features: 0, secondary_anatomy: 0, refinement: 0, texture_accent: 0 },
          subjectCounts: { subject_0: 2 },
          dependencyCount: 0,
          maxDependencyDepth: 0,
          orderingLatencyMs: 0.5
        },
        timestamp: Date.now()
      };

      const result = validateOrderedStrokeSequence(badSequence);
      assert.equal(result.isValid, false);
      assert.ok(result.issues.some((i) => i.field === 'sequenceIndex'));
      assert.ok(result.issues.some((i) => i.field === 'strokeId'));
    });
  });

  describe('Pure TypeScript Portability', () => {
    it('runs with zero browser or DOM globals in headless runtime', () => {
      assert.equal(typeof (globalThis as any).window, 'undefined');
      assert.equal(typeof (globalThis as any).document, 'undefined');
      assert.equal(typeof (globalThis as any).HTMLCanvasElement, 'undefined');
    });
  });
});
