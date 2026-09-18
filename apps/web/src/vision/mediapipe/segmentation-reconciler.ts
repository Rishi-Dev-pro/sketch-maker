/**
 * Hybrid Segmentation Reconciler
 * TASK-103.9 MediaPipe Integration
 *
 * Reconciles MediaPipe semantic segmentation with TASK-102 deterministic
 * perceptual saliency and gradient-barrier segmentation.
 *
 * Implements evidence-aware merging:
 * 1. Agreement: Strong mutual consensus forms high-confidence core.
 * 2. Semantic Override: High ML confidence (>0.80) on clothing/hair fills gaps where deterministic contrast failed.
 * 3. Boundary Fidelity: Strong local Sobel gradient barriers prevent mask blobbing and preserve crisp silhouette edges.
 * 4. Conflict: Ambiguous boundary zones are preserved as soft probabilities in the continuous confidence map.
 */

import {
  SemanticSegmentation,
  SemanticMask,
} from '@sketch-maker/shared-types';
import { SubjectMask } from '@sketch-maker/structural-analysis';

export interface ReconciliationMetrics {
  readonly agreementRatio: number; // Fraction of pixels where both agree on classification
  readonly mlOverrideRatio: number; // Pixels promoted to foreground by strong ML evidence
  readonly detPreservedRatio: number; // Pixels preserved by deterministic gradient edge evidence
  readonly uncertainBoundaryRatio: number; // Pixels in transition band [0.35 - 0.65]
}

export interface ReconciledSegmentationResult {
  readonly reconciledMask: SubjectMask;
  readonly reconciledSemanticSegmentation: SemanticSegmentation;
  readonly metrics: ReconciliationMetrics;
}

/**
 * Reconciles MediaPipe semantic segmentation with TASK-102 deterministic segmentation.
 *
 * @param mlMask SubjectMask generated from MediaPipe segmenter
 * @param mlSemantic SemanticSegmentation containing multiclass masks
 * @param detMask SubjectMask generated from TASK-102 deterministic pipeline
 * @param gradientMagnitudes Optional normalized Sobel gradient array [0.0 - 1.0] at target resolution
 */
export function reconcileHybridSegmentation(
  mlMask: SubjectMask,
  mlSemantic: SemanticSegmentation,
  detMask: SubjectMask,
  gradientMagnitudes?: Float32Array
): ReconciledSegmentationResult {
  const width = mlMask.width;
  const height = mlMask.height;
  const totalPixels = width * height;

  const outData = new Uint8Array(totalPixels);
  const outConfidence = new Float32Array(totalPixels);

  let agreementCount = 0;
  let mlOverrideCount = 0;
  let detPreservedCount = 0;
  let uncertainBoundaryCount = 0;

  for (let i = 0; i < totalPixels; i++) {
    const pML = mlMask.confidenceMap[i];
    const pDet = detMask.confidenceMap[i];
    const grad = gradientMagnitudes ? gradientMagnitudes[i] : 0;

    const isMLFore = pML >= 0.5;
    const isDetFore = pDet >= 0.5;

    // Case 1: Mutual Agreement
    if (isMLFore && isDetFore) {
      agreementCount++;
      outData[i] = 255;
      outConfidence[i] = Math.max(pML, pDet);
      continue;
    }

    if (!isMLFore && !isDetFore) {
      agreementCount++;
      outData[i] = 0;
      outConfidence[i] = Math.min(pML, pDet);
      continue;
    }

    // Case 2: Conflict - ML says foreground, Deterministic says background
    if (isMLFore && !isDetFore) {
      if (pML >= 0.80 && grad < 0.35) {
        // Strong ML semantic certainty (e.g. dark clothes or low-contrast hair mass)
        mlOverrideCount++;
        outData[i] = 255;
        outConfidence[i] = pML * 0.92;
      } else if (grad >= 0.35) {
        // Strong deterministic gradient edge boundary; respect the anatomical barrier
        detPreservedCount++;
        outData[i] = 0;
        outConfidence[i] = 0.40; // Tagged as uncertain transition
        uncertainBoundaryCount++;
      } else {
        // Moderate conflict: blend confidences
        const blended = 0.60 * pML + 0.40 * pDet;
        outConfidence[i] = blended;
        outData[i] = blended >= 0.50 ? 255 : 0;
        uncertainBoundaryCount++;
      }
      continue;
    }

    // Case 3: Conflict - Deterministic says foreground, ML says background
    if (!isMLFore && isDetFore) {
      if (pDet >= 0.80 && grad >= 0.25) {
        // Clear high-contrast structural contour (e.g. fine hair boundary or ear pinna edge)
        detPreservedCount++;
        outData[i] = 255;
        outConfidence[i] = pDet * 0.88;
      } else if (pML < 0.20) {
        // Strong ML background confirmation suppresses deterministic background clutter
        outData[i] = 0;
        outConfidence[i] = pML;
      } else {
        // Moderate conflict: blend confidences
        const blended = 0.45 * pML + 0.55 * pDet;
        outConfidence[i] = blended;
        outData[i] = blended >= 0.50 ? 255 : 0;
        uncertainBoundaryCount++;
      }
      continue;
    }
  }

  // Update semantic masks with refined hybrid boundaries
  const reconciledMasks: SemanticMask[] = mlSemantic.masks.map((mask) => {
    // Only refine foreground masks, keep background mask if present
    if (mask.category === 'background') return mask;

    const refinedData = new Uint8Array(totalPixels);
    let area = 0;

    for (let i = 0; i < totalPixels; i++) {
      // Retain semantic class only if pixel is within the reconciled subject boundary
      if (mask.data[i] > 0 && outData[i] > 0) {
        refinedData[i] = 255;
        area++;
      }
    }

    return {
      ...mask,
      data: refinedData,
      pixelArea: area,
    };
  });

  const reconciledMask: SubjectMask = {
    width,
    height,
    data: outData,
    confidenceMap: outConfidence,
  };

  const reconciledSemanticSegmentation: SemanticSegmentation = {
    categories: mlSemantic.categories,
    masks: reconciledMasks,
    confidence: Number(
      Math.max(
        0.5,
        Math.min(1.0, 0.5 * mlSemantic.confidence + 0.5 * detMask.data.length > 0 ? 0.92 : 0.85)
      ).toFixed(4)
    ),
    provider: 'hybrid',
  };

  const metrics: ReconciliationMetrics = {
    agreementRatio: Number((agreementCount / totalPixels).toFixed(4)),
    mlOverrideRatio: Number((mlOverrideCount / totalPixels).toFixed(4)),
    detPreservedRatio: Number((detPreservedCount / totalPixels).toFixed(4)),
    uncertainBoundaryRatio: Number((uncertainBoundaryCount / totalPixels).toFixed(4)),
  };

  return {
    reconciledMask,
    reconciledSemanticSegmentation,
    metrics,
  };
}
