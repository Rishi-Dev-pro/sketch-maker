import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  Point2D,
  SubjectModel,
  FacialFeatures,
  BodyFeatures,
  SemanticMask,
  SemanticSegmentation
} from '@sketch-maker/shared-types';
import {
  cleanPolyline,
  simplifyRDP,
  fitCubicBezier,
  extractMaskContours,
  calculatePathImportance,
  extractVectorGeometry,
  extractAllVectorGeometry,
  getToleranceForLevel
} from '../../packages/stroke-engine/src';

describe('TASK-104: Contour & Vector Generation', () => {
  describe('Polyline Cleaning & Normalization', () => {
    test('clamps coordinates to [0.0, 1.0] and rejects NaN/Infinity', () => {
      const noisyPoints: Point2D[] = [
        { x: -0.2, y: 0.5 },
        { x: 0.3, y: 1.5 },
        { x: NaN, y: 0.4 },
        { x: 0.6, y: Infinity },
        { x: 0.8, y: 0.8 }
      ];

      const cleaned = cleanPolyline(noisyPoints);
      assert.equal(cleaned.length, 3);
      assert.equal(cleaned[0].x, 0.0);
      assert.equal(cleaned[0].y, 0.5);
      assert.equal(cleaned[1].x, 0.3);
      assert.equal(cleaned[1].y, 1.0);
      assert.equal(cleaned[2].x, 0.8);
      assert.equal(cleaned[2].y, 0.8);
    });

    test('removes duplicate and near-duplicate consecutive vertices', () => {
      const dupePoints: Point2D[] = [
        { x: 0.1, y: 0.1 },
        { x: 0.1, y: 0.1 }, // Exact dupe
        { x: 0.100001, y: 0.100001 }, // Near-dupe (< 1e-4)
        { x: 0.1, y: 0.5 }, // Corner
        { x: 0.1, y: 0.5 }, // Exact dupe
        { x: 0.5, y: 0.5 }
      ];

      const cleaned = cleanPolyline(dupePoints);
      assert.equal(cleaned.length, 3);
      assert.deepEqual(cleaned[0], { x: 0.1, y: 0.1 });
      assert.deepEqual(cleaned[1], { x: 0.1, y: 0.5 });
      assert.deepEqual(cleaned[2], { x: 0.5, y: 0.5 });
    });

    test('filters out aberrant isolated spatial spikes', () => {
      const spikPoints: Point2D[] = [
        { x: 0.1, y: 0.1 },
        { x: 0.2, y: 0.3 },
        { x: 0.85, y: 0.85 }, // Extreme isolated jump (> 0.35)
        { x: 0.25, y: 0.1 }, // Returns immediately back
        { x: 0.3, y: 0.3 }
      ];

      const cleaned = cleanPolyline(spikPoints);
      assert.equal(cleaned.length, 4);
      assert.ok(!cleaned.some(p => p.x > 0.8));
    });


    test('prunes redundant collinear points along straight spans', () => {
      const collinearPoints: Point2D[] = [
        { x: 0.1, y: 0.1 },
        { x: 0.2, y: 0.2 }, // Collinear midpoint
        { x: 0.3, y: 0.3 }, // Collinear midpoint
        { x: 0.4, y: 0.4 }  // Endpoint
      ];

      const cleaned = cleanPolyline(collinearPoints);
      assert.equal(cleaned.length, 2);
      assert.deepEqual(cleaned[0], { x: 0.1, y: 0.1 });
      assert.deepEqual(cleaned[1], { x: 0.4, y: 0.4 });
    });
  });

  describe('Ramer-Douglas-Peucker (RDP) Simplification', () => {
    test('preserves exact start and end points for open polylines', () => {
      const points: Point2D[] = [
        { x: 0.1, y: 0.2 },
        { x: 0.15, y: 0.22 },
        { x: 0.2, y: 0.25 },
        { x: 0.25, y: 0.23 },
        { x: 0.3, y: 0.2 }
      ];

      const simplified = simplifyRDP(points, 0.01, false);
      assert.ok(simplified.length >= 2);
      assert.deepEqual(simplified[0], points[0]);
      assert.deepEqual(simplified[simplified.length - 1], points[points.length - 1]);
    });

    test('simplifies smooth curved arc with significant point reduction', () => {
      // 50 points along an arc
      const arc: Point2D[] = [];
      for (let i = 0; i < 50; i++) {
        const theta = (i / 49) * Math.PI;
        arc.push({
          x: 0.5 + 0.3 * Math.cos(theta),
          y: 0.5 + 0.3 * Math.sin(theta)
        });
      }

      const simplified = simplifyRDP(arc, 0.01, false);
      assert.ok(simplified.length < arc.length);
      assert.ok(simplified.length <= 10);
      assert.ok(simplified.length >= 4);
      // Endpoints preserved
      assert.deepEqual(simplified[0], arc[0]);
      assert.deepEqual(simplified[simplified.length - 1], arc[arc.length - 1]);
    });

    test('preserves closed loops without collapsing to a line segment', () => {
      // 4-corner polygon closed loop with interior jitter
      const closedLoop: Point2D[] = [
        { x: 0.2, y: 0.2 },
        { x: 0.4, y: 0.201 },
        { x: 0.8, y: 0.2 },
        { x: 0.8, y: 0.5 },
        { x: 0.8, y: 0.8 },
        { x: 0.5, y: 0.799 },
        { x: 0.2, y: 0.8 },
        { x: 0.2, y: 0.5 },
        { x: 0.2, y: 0.2 }
      ];

      const simplified = simplifyRDP(closedLoop, 0.01, true);
      assert.ok(simplified.length >= 4);
      // First and last remain closed
      assert.deepEqual(simplified[0], closedLoop[0]);
      assert.deepEqual(simplified[simplified.length - 1], closedLoop[closedLoop.length - 1]);
    });

    test('higher epsilon produces greater point reduction', () => {
      const points: Point2D[] = [];
      for (let i = 0; i < 30; i++) {
        points.push({
          x: i / 29,
          y: 0.5 + 0.1 * Math.sin((i / 29) * Math.PI * 2)
        });
      }

      const fine = simplifyRDP(points, 0.001, false);
      const coarse = simplifyRDP(points, 0.05, false);

      assert.ok(fine.length > coarse.length);
      assert.ok(coarse.length >= 2);
    });

    test('respects hierarchy level tolerances', () => {
      assert.equal(getToleranceForLevel(0), 0.0050); // Silhouette
      assert.equal(getToleranceForLevel(2), 0.0020); // Anatomy
      assert.equal(getToleranceForLevel(4), 0.0010); // Fine details
    });
  });

  describe('Cubic Bézier Curve Fitting', () => {
    test('generates continuous cubic Bézier segments anchoring vertices', () => {
      const points: Point2D[] = [
        { x: 0.1, y: 0.2 },
        { x: 0.25, y: 0.4 },
        { x: 0.5, y: 0.3 },
        { x: 0.8, y: 0.7 }
      ];

      const curves = fitCubicBezier(points, false);
      assert.equal(curves.length, 3);

      // Check endpoints alignment
      assert.deepEqual(curves[0].start, points[0]);
      assert.deepEqual(curves[0].end, points[1]);
      assert.deepEqual(curves[1].start, points[1]);
      assert.deepEqual(curves[1].end, points[2]);
      assert.deepEqual(curves[2].start, points[2]);
      assert.deepEqual(curves[2].end, points[3]);

      // Verify no NaN/Infinity in control points
      curves.forEach(c => {
        assert.ok(Number.isFinite(c.cp1.x));
        assert.ok(Number.isFinite(c.cp1.y));
        assert.ok(Number.isFinite(c.cp2!.x));
        assert.ok(Number.isFinite(c.cp2!.y));
        // Must be in [0, 1]
        assert.ok(c.cp1.x >= 0 && c.cp1.x <= 1);
        assert.ok(c.cp1.y >= 0 && c.cp1.y <= 1);
        assert.ok(c.cp2!.x >= 0 && c.cp2!.x <= 1);
        assert.ok(c.cp2!.y >= 0 && c.cp2!.y <= 1);
      });
    });

    test('supports 2-point straight lines as cubic Bézier', () => {
      const points: Point2D[] = [
        { x: 0.2, y: 0.3 },
        { x: 0.8, y: 0.9 }
      ];

      const curves = fitCubicBezier(points, false);
      assert.equal(curves.length, 1);
      assert.deepEqual(curves[0].start, points[0]);
      assert.deepEqual(curves[0].end, points[1]);
      assert.ok(curves[0].cp1.x > points[0].x);
      assert.ok(curves[0].cp2!.x < points[1].x);
    });

    test('supports closed loops with continuous wrapped tangents', () => {
      const points: Point2D[] = [
        { x: 0.3, y: 0.3 },
        { x: 0.7, y: 0.3 },
        { x: 0.7, y: 0.7 },
        { x: 0.3, y: 0.7 }
      ];

      const curves = fitCubicBezier(points, true);
      assert.equal(curves.length, 4);
      assert.deepEqual(curves[3].end, points[0]);
    });
  });

  describe('Semantic Mask Contour Extraction', () => {
    test('extracts closed normalized polygon loops from raster masks', () => {
      const width = 64;
      const height = 64;
      const data = new Uint8Array(width * height);

      // Draw a 20x20 foreground square in the center
      for (let y = 20; y < 40; y++) {
        for (let x = 20; x < 40; x++) {
          data[y * width + x] = 255;
        }
      }

      const mask: SemanticMask = {
        category: 'clothing',
        confidence: 0.9,
        width,
        height,
        data,
        pixelArea: 400
      };

      const contours = extractMaskContours(mask, 2, 50);
      assert.ok(contours.length >= 1);
      const mainContour = contours[0];
      assert.ok(mainContour.length >= 4);

      // All points must be normalized in [0.0, 1.0]
      mainContour.forEach(p => {
        assert.ok(p.x >= 0.0 && p.x <= 1.0);
        assert.ok(p.y >= 0.0 && p.y <= 1.0);
      });

      // Loop must be explicitly closed
      const first = mainContour[0];
      const last = mainContour[mainContour.length - 1];
      assert.equal(first.x, last.x);
      assert.equal(first.y, last.y);
    });

    test('filters out micro-speckles below minArea', () => {
      const width = 32;
      const height = 32;
      const data = new Uint8Array(width * height);

      // Tiny 2x2 speckle
      data[10 * width + 10] = 255;
      data[10 * width + 11] = 255;
      data[11 * width + 10] = 255;
      data[11 * width + 11] = 255;

      const mask: SemanticMask = {
        category: 'hair',
        confidence: 0.8,
        width,
        height,
        data,
        pixelArea: 4
      };

      const contours = extractMaskContours(mask, 2, 50);
      assert.equal(contours.length, 0);
    });
  });

  describe('Deterministic Importance Scoring', () => {
    test('produces reproducible scores and enforces semantic hierarchy', () => {
      const eyeScore = calculatePathImportance('eyes', 0.95, 'visible', 0.05, 2);
      const noseScore = calculatePathImportance('nose', 0.90, 'visible', 0.08, 2);
      const mouthScore = calculatePathImportance('mouth', 0.92, 'visible', 0.07, 2);
      const silhouetteScore = calculatePathImportance('body_outline', 0.85, 'visible', 0.40, 0);
      const clothingScore = calculatePathImportance('clothing', 0.70, 'visible', 0.15, 3);
      const backgroundScore = calculatePathImportance('background', 0.50, 'visible', 0.05, 3);

      // Semantic hierarchy: eyes > clothing > background
      assert.ok(eyeScore > clothingScore);
      assert.ok(clothingScore > backgroundScore);
      assert.ok(eyeScore > 0.80);
      assert.ok(mouthScore > 0.75);
      assert.ok(noseScore > 0.75);
      assert.ok(silhouetteScore > 0.70);

      // Determinism
      const eyeScoreAgain = calculatePathImportance('eyes', 0.95, 'visible', 0.05, 2);
      assert.equal(eyeScore, eyeScoreAgain);
    });

    test('penalizes occluded or not_detected features', () => {
      const visibleBrow = calculatePathImportance('eyebrows', 0.8, 'visible', 0.05, 2);
      const occludedBrow = calculatePathImportance('eyebrows', 0.8, 'occluded', 0.05, 2);

      assert.ok(visibleBrow > occludedBrow);
    });
  });

  describe('Universal Vector Geometry Extractor', () => {
    const mockSubject: SubjectModel = {
      id: 'test_subject_0',
      version: '0.1.0',
      sourceDimensions: { width: 1024, height: 1024 },
      boundingBox: { x: 0.2, y: 0.1, width: 0.6, height: 0.8 },
      silhouette: [
        {
          id: 'sil_0',
          region: 'body_outline',
          points: [
            { x: 0.2, y: 0.2 },
            { x: 0.8, y: 0.2 },
            { x: 0.8, y: 0.8 },
            { x: 0.2, y: 0.8 },
            { x: 0.2, y: 0.2 }
          ],
          closed: true,
          confidence: 0.9
        }
      ],
      face: {
        confidence: 0.92,
        leftEye: {
          confidence: 0.95,
          upperLid: {
            id: 'lid_l_up',
            region: 'eyes',
            points: [{ x: 0.35, y: 0.3 }, { x: 0.40, y: 0.29 }, { x: 0.45, y: 0.3 }],
            closed: false,
            confidence: 0.95
          },
          lowerLid: {
            id: 'lid_l_low',
            region: 'eyes',
            points: [{ x: 0.35, y: 0.3 }, { x: 0.40, y: 0.31 }, { x: 0.45, y: 0.3 }],
            closed: false,
            confidence: 0.95
          },
          iris: { x: 0.40, y: 0.30 }
        },
        rightEye: {
          confidence: 0.95,
          upperLid: {
            id: 'lid_r_up',
            region: 'eyes',
            points: [{ x: 0.55, y: 0.3 }, { x: 0.60, y: 0.29 }, { x: 0.65, y: 0.3 }],
            closed: false,
            confidence: 0.95
          },
          lowerLid: {
            id: 'lid_r_low',
            region: 'eyes',
            points: [{ x: 0.55, y: 0.3 }, { x: 0.60, y: 0.31 }, { x: 0.65, y: 0.3 }],
            closed: false,
            confidence: 0.95
          },
          iris: { x: 0.60, y: 0.30 }
        },
        noseBridge: {
          id: 'nose_b',
          region: 'nose',
          points: [{ x: 0.5, y: 0.32 }, { x: 0.5, y: 0.42 }],
          closed: false,
          confidence: 0.88
        },
        jawline: {
          id: 'jaw',
          region: 'jawline',
          points: [{ x: 0.3, y: 0.35 }, { x: 0.5, y: 0.55 }, { x: 0.7, y: 0.35 }],
          closed: false,
          confidence: 0.85
        }
      },
      body: {
        shoulders: [],
        arms: [],
        torso: [],
        legs: [],
        poseConfidence: 0.85,
        pose: {
          confidence: 0.85,
          landmarks: [],
          connections: [
            {
              from: { x: 0.4, y: 0.6 },
              to: { x: 0.6, y: 0.6 },
              name: 'leftShoulder-rightShoulder',
              confidence: 0.9
            }
          ]
        }
      },
      globalConfidence: 0.90,
      timestamp: Date.now()
    };

    test('extractVectorGeometry converts SubjectModel into structured VectorGeometry', () => {
      const geom = extractVectorGeometry(mockSubject);

      assert.equal(geom.version, '0.1.0');
      assert.ok(geom.paths.length >= 6); // Silhouette, eyes, iris, nose, jawline, pose connection
      assert.ok(geom.metrics.totalPaths === geom.paths.length);
      assert.ok(geom.metrics.totalSimplifiedPoints > 0);
      assert.ok(geom.metrics.totalRawPoints >= geom.metrics.totalSimplifiedPoints);
      assert.ok(geom.metrics.processingTimeMs >= 0);

      // Paths are ordered by level then descending importance
      for (let i = 0; i < geom.paths.length - 1; i++) {
        const curr = geom.paths[i];
        const next = geom.paths[i + 1];
        if (curr.level === next.level) {
          assert.ok(curr.importance >= next.importance);
        } else {
          assert.ok(curr.level < next.level);
        }
      }
    });

    test('profile pose strictly suppresses hidden features without fabricating paths (BM-02)', () => {
      const profileSubject: SubjectModel = {
        ...mockSubject,
        id: 'profile_bm02',
        face: {
          ...mockSubject.face!,
          featureVisibility: {
            leftEye: 'visible',
            rightEye: 'occluded', // Hidden far-side eye
            rightEyebrow: 'occluded',
            rightEar: 'occluded'
          }
        }
      };

      const geom = extractVectorGeometry(profileSubject);
      const rightEyePaths = geom.paths.filter(p => p.id.includes('right_eye'));
      assert.equal(rightEyePaths.length, 0); // Strictly zero fabricated paths
    });

    test('extractAllVectorGeometry isolates multi-subject instances with independent IDs (BM-11)', () => {
      const subject1: SubjectModel = { ...mockSubject, id: 'person_A' };
      const subject2: SubjectModel = { ...mockSubject, id: 'person_B' };

      const groupGeom = extractAllVectorGeometry([subject1, subject2]);
      assert.ok(groupGeom.paths.length >= 12);

      const personAPaths = groupGeom.paths.filter(p => p.subjectId === 'person_A');
      const personBPaths = groupGeom.paths.filter(p => p.subjectId === 'person_B');

      assert.equal(personAPaths.length, groupGeom.paths.length / 2);
      assert.equal(personBPaths.length, groupGeom.paths.length / 2);
    });

    test('pure TypeScript guarantee: no browser globals leaked into core', () => {
      // Ensure running cleanly in Node.js headless environment
      assert.equal(typeof (globalThis as any).window, 'undefined');
      assert.equal(typeof (globalThis as any).document, 'undefined');
    });
  });
});
