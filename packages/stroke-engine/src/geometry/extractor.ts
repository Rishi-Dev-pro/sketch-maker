import {
  Point2D,
  BoundingBox,
  ContourPath,
  SemanticRegion,
  FeatureVisibility,
  PathHierarchyLevel,
  VectorPath,
  VectorGeometry,
  GeometryMetrics,
  GeometrySource,
  SubjectModel
} from '@sketch-maker/shared-types';
import {
  VectorExtractionOptions,
  DEFAULT_SIMPLIFICATION_TOLERANCES,
  DEFAULT_CLEANING_OPTIONS
} from './types';
import { cleanPolyline, computeBoundingBox, computeArcLength } from './cleaning';
import { simplifyRDP, getToleranceForLevel, getFeatureSpecificTolerance } from './simplification';
import { fitCubicBezier } from './curves';
import { extractMaskContours } from './mask-contours';
import { calculatePathImportance } from './importance';

interface RawPathCandidate {
  readonly id: string;
  readonly source: GeometrySource;
  readonly region: SemanticRegion;
  readonly level: PathHierarchyLevel;
  readonly points: readonly Point2D[];
  readonly closed: boolean;
  readonly confidence: number;
  readonly visibility?: FeatureVisibility;
  readonly subjectId?: string;
  readonly isPointFeature?: boolean;
}

/**
 * Converts a single raw candidate into a fully cleaned, simplified, and measured VectorPath.
 */
function processCandidatePath(
  candidate: RawPathCandidate,
  options?: VectorExtractionOptions
): VectorPath | null {
  const { points: rawPoints, closed, level, region, confidence, visibility, isPointFeature } = candidate;

  if (!rawPoints || rawPoints.length === 0) {
    return null;
  }

  // Handle single-point features (e.g. iris/pupil centers)
  if (isPointFeature && rawPoints.length === 1) {
    const p = rawPoints[0];
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    const clampedPoint: Point2D = {
      x: Math.max(0, Math.min(1, p.x)),
      y: Math.max(0, Math.min(1, p.y))
    };
    const bounds: BoundingBox = { x: clampedPoint.x, y: clampedPoint.y, width: 0, height: 0 };
    const importance = calculatePathImportance(region, confidence, visibility, 0, level);

    return {
      id: candidate.id,
      source: candidate.source,
      region,
      level,
      points: [clampedPoint],
      rawPoints: [clampedPoint],
      curves: [],
      closed: false,
      confidence,
      importance,
      length: 0,
      bounds,
      visibility,
      subjectId: candidate.subjectId
    };
  }

  // 1. Cleaning
  const cleaned = cleanPolyline(rawPoints, options?.cleaning);
  if (cleaned.length < (closed ? 3 : 2)) {
    return null;
  }

  // 2. Length check (adaptive: delicate anatomical accents allow down to 0.0008)
  const arcLength = computeArcLength(cleaned);
  const isFineFeature =
    region === 'eyes' ||
    region === 'mouth' ||
    region === 'nose' ||
    level === 4 ||
    candidate.id.includes('iris') ||
    candidate.id.includes('pupil') ||
    candidate.id.includes('lash') ||
    candidate.id.includes('canthus') ||
    candidate.id.includes('hatch');
  const minPathLength = options?.minPathLength ?? (isFineFeature ? 0.0008 : 0.003);
  if (arcLength < minPathLength) {
    return null;
  }

  // 3. Adaptive Feature-Aware RDP Simplification (TASK-111)
  const tolerance = getFeatureSpecificTolerance(region, candidate.id, level);
  const simplified = simplifyRDP(cleaned, tolerance, closed);
  if (simplified.length < (closed ? 3 : 2)) {
    return null;
  }

  // 4. Bézier curve fitting
  const fitCurves = options?.curves?.enabled !== false;
  const curves = fitCurves ? fitCubicBezier(simplified, closed, options?.curves) : undefined;

  // 5. Bounds & Importance
  const bounds = computeBoundingBox(simplified);
  const importance = calculatePathImportance(region, confidence, visibility, arcLength, level);

  return {
    id: candidate.id,
    source: candidate.source,
    region,
    level,
    points: simplified,
    rawPoints: [...rawPoints],
    curves,
    closed,
    confidence,
    importance,
    length: Math.round(arcLength * 10000) / 10000,
    bounds,
    visibility,
    subjectId: candidate.subjectId
  };
}

function computePolygonArea(points: readonly Point2D[]): number {
  if (points.length < 3) return 0;
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return Math.abs(area) * 0.5;
}

/**
 * Extracts raw candidate paths from a SubjectModel.
 * Prioritizes high-fidelity reconstructed artistic features when available,
 * while maintaining backward compatibility and semantic boundary relevance filtering.
 */
function harvestSubjectCandidates(
  subject: SubjectModel,
  options?: VectorExtractionOptions
): RawPathCandidate[] {
  const candidates: RawPathCandidate[] = [];
  const subjectId = subject.id;
  const minConf = options?.minConfidence ?? 0.05;

  // ----------------------------------------------------
  // 0. Reconstructed Features (Preferred High-Fidelity Layer)
  // ----------------------------------------------------
  if (subject.reconstruction) {
    const recon = subject.reconstruction;
    for (const p of recon.allReconstructedPaths) {
      if (p.points && p.points.length >= (p.closed ? 3 : 2) && p.confidence >= minConf) {
        let level: PathHierarchyLevel = 2;
        let source: GeometrySource = 'reconstructed_feature';

        if (
          p.id.includes('authoritative_silhouette') ||
          (p as any).source === 'silhouette' ||
          (p.id.includes('silhouette') && !p.id.includes('hair'))
        ) {
          level = 0;
          source = 'silhouette';
        } else if (p.id.includes('hair_outer_boundary')) {
          level = 0;
          source = 'silhouette';
        } else if (p.id.includes('clothing_outer_boundary')) {
          level = 1;
          source = 'clothing_structure';
        } else if (p.id.includes('hatch') || p.id.includes('shading')) {
          level = 4;
          source = 'tonal_shading';
        } else if (p.id.includes('hair_strand')) {
          level = 4;
          source = 'hair_strand';
        } else if (p.region === 'hair_boundary' || p.id.includes('hair_mass')) {
          level = 3;
          source = 'hair_mass';
        } else if (p.id.includes('hair_flow')) {
          level = 4;
          source = 'hair_flow';
        } else if (p.id.includes('hair_silhouette')) {
          level = 0;
          source = 'reconstructed_feature';
        } else if (p.region === 'jawline' || p.id.includes('neck') || p.id.includes('shoulder')) {
          level = 1;
          source = p.id.includes('neck') ? 'neck_contour' : 'reconstructed_feature';
        } else if (
          p.id.includes('crease') ||
          p.id.includes('iris') ||
          p.id.includes('pupil') ||
          p.id.includes('lash') ||
          p.id.includes('canthus') ||
          p.id.includes('ala') ||
          p.id.includes('underside') ||
          p.id.includes('columella') ||
          p.id.includes('subnasale') ||
          p.id.includes('philtrum') ||
          p.id.includes('corner') ||
          p.id.includes('head') ||
          p.id.includes('tail') ||
          p.id.includes('hair') ||
          p.id.includes('concha')
        ) {
          level = 4;
          source = 'reconstructed_feature';
        } else if (p.region === 'clothing') {
          level = 3;
          source = 'clothing_structure';
        }

        candidates.push({
          id: p.id,
          source,
          region: p.region,
          level,
          points: p.points,
          closed: p.closed,
          confidence: p.confidence,
          visibility: p.visibility ?? 'visible',
          subjectId
        });
      }
    }
  } else {
    // ----------------------------------------------------
    // Fallback: Raw Perception Facial Features
    // ----------------------------------------------------
    if (subject.face) {
      const face = subject.face;
      const vis = face.featureVisibility;

      // Left Eye
      if (face.leftEye && vis?.leftEye !== 'occluded' && vis?.leftEye !== 'not_detected') {
        const eyeConf = face.leftEye.confidence ?? face.confidence;
        if (eyeConf >= minConf) {
          if (face.leftEye.upperLid?.points?.length >= 2) {
            candidates.push({
              id: `${subjectId}_face_left_eye_upper`,
              source: 'face_contour',
              region: 'eyes',
              level: 2,
              points: face.leftEye.upperLid.points,
              closed: false,
              confidence: eyeConf,
              visibility: face.leftEye.visibility ?? 'visible',
              subjectId
            });
          }
          if (face.leftEye.lowerLid?.points?.length >= 2) {
            candidates.push({
              id: `${subjectId}_face_left_eye_lower`,
              source: 'face_contour',
              region: 'eyes',
              level: 2,
              points: face.leftEye.lowerLid.points,
              closed: false,
              confidence: eyeConf,
              visibility: face.leftEye.visibility ?? 'visible',
              subjectId
            });
          }
          if (face.leftEye.iris) {
            candidates.push({
              id: `${subjectId}_face_left_eye_iris`,
              source: 'face_landmark',
              region: 'eyes',
              level: 4,
              points: [face.leftEye.iris],
              closed: false,
              confidence: eyeConf,
              visibility: 'visible',
              subjectId,
              isPointFeature: true
            });
          }
        }
      }

      // Right Eye
      if (face.rightEye && vis?.rightEye !== 'occluded' && vis?.rightEye !== 'not_detected') {
        const eyeConf = face.rightEye.confidence ?? face.confidence;
        if (eyeConf >= minConf) {
          if (face.rightEye.upperLid?.points?.length >= 2) {
            candidates.push({
              id: `${subjectId}_face_right_eye_upper`,
              source: 'face_contour',
              region: 'eyes',
              level: 2,
              points: face.rightEye.upperLid.points,
              closed: false,
              confidence: eyeConf,
              visibility: face.rightEye.visibility ?? 'visible',
              subjectId
            });
          }
          if (face.rightEye.lowerLid?.points?.length >= 2) {
            candidates.push({
              id: `${subjectId}_face_right_eye_lower`,
              source: 'face_contour',
              region: 'eyes',
              level: 2,
              points: face.rightEye.lowerLid.points,
              closed: false,
              confidence: eyeConf,
              visibility: face.rightEye.visibility ?? 'visible',
              subjectId
            });
          }
          if (face.rightEye.iris) {
            candidates.push({
              id: `${subjectId}_face_right_eye_iris`,
              source: 'face_landmark',
              region: 'eyes',
              level: 4,
              points: [face.rightEye.iris],
              closed: false,
              confidence: eyeConf,
              visibility: 'visible',
              subjectId,
              isPointFeature: true
            });
          }
        }
      }

      // Left Eyebrow
      const leftEyebrow = face.leftEyebrow;
      if (leftEyebrow && leftEyebrow.points && leftEyebrow.points.length >= 2 && vis?.leftEyebrow !== 'occluded' && vis?.leftEyebrow !== 'not_detected') {
        candidates.push({
          id: `${subjectId}_face_left_eyebrow`,
          source: 'face_contour',
          region: 'eyebrows',
          level: 2,
          points: leftEyebrow.points,
          closed: false,
          confidence: leftEyebrow.confidence,
          visibility: leftEyebrow.visibility ?? 'visible',
          subjectId
        });
      }

      // Right Eyebrow
      const rightEyebrow = face.rightEyebrow;
      if (rightEyebrow && rightEyebrow.points && rightEyebrow.points.length >= 2 && vis?.rightEyebrow !== 'occluded' && vis?.rightEyebrow !== 'not_detected') {
        candidates.push({
          id: `${subjectId}_face_right_eyebrow`,
          source: 'face_contour',
          region: 'eyebrows',
          level: 2,
          points: rightEyebrow.points,
          closed: false,
          confidence: rightEyebrow.confidence,
          visibility: rightEyebrow.visibility ?? 'visible',
          subjectId
        });
      }

      // Nose Bridge & Tip (with single-point fix)
      const noseBridge = face.noseBridge;
      if (noseBridge && noseBridge.points && noseBridge.points.length >= 2 && vis?.nose !== 'occluded' && vis?.nose !== 'not_detected') {
        candidates.push({
          id: `${subjectId}_face_nose_bridge`,
          source: 'face_contour',
          region: 'nose',
          level: 2,
          points: noseBridge.points,
          closed: false,
          confidence: noseBridge.confidence,
          visibility: noseBridge.visibility ?? 'visible',
          subjectId
        });
      }

      const noseTip = face.noseTip;
      if (noseTip && noseTip.points && noseTip.points.length >= 1 && vis?.nose !== 'occluded' && vis?.nose !== 'not_detected') {
        const tipPts = noseTip.points.length >= 2 ? noseTip.points : [
          { x: Math.max(0, noseTip.points[0].x - 0.012), y: Math.max(0, noseTip.points[0].y - 0.002) },
          noseTip.points[0],
          { x: Math.min(1, noseTip.points[0].x + 0.012), y: Math.max(0, noseTip.points[0].y - 0.002) },
        ];
        candidates.push({
          id: `${subjectId}_face_nose_tip`,
          source: 'face_contour',
          region: 'nose',
          level: 2,
          points: tipPts,
          closed: false,
          confidence: noseTip.confidence,
          visibility: noseTip.visibility ?? 'visible',
          subjectId
        });
      }

      if (face.nostrils) {
        face.nostrils.forEach((nostril, idx) => {
          if (nostril && nostril.points && nostril.points.length >= 2) {
            candidates.push({
              id: `${subjectId}_face_nostril_${idx}`,
              source: 'face_contour',
              region: 'nose',
              level: 4,
              points: nostril.points,
              closed: nostril.closed,
              confidence: nostril.confidence,
              visibility: nostril.visibility ?? 'visible',
              subjectId
            });
          }
        });
      }

      // Mouth / Lips
      if (vis?.mouth !== 'occluded' && vis?.mouth !== 'not_detected') {
        const lipSeparation = face.lipSeparation;
        if (lipSeparation && lipSeparation.points && lipSeparation.points.length >= 2) {
          candidates.push({
            id: `${subjectId}_face_lip_separation`,
            source: 'face_contour',
            region: 'mouth',
            level: 2,
            points: lipSeparation.points,
            closed: false,
            confidence: lipSeparation.confidence,
            visibility: face.lipSeparation?.visibility ?? 'visible',
            subjectId
          });
        }

        const upperLip = face.upperLip;
        if (upperLip && upperLip.points && upperLip.points.length >= 2) {
          candidates.push({
            id: `${subjectId}_face_upper_lip`,
            source: 'face_contour',
            region: 'mouth',
            level: 2,
            points: upperLip.points,
            closed: false,
            confidence: upperLip.confidence,
            visibility: upperLip.visibility ?? 'visible',
            subjectId
          });
        }

        const lowerLip = face.lowerLip;
        if (lowerLip && lowerLip.points && lowerLip.points.length >= 2) {
          candidates.push({
            id: `${subjectId}_face_lower_lip`,
            source: 'face_contour',
            region: 'mouth',
            level: 2,
            points: lowerLip.points,
            closed: false,
            confidence: lowerLip.confidence,
            visibility: lowerLip.visibility ?? 'visible',
            subjectId
          });
        }
      }

      // Jawline & Chin (with single-point fix)
      const jawline = face.jawline;
      if (jawline && jawline.points && jawline.points.length >= 2 && vis?.jawline !== 'occluded' && vis?.jawline !== 'not_detected') {
        candidates.push({
          id: `${subjectId}_face_jawline`,
          source: 'face_contour',
          region: 'jawline',
          level: 1,
          points: jawline.points,
          closed: false,
          confidence: jawline.confidence,
          visibility: jawline.visibility ?? 'visible',
          subjectId
        });
      }

      const chin = face.chin;
      if (chin && chin.points && chin.points.length >= 1 && vis?.chin !== 'occluded' && vis?.chin !== 'not_detected') {
        const chinPts = chin.points.length >= 2 ? chin.points : [
          { x: Math.max(0, chin.points[0].x - 0.025), y: Math.max(0, chin.points[0].y - 0.005) },
          chin.points[0],
          { x: Math.min(1, chin.points[0].x + 0.025), y: Math.max(0, chin.points[0].y - 0.005) },
        ];
        candidates.push({
          id: `${subjectId}_face_chin`,
          source: 'face_contour',
          region: 'jawline',
          level: 1,
          points: chinPts,
          closed: false,
          confidence: chin.confidence,
          visibility: chin.visibility ?? 'visible',
          subjectId
        });
      }

      // Ears
      const leftEar = face.leftEar;
      if (leftEar && leftEar.points && leftEar.points.length >= 2 && vis?.leftEar !== 'occluded' && vis?.leftEar !== 'not_detected') {
        candidates.push({
          id: `${subjectId}_face_left_ear`,
          source: 'face_contour',
          region: 'ears',
          level: 2,
          points: leftEar.points,
          closed: false,
          confidence: leftEar.confidence,
          visibility: leftEar.visibility ?? 'visible',
          subjectId
        });
      }

      const rightEar = face.rightEar;
      if (rightEar && rightEar.points && rightEar.points.length >= 2 && vis?.rightEar !== 'occluded' && vis?.rightEar !== 'not_detected') {
        candidates.push({
          id: `${subjectId}_face_right_ear`,
          source: 'face_contour',
          region: 'ears',
          level: 2,
          points: rightEar.points,
          closed: false,
          confidence: rightEar.confidence,
          visibility: rightEar.visibility ?? 'visible',
          subjectId
        });
      }
    }

    // Silhouette Outline (only when no curated reconstruction is present)
    if (!subject.reconstruction && subject.silhouette) {
      subject.silhouette.forEach((sil, idx) => {
        if (sil.points?.length >= 3 && sil.confidence >= minConf) {
          candidates.push({
            id: `${subjectId}_silhouette_${idx}`,
            source: 'silhouette',
            region: 'body_outline',
            level: 0,
            points: sil.points,
            closed: sil.closed ?? true,
            confidence: sil.confidence,
            visibility: 'visible',
            subjectId
          });
        }
      });
    }

    // Hair Contours (only when no curated reconstruction is present)
    if (!subject.reconstruction && subject.hair) {
      subject.hair.forEach((h, idx) => {
        if (h.points?.length >= 2 && h.confidence >= minConf) {
          candidates.push({
            id: `${subjectId}_hair_${idx}`,
            source: 'deterministic_contour',
            region: 'hair',
            level: 3,
            points: h.points,
            closed: h.closed ?? false,
            confidence: h.confidence,
            visibility: h.visibility ?? 'visible',
            subjectId
          });
        }
      });
    }
  }

  // ----------------------------------------------------
  // 4. Body Features & Pose Skeleton (only fallback when no curated reconstruction is present)
  // ----------------------------------------------------
  if (!subject.reconstruction && subject.body) {
    const body = subject.body;

    const limbGroups: { name: string; list: ContourPath[]; region: SemanticRegion }[] = [
      { name: 'shoulder', list: body.shoulders, region: 'shoulders' },
      { name: 'arm', list: body.arms, region: 'body_outline' },
      { name: 'torso', list: body.torso, region: 'body_outline' },
      { name: 'leg', list: body.legs, region: 'body_outline' }
    ];

    limbGroups.forEach(grp => {
      grp.list?.forEach((pth, idx) => {
        if (pth.points?.length >= 2 && pth.confidence >= minConf) {
          candidates.push({
            id: `${subjectId}_body_${grp.name}_${idx}`,
            source: 'deterministic_contour',
            region: grp.region,
            level: 1,
            points: pth.points,
            closed: pth.closed ?? false,
            confidence: pth.confidence,
            visibility: pth.visibility ?? 'visible',
            subjectId
          });
        }
      });
    });

    if (options?.includePoseConnections === true && body.pose?.connections) {
      body.pose.connections.forEach((conn, idx) => {
        if (conn.from && conn.to && conn.confidence >= minConf) {
          candidates.push({
            id: `${subjectId}_pose_conn_${idx}_${conn.name}`,
            source: 'pose_connection',
            region: 'body_outline',
            level: 1,
            points: [conn.from, conn.to],
            closed: false,
            confidence: conn.confidence,
            visibility: 'visible',
            subjectId
          });
        }
      });
    }
  }

  // ----------------------------------------------------
  // 5. Semantic Mask Boundaries (only fallback when no curated reconstruction is present)
  // ----------------------------------------------------
  if (!subject.reconstruction && options?.extractSemanticMaskContours !== false && subject.semanticSegmentation?.masks) {
    const step = options?.maskContourStep ?? 2;
    const minArea = options?.minSemanticArea ?? 60;

    subject.semanticSegmentation.masks.forEach(mask => {
      if (mask.category === 'background' || mask.category === 'unknown') {
        return;
      }

      // If hair was already reconstructed or detected, avoid duplicate spiky raw hair loops
      if (mask.category === 'hair' && (subject.reconstruction?.hair || subject.hair)) {
        return;
      }

      // Face skin mask boundaries are redundant with jawline & hairline contours
      if (mask.category === 'face_skin') {
        return;
      }

      let region: SemanticRegion = 'clothing';
      let level: PathHierarchyLevel = 3;

      if (mask.category === 'hair') {
        region = 'hair';
        level = 3;
      } else if (mask.category === 'body_skin') {
        region = 'body_outline';
        level = 3;
      } else if (mask.category === 'clothing') {
        region = 'clothing';
        level = 3;
      } else if (mask.category === 'accessories') {
        region = 'accessories';
        level = 3;
      }

      const maskLoops = extractMaskContours(mask, step, minArea);
      let emittedForCategory = 0;
      for (let idx = 0; idx < maskLoops.length; idx++) {
        const loop = maskLoops[idx];
        if (loop.length < 6) continue;

        const loopArea = computePolygonArea(loop);
        // Only keep major clothing outer perimeter (area >= 0.02) and cap at 2 per category
        if (mask.category === 'clothing' && (loopArea < 0.02 || emittedForCategory >= 2)) {
          continue;
        }
        if (mask.category === 'body_skin' && (loopArea < 0.015 || emittedForCategory >= 1)) {
          continue;
        }

        candidates.push({
          id: `${subjectId}_semantic_${mask.category}_${idx}`,
          source: 'semantic_boundary',
          region,
          level,
          points: loop,
          closed: true,
          confidence: mask.confidence * 0.8,
          visibility: 'visible',
          subjectId
        });
        emittedForCategory++;
      }
    });
  }

  return candidates;
}

/**
 * Computes overall aggregate geometry metrics.
 */
function computeGeometryMetrics(
  paths: readonly VectorPath[],
  elapsedMs: number
): GeometryMetrics {
  let totalRawPoints = 0;
  let totalSimplifiedPoints = 0;

  const pathCountByLevel: Record<PathHierarchyLevel, number> = {
    0: 0,
    1: 0,
    2: 0,
    3: 0,
    4: 0
  };

  const pathCountByRegion: Partial<Record<SemanticRegion, number>> = {};

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    totalRawPoints += p.rawPoints?.length ?? p.points.length;
    totalSimplifiedPoints += p.points.length;

    pathCountByLevel[p.level] = (pathCountByLevel[p.level] ?? 0) + 1;
    pathCountByRegion[p.region] = (pathCountByRegion[p.region] ?? 0) + 1;

    if (p.bounds.x < minX) minX = p.bounds.x;
    if (p.bounds.y < minY) minY = p.bounds.y;
    if (p.bounds.x + p.bounds.width > maxX) maxX = p.bounds.x + p.bounds.width;
    if (p.bounds.y + p.bounds.height > maxY) maxY = p.bounds.y + p.bounds.height;
  }

  const pointReductionRatio =
    totalRawPoints > 0 ? (totalRawPoints - totalSimplifiedPoints) / totalRawPoints : 0;

  const bounds: BoundingBox =
    paths.length > 0
      ? {
          x: Math.max(0, Math.min(1, minX)),
          y: Math.max(0, Math.min(1, minY)),
          width: Math.max(0, Math.min(1, maxX - minX)),
          height: Math.max(0, Math.min(1, maxY - minY))
        }
      : { x: 0, y: 0, width: 0, height: 0 };

  return {
    totalPaths: paths.length,
    totalRawPoints,
    totalSimplifiedPoints,
    pointReductionRatio: Math.round(pointReductionRatio * 10000) / 10000,
    pathCountByLevel,
    pathCountByRegion,
    bounds,
    processingTimeMs: Math.round(elapsedMs * 100) / 100
  };
}

/**
 * Main entry point: converts a SubjectModel into clean, deterministic VectorGeometry.
 *
 * @param subject Canonical SubjectModel intermediate representation.
 * @param options Vector extraction and simplification options.
 * @returns Fully processed VectorGeometry container.
 */
export function extractVectorGeometry(
  subject: SubjectModel,
  options?: VectorExtractionOptions
): VectorGeometry {
  const startTime = globalThis.performance?.now() ?? Date.now();

  const candidates = harvestSubjectCandidates(subject, options);
  const paths: VectorPath[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const vectorPath = processCandidatePath(candidates[i], options);
    if (vectorPath) {
      paths.push(vectorPath);
    }
  }

  // Sort paths primarily by hierarchy level (0 -> 1 -> 2 -> 3 -> 4) and secondarily by descending importance
  paths.sort((a, b) => {
    if (a.level !== b.level) {
      return a.level - b.level;
    }
    return b.importance - a.importance;
  });

  const elapsedMs = (globalThis.performance?.now() ?? Date.now()) - startTime;
  const metrics = computeGeometryMetrics(paths, elapsedMs);

  return {
    version: '0.1.0',
    paths,
    bounds: metrics.bounds,
    metrics,
    timestamp: Date.now()
  };
}

/**
 * Extracts vector geometry for an array of subjects (e.g. multi-person BM-11),
 * tagging paths with subject-specific IDs to preserve group separation.
 *
 * @param subjects Array of SubjectModels.
 * @param options Vector extraction options.
 * @returns Unified VectorGeometry containing all subjects.
 */
export function extractAllVectorGeometry(
  subjects: readonly SubjectModel[],
  options?: VectorExtractionOptions
): VectorGeometry {
  const startTime = globalThis.performance?.now() ?? Date.now();

  if (!subjects || subjects.length === 0) {
    return {
      version: '0.1.0',
      paths: [],
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      metrics: {
        totalPaths: 0,
        totalRawPoints: 0,
        totalSimplifiedPoints: 0,
        pointReductionRatio: 0,
        pathCountByLevel: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 },
        pathCountByRegion: {},
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        processingTimeMs: 0
      },
      timestamp: Date.now()
    };
  }

  const allPaths: VectorPath[] = [];

  for (let s = 0; s < subjects.length; s++) {

    const sub = subjects[s];
    const geom = extractVectorGeometry(sub, options);
    allPaths.push(...geom.paths);
  }

  allPaths.sort((a, b) => {
    if (a.level !== b.level) {
      return a.level - b.level;
    }
    return b.importance - a.importance;
  });

  const elapsedMs = (globalThis.performance?.now() ?? Date.now()) - startTime;
  const metrics = computeGeometryMetrics(allPaths, elapsedMs);

  return {
    version: '0.1.0',
    paths: allPaths,
    bounds: metrics.bounds,
    metrics,
    timestamp: Date.now()
  };
}
