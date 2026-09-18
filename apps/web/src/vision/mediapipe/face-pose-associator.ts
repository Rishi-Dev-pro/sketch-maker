/**
 * Face + Pose Association Engine
 * TASK-103.8 MediaPipe Pose Landmarker Integration
 *
 * Coordinates and associates independently detected facial landmarks and body pose skeletons
 * into unified, multi-person SubjectModel instances.
 */

import {
  SubjectModel,
  Dimensions,
  BoundingBox,
  Point2D,
} from '@sketch-maker/shared-types';
import {
  RawPoseLandmark,
  mapMediaPipePoseToBodyFeatures,
} from './pose-mapper';

/**
 * Computes the union bounding box of two boxes in normalized [0, 1] coordinates.
 */
export function unionBoundingBoxes(a: BoundingBox, b: BoundingBox): BoundingBox {
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x + a.width, b.x + b.width);
  const maxY = Math.max(a.y + a.height, b.y + b.height);

  return {
    x: Number(minX.toFixed(5)),
    y: Number(minY.toFixed(5)),
    width: Number(Math.max(0.01, maxX - minX).toFixed(5)),
    height: Number(Math.max(0.01, maxY - minY).toFixed(5)),
  };
}

/**
 * Computes 2D Euclidean distance between two points.
 */
export function pointDistance(p1: Point2D, p2: Point2D): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Associates facial landmark subjects and body pose skeletons into cohesive SubjectModel instances.
 */
export function associateFacesAndPoses(
  faceSubjects: SubjectModel[],
  rawPoses: RawPoseLandmark[][],
  dimensions: Dimensions
): SubjectModel[] {
  // Case 0: No perception inputs
  if (faceSubjects.length === 0 && rawPoses.length === 0) {
    return [];
  }

  // Map raw poses to BodyFeatures
  const bodyFeaturesList = rawPoses.map((rp) => mapMediaPipePoseToBodyFeatures(rp));

  // Case 1: Simple 1-to-1 matching (Single person in frame)
  if (faceSubjects.length === 1 && bodyFeaturesList.length === 1) {
    const faceSub = faceSubjects[0];
    const body = bodyFeaturesList[0];
    const poseBox = body.pose?.boundingBox ?? faceSub.boundingBox;
    const combinedBox = unionBoundingBoxes(faceSub.boundingBox, poseBox);

    return [
      {
        ...faceSub,
        boundingBox: combinedBox,
        body,
        globalConfidence: Number(((faceSub.globalConfidence + body.poseConfidence) * 0.5).toFixed(3)),
      },
    ];
  }

  // Case 2: Only poses detected (No faces resolved)
  if (faceSubjects.length === 0 && bodyFeaturesList.length > 0) {
    return bodyFeaturesList.map((body, idx) => ({
      id: `subject-pose-${idx + 1}`,
      version: '1.0.0',
      sourceDimensions: dimensions,
      boundingBox: body.pose?.boundingBox ?? { x: 0, y: 0, width: 1, height: 1 },
      silhouette: [],
      body,
      globalConfidence: body.poseConfidence,
      timestamp: Date.now(),
    }));
  }

  // Case 3: Only faces detected (No poses resolved)
  if (faceSubjects.length > 0 && bodyFeaturesList.length === 0) {
    return faceSubjects;
  }

  // Case 4: General multi-person association (BM-11)
  const matchedFaceIndices = new Set<number>();
  const unifiedSubjects: SubjectModel[] = [];

  for (let pIdx = 0; pIdx < bodyFeaturesList.length; pIdx++) {
    const body = bodyFeaturesList[pIdx];
    const pose = body.pose;
    if (!pose) continue;

    // Use nose or neck as the anatomical head anchor point
    const headAnchor: Point2D = pose.nose?.point ?? pose.neck?.point ?? {
      x: (pose.leftShoulder?.point.x ?? 0.5 + (pose.rightShoulder?.point.x ?? 0.5)) * 0.5,
      y: (pose.leftShoulder?.point.y ?? 0.3 + (pose.rightShoulder?.point.y ?? 0.3)) * 0.5 - 0.1,
    };

    let bestFaceIdx = -1;
    let minDistance = Infinity;

    for (let fIdx = 0; fIdx < faceSubjects.length; fIdx++) {
      if (matchedFaceIndices.has(fIdx)) continue;

      const fBox = faceSubjects[fIdx].boundingBox;
      const faceCenter: Point2D = {
        x: fBox.x + fBox.width * 0.5,
        y: fBox.y + fBox.height * 0.5,
      };

      // Check if head anchor is within or immediately adjacent to the face bounding box
      const inFaceBox =
        headAnchor.x >= fBox.x - fBox.width * 0.25 &&
        headAnchor.x <= fBox.x + fBox.width * 1.25 &&
        headAnchor.y >= fBox.y - fBox.height * 0.25 &&
        headAnchor.y <= fBox.y + fBox.height * 1.25;

      const dist = pointDistance(headAnchor, faceCenter);

      if (inFaceBox && dist < minDistance) {
        minDistance = dist;
        bestFaceIdx = fIdx;
      } else if (dist < 0.25 && dist < minDistance) {
        minDistance = dist;
        bestFaceIdx = fIdx;
      }
    }

    if (bestFaceIdx !== -1) {
      matchedFaceIndices.add(bestFaceIdx);
      const faceSub = faceSubjects[bestFaceIdx];
      const combinedBox = unionBoundingBoxes(faceSub.boundingBox, pose.boundingBox ?? faceSub.boundingBox);

      unifiedSubjects.push({
        ...faceSub,
        boundingBox: combinedBox,
        body,
        globalConfidence: Number(((faceSub.globalConfidence + body.poseConfidence) * 0.5).toFixed(3)),
      });
    } else {
      // Unmatched pose (e.g. back of head or face occluded)
      unifiedSubjects.push({
        id: `subject-pose-${pIdx + 1}`,
        version: '1.0.0',
        sourceDimensions: dimensions,
        boundingBox: pose.boundingBox ?? { x: 0, y: 0, width: 1, height: 1 },
        silhouette: [],
        body,
        globalConfidence: body.poseConfidence,
        timestamp: Date.now(),
      });
    }
  }

  // Add any remaining unmatched faces (e.g. portraits with lower body cut off)
  for (let fIdx = 0; fIdx < faceSubjects.length; fIdx++) {
    if (!matchedFaceIndices.has(fIdx)) {
      unifiedSubjects.push(faceSubjects[fIdx]);
    }
  }

  // Sort subjects deterministically by horizontal coordinate (left to right)
  unifiedSubjects.sort((a, b) => a.boundingBox.x - b.boundingBox.x);

  return unifiedSubjects;
}
