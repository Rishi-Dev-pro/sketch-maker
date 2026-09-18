/**
 * Deterministic Vision Provider
 * TASK-103.6 Provider Abstraction
 *
 * Wraps the existing pure-TypeScript structural-analysis pipeline
 * (segmentation, face estimation, facial landmarks, jawline, ears, hair)
 * and emits canonical Universal SubjectModel representations.
 *
 * Invariants:
 * - Pure TypeScript with zero runtime dependencies.
 * - Deterministic, offline-native, platform-agnostic (Node, Browser, React Native).
 * - Authoritative provider for ear pinna contours and profile occluded feature suppression.
 */

import {
  SubjectModel,
  FacialFeatures,
  ContourPath,
  BoundingBox,
  Dimensions,
} from '@sketch-maker/shared-types';
import {
  VisionProvider,
  VisionProviderMetadata,
  VisionInput,
  VisionResult,
} from './types';
import { segmentSubject } from '../segmentation';
import { computeSobelGradients } from '../gradient';
import { estimateAllFaceRegions } from '../face-region';
import { detectEyeLandmarks } from '../eyes';
import { detectEyebrows } from '../eyebrows';
import { detectNose } from '../nose';
import { detectMouth } from '../mouth';
import { detectJawline } from '../jawline';
import { detectEars } from '../ears';
import { detectHair } from '../hair';
import { FaceRegionEstimate, SubjectRegion } from '../types';

export class DeterministicVisionProvider implements VisionProvider {
  readonly metadata: VisionProviderMetadata = {
    id: 'deterministic-ts',
    name: 'Pure-TypeScript Deterministic Vision Provider',
    version: '1.0.0',
    type: 'deterministic',
    platform: 'cross-platform',
    capabilities: {
      faceLandmarks: true,
      faceMeshDensity: 'sparse_structural',
      earPinna: true,
      jawlineContour: true,
      hairStructure: true,
      bodyPose: false,
      foregroundSegmentation: true,
      multiclassSegmentation: false,
    },
  };

  /**
   * Deterministic provider has zero external runtime or model dependencies.
   * It is always available in any JavaScript/TypeScript runtime.
   */
  isAvailable(): boolean {
    return true;
  }

  /**
   * Executes deterministic structural analysis on the normalized image.
   */
  async analyze(input: VisionInput): Promise<VisionResult> {
    const t0 = performance.now();
    const image = input.image;
    const options = input.options;
    const imgW = image.luminance.width;
    const imgH = image.luminance.height;

    // 1. Multi-cue foreground subject segmentation
    const segResult = segmentSubject(image, options?.segmentationOptions);

    // 2. Compute Sobel gradient field
    const gradients = computeSobelGradients(image.luminance);

    // 3. Multi-subject face region and pose estimation
    const faceEstimates = options?.includeFacialLandmarks !== false
      ? estimateAllFaceRegions(segResult, image, gradients)
      : [];

    const subjects: SubjectModel[] = [];
    const allSubjectRegions: SubjectRegion[] = [];
    if (segResult.instances && segResult.instances.length > 0) {
      allSubjectRegions.push(...segResult.instances);
    }

    if (allSubjectRegions.length === 0) {
      allSubjectRegions.push({
        id: 'subject-0',
        label: 'primary_subject',
        boundingBox: segResult.boundingBox ?? { x: 0, y: 0, width: 1, height: 1 },
        pixelBoundingBox: segResult.pixelBoundingBox ?? { x: 0, y: 0, width: imgW, height: imgH },
        pixelArea: imgW * imgH,
        confidence: typeof segResult.confidence === 'number' && !isNaN(segResult.confidence) ? segResult.confidence : 0.75,
      });
    }

    const maxSubjects = options?.maxSubjects ?? 4;
    const targetRegions = allSubjectRegions.slice(0, maxSubjects);

    for (let i = 0; i < targetRegions.length; i++) {
      const region = targetRegions[i];
      const matchingFace = faceEstimates.find((f) => f.subjectId === region.id) ?? (i === 0 && faceEstimates.length > 0 ? faceEstimates[0] : undefined);

      let facialFeatures: FacialFeatures | undefined;
      let hairContours: ContourPath[] | undefined;

      if (matchingFace && options?.includeFacialLandmarks !== false) {
        // Run modular facial detectors
        const eyes = detectEyeLandmarks(matchingFace, image, gradients, segResult.mask);
        const brows = detectEyebrows(matchingFace, image, gradients, segResult.mask, eyes);
        const nose = detectNose(matchingFace, image, gradients, segResult.mask, eyes);
        const mouth = detectMouth(matchingFace, image, gradients, segResult.mask, eyes, nose);
        const jawline = detectJawline(matchingFace, image, gradients, segResult.mask, eyes, nose, mouth);
        const ears = detectEars(matchingFace, image, gradients, segResult.mask, eyes, brows, nose, mouth, jawline);

        let hairResult;
        if (options?.includeHair !== false) {
          hairResult = detectHair(matchingFace, image, gradients, segResult.mask, brows, eyes, jawline, ears);
          hairContours = [...hairResult.allContours];
        }

        // Assemble FacialFeatures
        facialFeatures = {
          boundingBox: matchingFace.faceBoundingBox,
          pose: matchingFace.pose,
          leftEye: eyes.leftEye,
          rightEye: eyes.rightEye,
          leftEyebrow: brows.leftEyebrow,
          rightEyebrow: brows.rightEyebrow,
          noseBridge: nose.bridge,
          noseTip: nose.tip,
          nostrils: [
            ...(nose.leftNostril ? [nose.leftNostril] : []),
            ...(nose.rightNostril ? [nose.rightNostril] : []),
          ],
          upperLip: mouth.upperLip,
          lowerLip: mouth.lowerLip,
          lipSeparation: mouth.lipSeparation,
          jawline: jawline.leftJaw ?? jawline.rightJaw,
          chin: jawline.chin,
          leftEar: ears.leftEar,
          rightEar: ears.rightEar,
          featureVisibility: {
            leftEye: eyes.leftEye?.visibility ?? 'not_detected',
            rightEye: eyes.rightEye?.visibility ?? 'not_detected',
            leftEyebrow: brows.leftEyebrow?.visibility ?? 'not_detected',
            rightEyebrow: brows.rightEyebrow?.visibility ?? 'not_detected',
            nose: nose.visibility,
            mouth: mouth.visibility,
            jawline: jawline.visibility,
            leftEar: ears.leftEar?.visibility ?? 'not_detected',
            rightEar: ears.rightEar?.visibility ?? 'not_detected',
          },
          confidence: (() => {
            const eyeScores: number[] = [];
            if (eyes.leftEye?.confidence !== undefined && !isNaN(eyes.leftEye.confidence)) eyeScores.push(eyes.leftEye.confidence);
            if (eyes.rightEye?.confidence !== undefined && !isNaN(eyes.rightEye.confidence)) eyeScores.push(eyes.rightEye.confidence);
            const eyeConf = eyeScores.length > 0 ? eyeScores.reduce((a, b) => a + b, 0) / eyeScores.length : 0.7;

            const browScores: number[] = [];
            if (brows.leftEyebrow?.confidence !== undefined && !isNaN(brows.leftEyebrow.confidence)) browScores.push(brows.leftEyebrow.confidence);
            if (brows.rightEyebrow?.confidence !== undefined && !isNaN(brows.rightEyebrow.confidence)) browScores.push(brows.rightEyebrow.confidence);
            const browConf = browScores.length > 0 ? browScores.reduce((a, b) => a + b, 0) / browScores.length : 0.7;

            const noseConf = typeof nose.confidence === 'number' && !isNaN(nose.confidence) ? nose.confidence : 0.7;
            const mouthConf = typeof mouth.confidence === 'number' && !isNaN(mouth.confidence) ? mouth.confidence : 0.7;
            const jawConf = typeof jawline.confidence === 'number' && !isNaN(jawline.confidence) ? jawline.confidence : 0.7;
            const earConf = typeof ears.confidence === 'number' && !isNaN(ears.confidence) ? ears.confidence : 0.7;

            const avg = (eyeConf + browConf + noseConf + mouthConf + jawConf + earConf) / 6;
            return Number(Math.max(0.0, Math.min(1.0, avg)).toFixed(3));
          })(),
        };
      }

      // Convert region bounding box to silhouette contour anchor
      const silhouettePath: ContourPath = {
        id: `silhouette-${region.id}`,
        region: 'body_outline',
        points: [
          { x: region.boundingBox.x, y: region.boundingBox.y },
          { x: region.boundingBox.x + region.boundingBox.width, y: region.boundingBox.y },
          { x: region.boundingBox.x + region.boundingBox.width, y: region.boundingBox.y + region.boundingBox.height },
          { x: region.boundingBox.x, y: region.boundingBox.y + region.boundingBox.height },
        ],
        closed: true,
        confidence: region.confidence,
        visibility: 'visible',
      };

      const sourceDims: Dimensions = input.sourceDimensions
        ? { width: input.sourceDimensions.width, height: input.sourceDimensions.height }
        : { width: imgW, height: imgH };

        const regConf = typeof region.confidence === 'number' && !isNaN(region.confidence) ? region.confidence : 0.80;
        const faceConf = facialFeatures && typeof facialFeatures.confidence === 'number' && !isNaN(facialFeatures.confidence) ? facialFeatures.confidence : 1.0;
        const globalConfidence = Number(Math.max(0.0, Math.min(1.0, regConf * faceConf)).toFixed(3));

        const subjectModel: SubjectModel = {
          id: region.id,
          version: '1.0.0',
          sourceDimensions: sourceDims,
          boundingBox: region.boundingBox,
          silhouette: [silhouettePath],
          face: facialFeatures,
          hair: hairContours,
          globalConfidence,
          timestamp: Date.now(),
        };

      subjects.push(subjectModel);
    }

    // Default primary subject fallback if none detected
    const primarySubject: SubjectModel = subjects[0] ?? {
      id: 'subject-fallback',
      version: '1.0.0',
      sourceDimensions: input.sourceDimensions
        ? { width: input.sourceDimensions.width, height: input.sourceDimensions.height }
        : { width: imgW, height: imgH },
      boundingBox: { x: 0, y: 0, width: 1, height: 1 },
      silhouette: [],
      globalConfidence: 0.1,
      timestamp: Date.now(),
    };

    const latencyMs = performance.now() - t0;
    const origW = input.sourceDimensions?.width ?? imgW;
    const origH = input.sourceDimensions?.height ?? imgH;

    return {
      primarySubject,
      subjects,
      scale: {
        x: origW / imgW,
        y: origH / imgH,
      },
      metrics: {
        latencyMs,
        subjectCount: subjects.length,
        hasFace: subjects.some((s) => !!s.face),
        hasBody: false,
      },
      provider: this.metadata,
      executionPlan: {
        requestedMode: options?.mode ?? 'deterministic',
        resolvedProviderId: this.metadata.id,
        fallbackOccurred: false,
        executionDurationMs: latencyMs,
      },
    };
  }
}
