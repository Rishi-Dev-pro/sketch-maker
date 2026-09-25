import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  evaluateSemanticBoundaryEligibility,
} from '../../packages/structural-analysis/src/reconstruction/semantic-boundary-filter';
import { Point2D } from '../../packages/shared-types';

describe('TASK-110: Semantic Boundary Relevance Filtering', () => {
  const createBox = (x: number, y: number, w: number, h: number): Point2D[] => [
    { x, y },
    { x: x + w * 0.5, y },
    { x: x + w, y },
    { x: x + w, y: y + h * 0.5 },
    { x: x + w, y: y + h },
    { x: x + w * 0.5, y: y + h },
    { x, y: y + h },
    { x, y: y + h * 0.5 },
  ];

  it('Test 1: Rejects tiny noise loops below minAreaThreshold', () => {
    // 0.01 x 0.01 = 0.0001 area (well below default 0.004)
    const tinyLoop = createBox(0.5, 0.5, 0.01, 0.01);
    const result = evaluateSemanticBoundaryEligibility(tinyLoop, 'clothing', 0);

    assert.strictEqual(result.eligible, false);
    assert.strictEqual(result.filteredReason, 'micro_speckle_noise');
  });

  it('Test 2: Rejects degenerate loops with fewer than minPointCount vertices', () => {
    const degenerate: Point2D[] = [
      { x: 0.5, y: 0.5 },
      { x: 0.6, y: 0.6 },
      { x: 0.7, y: 0.7 },
    ];
    const result = evaluateSemanticBoundaryEligibility(degenerate, 'clothing', 0);

    assert.strictEqual(result.eligible, false);
    assert.strictEqual(result.filteredReason, 'too_few_points');
  });

  it('Test 3: Rejects raw hair mask loops because hair is handled by Hair Reconstructor', () => {
    const hairLoop = createBox(0.2, 0.1, 0.5, 0.4); // Area = 0.20
    const result = evaluateSemanticBoundaryEligibility(hairLoop, 'hair', 0);

    assert.strictEqual(result.eligible, false);
    assert.strictEqual(result.filteredReason, 'superseded_by_hair_reconstruction');
  });

  it('Test 4: Rejects face_skin mask loops because facial features are handled by Feature Reconstructor', () => {
    const skinLoop = createBox(0.3, 0.3, 0.4, 0.4); // Area = 0.16
    const result = evaluateSemanticBoundaryEligibility(skinLoop, 'face_skin', 0);

    assert.strictEqual(result.eligible, false);
    assert.strictEqual(result.filteredReason, 'redundant_with_facial_contour');
  });

  it('Test 5: Accepts large meaningful clothing contours (area >= 0.02)', () => {
    const coatLoop = createBox(0.2, 0.5, 0.6, 0.4); // Area = 0.24
    const result = evaluateSemanticBoundaryEligibility(coatLoop, 'clothing', 0);

    assert.strictEqual(result.eligible, true);
    assert.strictEqual(result.region, 'clothing');
    assert.ok(result.importanceScore > 0.5);
  });

  it('Test 6: Throttles category quota to prevent loops from crowding out facial features', () => {
    const coatLoop = createBox(0.2, 0.5, 0.6, 0.4);
    // 3rd loop in clothing exceeds maxLoopsPerCategory (default: 2)
    const result = evaluateSemanticBoundaryEligibility(coatLoop, 'clothing', 2);

    assert.strictEqual(result.eligible, false);
    assert.strictEqual(result.filteredReason, 'category_quota_exceeded');
  });

  it('Test 7: Background and unknown categories are always suppressed', () => {
    const bgLoop = createBox(0.0, 0.0, 1.0, 1.0);
    const result = evaluateSemanticBoundaryEligibility(bgLoop, 'background', 0);

    assert.strictEqual(result.eligible, false);
    assert.strictEqual(result.filteredReason, 'background_suppressed');
  });
});
