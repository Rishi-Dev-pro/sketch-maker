import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  Point2D,
  VectorPath,
  VectorGeometry,
  StrokeCandidate,
  StrokeGenerationConfig
} from '@sketch-maker/shared-types';
import {
  generateStrokeCandidates,
  deriveSemanticRole,
  partitionVectorPath,
  computeStrokeWidth,
  computeStrokeDensity,
  computeStrokePriorityScore,
  evaluateStrokeEligibility,
  validateStrokeCandidate
} from '@sketch-maker/stroke-engine';

describe('TASK-105: Procedural Stroke Candidate Generation', () => {

  // ----------------------------------------------------
  // Helper to construct test VectorPath
  // ----------------------------------------------------
  function createTestVectorPath(overrides?: Partial<VectorPath>): VectorPath {
    const points: Point2D[] = [
      { x: 0.2, y: 0.2 },
      { x: 0.25, y: 0.22 },
      { x: 0.3, y: 0.2 }
    ];
    return {
      id: 'test_path_1',
      source: 'face_contour',
      region: 'eyes',
      level: 2,
      points,
      rawPoints: [...points],
      closed: false,
      confidence: 0.95,
      importance: 0.88,
      length: 0.102,
      bounds: { x: 0.2, y: 0.2, width: 0.1, height: 0.02 },
      visibility: 'visible',
      subjectId: 'subject_0',
      ...overrides
    };
  }

  function createTestGeometry(paths: VectorPath[]): VectorGeometry {
    return {
      version: '1.0.0',
      paths,
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      metrics: {
        totalPaths: paths.length,
        totalRawPoints: paths.reduce((s, p) => s + (p.rawPoints?.length || p.points.length), 0),
        totalSimplifiedPoints: paths.reduce((s, p) => s + p.points.length, 0),
        pointReductionRatio: 0.5,
        pathCountByLevel: { 0: 0, 1: 0, 2: paths.length, 3: 0, 4: 0 },
        pathCountByRegion: {},
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        processingTimeMs: 1.0
      },
      timestamp: Date.now()
    };
  }

  // ----------------------------------------------------
  // 1. Contract & Validation
  // ----------------------------------------------------
  describe('StrokeCandidate Contract & Validation', () => {
    it('validates a well-formed stroke candidate', () => {
      const path = createTestVectorPath();
      const geom = createTestGeometry([path]);
      const set = generateStrokeCandidates(geom);

      assert.equal(set.candidates.length, 1);
      const c = set.candidates[0];
      const val = validateStrokeCandidate(c);

      assert.equal(val.valid, true);
      assert.equal(val.errors.length, 0);
      assert.equal(c.subjectId, 'subject_0');
      assert.equal(c.sourcePathId, 'test_path_1');
      assert.equal(c.semanticRole, 'eye');
      assert.equal(c.drawable, true);
      assert.ok(c.width > 0);
      assert.ok(c.density > 0 && c.density <= 1.0);
      assert.ok(c.priorityScore > 0 && c.priorityScore <= 1.0);
    });

    it('rejects candidates with invalid coordinates or NaN values', () => {
      const invalidCandidate: StrokeCandidate = {
        id: 'bad_candidate',
        subjectId: 'sub_0',
        sourcePathId: 'path_0',
        source: 'face_contour',
        points: [{ x: NaN, y: 0.5 }],
        closed: false,
        confidence: 0.8,
        importance: 0.7,
        priorityScore: 0.7,
        semanticRole: 'eye',
        hierarchyLevel: 2,
        width: 1.5,
        density: 0.8,
        length: 0.1,
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        drawable: true,
        isBackground: false
      };

      const val = validateStrokeCandidate(invalidCandidate);
      assert.equal(val.valid, false);
      assert.ok(val.errors.some(e => e.includes('non-finite')));
    });

    it('JSON serialization preserves all fields without corruption', () => {
      const path = createTestVectorPath();
      const set = generateStrokeCandidates(createTestGeometry([path]));
      const serialized = JSON.stringify(set);
      const parsed = JSON.parse(serialized);

      assert.equal(parsed.candidates.length, 1);
      assert.equal(parsed.candidates[0].id, set.candidates[0].id);
      assert.equal(parsed.candidates[0].width, set.candidates[0].width);
      assert.equal(parsed.candidates[0].density, set.candidates[0].density);
    });
  });

  // ----------------------------------------------------
  // 2. Eligibility Filtering & Profile Occlusion
  // ----------------------------------------------------
  describe('Eligibility Filtering & Occlusion Rules', () => {
    it('marks visible features with high confidence as drawable', () => {
      const path = createTestVectorPath({ confidence: 0.9, visibility: 'visible' });
      const elig = evaluateStrokeEligibility(path, path.points, path.length, 'eye', {});
      assert.equal(elig.drawable, true);
      assert.equal(elig.filteredReason, undefined);
    });

    it('strictly suppresses profile occluded features (BM-02)', () => {
      const path = createTestVectorPath({
        id: 'right_eye_hidden',
        visibility: 'occluded',
        confidence: 0.0
      });
      const elig = evaluateStrokeEligibility(path, path.points, path.length, 'eye', {});
      assert.equal(elig.drawable, false);
      assert.equal(elig.filteredReason, 'occluded');

      const set = generateStrokeCandidates(createTestGeometry([path]));
      assert.equal(set.candidates.length, 1);
      assert.equal(set.candidates[0].drawable, false);
      assert.equal(set.candidates[0].filteredReason, 'occluded');
      assert.equal(set.metrics.drawableCandidates, 0);
      assert.equal(set.metrics.filteredCandidates, 1);
    });

    it('filters out low-confidence paths below minConfidence threshold', () => {
      const path = createTestVectorPath({ confidence: 0.08 });
      const config: StrokeGenerationConfig = { minConfidence: 0.15 };
      const elig = evaluateStrokeEligibility(path, path.points, path.length, 'eye', config);
      assert.equal(elig.drawable, false);
      assert.equal(elig.filteredReason, 'low_confidence');
    });

    it('filters out paths shorter than minLength threshold', () => {
      const path = createTestVectorPath({
        points: [{ x: 0.1, y: 0.1 }, { x: 0.1005, y: 0.1 }],
        length: 0.0005
      });
      const config: StrokeGenerationConfig = { minLength: 0.003 };
      const elig = evaluateStrokeEligibility(path, path.points, 0.0005, 'detail', config);
      assert.equal(elig.drawable, false);
      assert.equal(elig.filteredReason, 'too_short');
    });

    it('suppresses background strokes by default and enables when configured', () => {
      const bgPath = createTestVectorPath({ region: 'background' });

      // Default: background disabled
      const set1 = generateStrokeCandidates(createTestGeometry([bgPath]), { enableBackground: false });
      assert.equal(set1.candidates[0].drawable, false);
      assert.equal(set1.candidates[0].filteredReason, 'background');

      // Configured: background enabled
      const set2 = generateStrokeCandidates(createTestGeometry([bgPath]), { enableBackground: true });
      assert.equal(set2.candidates[0].drawable, true);
    });
  });

  // ----------------------------------------------------
  // 3. Semantic Role Classification
  // ----------------------------------------------------
  describe('Semantic Role Classification', () => {
    it('accurately maps distinct anatomical and structural features', () => {
      assert.equal(deriveSemanticRole(createTestVectorPath({ region: 'eyes' })), 'eye');
      assert.equal(deriveSemanticRole(createTestVectorPath({ region: 'eyebrows' })), 'eyebrow');
      assert.equal(deriveSemanticRole(createTestVectorPath({ region: 'nose' })), 'nose');
      assert.equal(deriveSemanticRole(createTestVectorPath({ region: 'mouth' })), 'mouth');
      assert.equal(deriveSemanticRole(createTestVectorPath({ region: 'ears' })), 'ear');
      assert.equal(deriveSemanticRole(createTestVectorPath({ region: 'jawline' })), 'facial_contour');
      assert.equal(deriveSemanticRole(createTestVectorPath({ region: 'hair' })), 'hair');
      assert.equal(deriveSemanticRole(createTestVectorPath({ region: 'clothing' })), 'clothing_boundary');
      assert.equal(deriveSemanticRole(createTestVectorPath({ region: 'body_outline', source: 'silhouette', level: 0 })), 'silhouette');
      assert.equal(deriveSemanticRole(createTestVectorPath({ region: 'shoulders', source: 'pose_connection' })), 'body_structure');
      assert.equal(deriveSemanticRole(createTestVectorPath({ region: 'texture', source: 'semantic_boundary' })), 'semantic_boundary');
      assert.equal(deriveSemanticRole(createTestVectorPath({ region: 'background' })), 'background');
    });
  });

  // ----------------------------------------------------
  // 4. Stroke Width, Density & Priority
  // ----------------------------------------------------
  describe('Stroke Width, Density & Priority Calculations', () => {
    it('assigns greater line weight to structural silhouette than fine details', () => {
      const config: StrokeGenerationConfig = { baseStructuralWidth: 2.2, baseDetailWidth: 1.6 };
      const wSilh = computeStrokeWidth('silhouette', 0, 0.9, 0.9, config);
      const wEye = computeStrokeWidth('eye', 2, 0.9, 0.9, config);
      const wDetail = computeStrokeWidth('detail', 4, 0.5, 0.5, config);

      assert.ok(wSilh > wEye, `Silhouette width (${wSilh}) must exceed eye width (${wEye})`);
      assert.ok(wEye > wDetail, `Eye width (${wEye}) must exceed detail width (${wDetail})`);
    });

    it('allocates high detail density to facial focal points', () => {
      const config: StrokeGenerationConfig = {};
      const dEye = computeStrokeDensity('eye', 2, config);
      const dHair = computeStrokeDensity('hair', 3, config);
      const dClothe = computeStrokeDensity('clothing_boundary', 3, config);
      const dBg = computeStrokeDensity('background', 1, config);

      assert.equal(dEye, 1.0);
      assert.ok(dEye > dHair, 'Eye density must exceed hair');
      assert.ok(dHair > dClothe, 'Hair density must exceed clothing');
      assert.ok(dClothe > dBg, 'Clothing density must exceed background');
    });

    it('prioritizes eyes and facial contours above textures and background', () => {
      const pEye = computeStrokePriorityScore(0.9, 'eye', 2, 0.9, 0.1);
      const pSilh = computeStrokePriorityScore(0.8, 'silhouette', 0, 0.8, 0.3);
      const pBg = computeStrokePriorityScore(0.3, 'background', 1, 0.5, 0.1);

      assert.ok(pEye > pSilh, 'Eye priority must rank above silhouette');
      assert.ok(pSilh > pBg, 'Silhouette priority must rank above background');
    });
  });

  // ----------------------------------------------------
  // 5. Path Partitioning
  // ----------------------------------------------------
  describe('Path Partitioning', () => {
    it('never fragments protected structural facial features', () => {
      const eyePath = createTestVectorPath({
        region: 'eyes',
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.2, y: 0.3 }, // sharp turn
          { x: 0.1, y: 0.5 },
          { x: 0.3, y: 0.8 }
        ],
        length: 0.8 // long
      });
      const segments = partitionVectorPath(eyePath, { maxStrokeLength: 0.2 });
      assert.equal(segments.length, 1, 'Eyes must remain a single unbroken stroke candidate');
    });

    it('partitions a long silhouette with sharp turns into gesture strokes', () => {
      // Long contour with 90 degree corners
      const longSilhouette = createTestVectorPath({
        region: 'body_outline',
        source: 'silhouette',
        level: 0,
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.1, y: 0.4 },
          { x: 0.4, y: 0.4 }, // 90 degree turn
          { x: 0.4, y: 0.8 }, // 90 degree turn
          { x: 0.8, y: 0.8 }
        ],
        length: 0.9
      });

      const segments = partitionVectorPath(longSilhouette, {
        maxStrokeLength: 0.35,
        splitOnSharpCorners: true
      });

      assert.ok(segments.length >= 2, `Expected at least 2 segments, got ${segments.length}`);
      assert.ok(segments.length <= 8, `Expected at most 8 segments, got ${segments.length}`);
      for (const seg of segments) {
        assert.ok(seg.points.length >= 2);
        assert.ok(seg.length > 0);
      }
    });

    it('preserves short straight paths without unnecessary partitioning', () => {
      const shortPath = createTestVectorPath({
        region: 'clothing',
        points: [{ x: 0.1, y: 0.1 }, { x: 0.15, y: 0.15 }],
        length: 0.07
      });
      const segments = partitionVectorPath(shortPath, { maxStrokeLength: 0.35 });
      assert.equal(segments.length, 1);
    });
  });

  // ----------------------------------------------------
  // 6. Multi-Person Isolation (BM-11)
  // ----------------------------------------------------
  describe('Multi-Person Isolation (BM-11)', () => {
    it('strictly preserves distinct subjectId tags across all candidates', () => {
      const pathSubjectA = createTestVectorPath({ id: 'p_a', subjectId: 'person_alpha' });
      const pathSubjectB = createTestVectorPath({ id: 'p_b', subjectId: 'person_beta' });

      const geom = createTestGeometry([pathSubjectA, pathSubjectB]);
      const set = generateStrokeCandidates(geom);

      assert.equal(set.candidates.length, 2);
      const cA = set.candidates.find(c => c.subjectId === 'person_alpha');
      const cB = set.candidates.find(c => c.subjectId === 'person_beta');

      assert.ok(cA, 'person_alpha candidate must exist');
      assert.ok(cB, 'person_beta candidate must exist');
      assert.equal(set.metrics.strokesBySubject['person_alpha'], 1);
      assert.equal(set.metrics.strokesBySubject['person_beta'], 1);
    });
  });

  // ----------------------------------------------------
  // 7. Determinism Guarantee
  // ----------------------------------------------------
  describe('Determinism Guarantee', () => {
    it('produces byte-for-byte identical candidate sets on repeated execution', () => {
      const paths = [
        createTestVectorPath({ id: 'eye_l', region: 'eyes' }),
        createTestVectorPath({ id: 'nose_b', region: 'nose' }),
        createTestVectorPath({ id: 'silh', source: 'silhouette', region: 'body_outline' })
      ];
      const geom = createTestGeometry(paths);

      const run1 = generateStrokeCandidates(geom);
      const run2 = generateStrokeCandidates(geom);

      // Mask dynamic timestamps and latencies for strict JSON comparison
      const norm1 = { ...run1, timestamp: 0, metrics: { ...run1.metrics, generationLatencyMs: 0 } };
      const norm2 = { ...run2, timestamp: 0, metrics: { ...run2.metrics, generationLatencyMs: 0 } };

      assert.deepEqual(norm1, norm2);
      assert.equal(JSON.stringify(norm1), JSON.stringify(norm2));
    });
  });

  // ----------------------------------------------------
  // 8. Pure TypeScript Compliance
  // ----------------------------------------------------
  describe('Pure TypeScript Portability', () => {
    it('operates with zero browser or DOM globals in headless runtime', () => {
      assert.equal(typeof (globalThis as any).window, 'undefined');
      assert.equal(typeof (globalThis as any).document, 'undefined');
      assert.equal(typeof (globalThis as any).HTMLCanvasElement, 'undefined');
    });
  });
});
