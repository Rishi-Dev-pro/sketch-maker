import { performance } from 'node:perf_hooks';
import { NormalizedImage } from '@sketch-maker/image-processing';
import { BoundingBox, Dimensions } from '@sketch-maker/shared-types';
import {
  SegmentationResult,
  SegmentationOptions,
  SubjectMask,
  SubjectRegion,
} from './types';
import { computeSobelGradients } from './gradient';
import { computePerceptualSaliency } from './saliency';

/**
 * Segments the foreground subject(s) from the background in a preprocessed NormalizedImage.
 *
 * Emits a high-fidelity binary mask, soft anti-aliased confidence map, bounding boxes,
 * and individual subject instances (supporting single-subject and multi-subject inputs).
 *
 * @param image Preprocessed NormalizedImage from TASK-101
 * @param options Configuration options
 * @returns SegmentationResult
 */
export function segmentSubject(
  image: NormalizedImage,
  options?: SegmentationOptions
): SegmentationResult {
  const startTime = performance.now();

  const { width, height } = image.processingDimensions;
  const pixelCount = width * height;

  if (pixelCount === 0) {
    throw new Error('Cannot segment empty image: width and height must be > 0.');
  }

  const sensitivity = options?.sensitivity ?? 0.50;
  const edgeWeight = options?.edgeWeight ?? 1.0;
  const maxInstances = options?.maxInstances ?? 4;
  const minAreaFraction = options?.minSubjectAreaFraction ?? 0.02;
  const mode = options?.mode ?? 'standard';

  // 1. Compute structural gradient barriers from luminance
  const gradients = computeSobelGradients(image.luminance);

  // 2. Compute multi-cue perceptual saliency field
  const saliency = computePerceptualSaliency(image.rgba, gradients);

  // 3. Determine adaptive saliency threshold based on mode and sensitivity
  // Higher sensitivity captures more subtle peripheral body/hair outlines
  let baseThreshold = 0.38 - (sensitivity - 0.50) * 0.20;
  if (mode === 'aggressive') baseThreshold += 0.08;
  if (mode === 'conservative') baseThreshold -= 0.06;

  // 4. Initial seed classification with edge gradient resistance
  // Pixels with high saliency and not directly on an edge barrier are primary foreground seeds
  const rawMask = new Uint8Array(pixelCount);
  const edgeBarrierThreshold = 0.40 / Math.max(0.2, edgeWeight);

  for (let i = 0; i < pixelCount; i++) {
    const s = saliency.data[i];
    const g = gradients.magnitude[i];

    // Core foreground: strong saliency
    if (s >= baseThreshold) {
      rawMask[i] = 1;
    } else if (s >= baseThreshold - 0.12 && g < edgeBarrierThreshold) {
      // Soft boundary: intermediate saliency without crossing strong edge barrier
      rawMask[i] = 1;
    }
  }

  // 5. Regional growing / boundary dilation stopping at strong structural edges
  // Allows the subject mask to cleanly reach the outer contour without bleeding into flat background
  const grownMask = new Uint8Array(rawMask);
  for (let y = 1; y < height - 1; y++) {
    const rowOffset = y * width;
    for (let x = 1; x < width - 1; x++) {
      const idx = rowOffset + x;
      if (rawMask[idx] === 1) continue;

      // Check 4-connected neighbors
      const hasFgNeighbor =
        rawMask[idx - 1] === 1 ||
        rawMask[idx + 1] === 1 ||
        rawMask[idx - width] === 1 ||
        rawMask[idx + width] === 1;

      if (hasFgNeighbor) {
        const localGrad = gradients.magnitude[idx];
        const localSaliency = saliency.data[idx];
        // Only grow into neighbors that have edge contours or genuine subject saliency
        if (localGrad > 0.08 || localSaliency >= baseThreshold - 0.08) {
          grownMask[idx] = 1;
        }
      }
    }
  }

  // 6. Connected component labeling (Two-pass with union-find)
  const labels = new Int32Array(pixelCount);
  let nextLabel = 1;
  const parent: number[] = [0];

  function find(i: number): number {
    let root = i;
    while (root !== parent[root]) root = parent[root];
    let curr = i;
    while (curr !== root) {
      const nxt = parent[curr];
      parent[curr] = root;
      curr = nxt;
    }
    return root;
  }

  function union(i: number, j: number) {
    const rootI = find(i);
    const rootJ = find(j);
    if (rootI !== rootJ) parent[rootJ] = rootI;
  }

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const idx = rowOffset + x;
      if (grownMask[idx] === 0) continue;

      const leftLabel = x > 0 && grownMask[idx - 1] === 1 ? labels[idx - 1] : 0;
      const topLabel = y > 0 && grownMask[idx - width] === 1 ? labels[idx - width] : 0;

      if (leftLabel === 0 && topLabel === 0) {
        labels[idx] = nextLabel;
        parent.push(nextLabel);
        nextLabel++;
      } else if (leftLabel !== 0 && topLabel === 0) {
        labels[idx] = leftLabel;
      } else if (leftLabel === 0 && topLabel !== 0) {
        labels[idx] = topLabel;
      } else {
        const minL = Math.min(leftLabel, topLabel);
        labels[idx] = minL;
        union(leftLabel, topLabel);
      }
    }
  }

  // Second pass: flatten labels and accumulate component properties
  interface ComponentInfo {
    label: number;
    area: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    saliencySum: number;
  }

  const componentMap = new Map<number, ComponentInfo>();

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const idx = rowOffset + x;
      if (grownMask[idx] === 0) continue;

      const root = find(labels[idx]);
      labels[idx] = root;

      let info = componentMap.get(root);
      if (!info) {
        info = {
          label: root,
          area: 0,
          minX: x,
          maxX: x,
          minY: y,
          maxY: y,
          saliencySum: 0,
        };
        componentMap.set(root, info);
      }

      info.area++;
      info.saliencySum += saliency.data[idx];
      if (x < info.minX) info.minX = x;
      if (x > info.maxX) info.maxX = x;
      if (y < info.minY) info.minY = y;
      if (y > info.maxY) info.maxY = y;
    }
  }

  // 7. Filter and rank candidate subject instances
  const minPixels = Math.floor(pixelCount * minAreaFraction);
  const rankedComponents = Array.from(componentMap.values())
    .filter(c => c.area >= minPixels)
    .sort((a, b) => b.area - a.area)
    .slice(0, maxInstances);

  // If no component met minAreaFraction, keep the single largest component
  if (rankedComponents.length === 0 && componentMap.size > 0) {
    const all = Array.from(componentMap.values()).sort((a, b) => b.area - a.area);
    rankedComponents.push(all[0]);
  }

  const validLabelSet = new Set(rankedComponents.map(c => c.label));

  // 8. Build subject instances
  const instances: SubjectRegion[] = rankedComponents.map((c, index) => {
    const pbb = {
      x: c.minX,
      y: c.minY,
      width: Math.max(1, c.maxX - c.minX + 1),
      height: Math.max(1, c.maxY - c.minY + 1),
    };
    const normBb: BoundingBox = {
      x: pbb.x / width,
      y: pbb.y / height,
      width: pbb.width / width,
      height: pbb.height / height,
    };
    const meanSal = c.saliencySum / c.area;
    const confidence = Math.min(1.0, Math.max(0.1, meanSal * 1.25));
    const label = index === 0 ? 'primary_subject' : index === 1 ? 'secondary_subject' : 'subject';

    return {
      id: `subj_${index + 1}`,
      label,
      boundingBox: normBb,
      pixelBoundingBox: pbb,
      pixelArea: c.area,
      confidence: Number(confidence.toFixed(3)),
    };
  });

  // 9. Synthesize final binary mask and fill internal holes within subject silhouettes
  const finalBinaryMask = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    if (validLabelSet.has(labels[i])) {
      finalBinaryMask[i] = 255;
    }
  }

  // Hole-filling: flood fill from the outer image borders to find all true background pixels.
  // Any pixel not reached from the border and not currently foreground is an internal subject hole.
  const reachableFromBorder = new Uint8Array(pixelCount);
  const queue: number[] = [];

  // Seed with outer perimeter pixels that are 0
  for (let x = 0; x < width; x++) {
    if (finalBinaryMask[x] === 0) {
      reachableFromBorder[x] = 1;
      queue.push(x);
    }
    const bottomIdx = (height - 1) * width + x;
    if (finalBinaryMask[bottomIdx] === 0) {
      reachableFromBorder[bottomIdx] = 1;
      queue.push(bottomIdx);
    }
  }
  for (let y = 1; y < height - 1; y++) {
    const leftIdx = y * width;
    if (finalBinaryMask[leftIdx] === 0) {
      reachableFromBorder[leftIdx] = 1;
      queue.push(leftIdx);
    }
    const rightIdx = y * width + (width - 1);
    if (finalBinaryMask[rightIdx] === 0) {
      reachableFromBorder[rightIdx] = 1;
      queue.push(rightIdx);
    }
  }

  // BFS flood fill
  let head = 0;
  while (head < queue.length) {
    const curr = queue[head++];
    const cx = curr % width;
    const cy = Math.floor(curr / width);

    // Check 4-connected neighbors
    const neighbors = [
      cx > 0 ? curr - 1 : -1,
      cx < width - 1 ? curr + 1 : -1,
      cy > 0 ? curr - width : -1,
      cy < height - 1 ? curr + width : -1,
    ];

    for (const n of neighbors) {
      if (n !== -1 && finalBinaryMask[n] === 0 && reachableFromBorder[n] === 0) {
        reachableFromBorder[n] = 1;
        queue.push(n);
      }
    }
  }

  // Any pixel that is NOT reachable from border is part of the subject (fills internal holes)
  let foregroundPixelCount = 0;
  for (let i = 0; i < pixelCount; i++) {
    if (reachableFromBorder[i] === 0) {
      finalBinaryMask[i] = 255;
      foregroundPixelCount++;
    }
  }

  // 10. Generate continuous soft boundary confidence map [0.0 - 1.0]
  // Interior pixels: confidence = 1.0. Boundary transitions: smooth falloff based on saliency & gradients
  const confidenceMap = new Float32Array(pixelCount);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const idx = rowOffset + x;
      if (finalBinaryMask[idx] === 255) {
        // Check if near boundary
        const isNearEdge =
          x === 0 || x === width - 1 || y === 0 || y === height - 1 ||
          finalBinaryMask[idx - 1] === 0 ||
          finalBinaryMask[idx + 1] === 0 ||
          finalBinaryMask[idx - width] === 0 ||
          finalBinaryMask[idx + width] === 0;

        if (isNearEdge) {
          // Soft transition proportional to local saliency and gradient
          confidenceMap[idx] = Math.min(1.0, Math.max(0.40, saliency.data[idx]));
        } else {
          confidenceMap[idx] = 1.0;
        }
      } else {
        confidenceMap[idx] = 0.0;
      }
    }
  }

  // 11. Aggregate overall bounding box enclosing all instances
  let overallMinX = width;
  let overallMaxX = 0;
  let overallMinY = height;
  let overallMaxY = 0;

  if (instances.length > 0) {
    for (const inst of instances) {
      const p = inst.pixelBoundingBox;
      if (p.x < overallMinX) overallMinX = p.x;
      if (p.y < overallMinY) overallMinY = p.y;
      if (p.x + p.width - 1 > overallMaxX) overallMaxX = p.x + p.width - 1;
      if (p.y + p.height - 1 > overallMaxY) overallMaxY = p.y + p.height - 1;
    }
  } else {
    overallMinX = 0;
    overallMaxX = width - 1;
    overallMinY = 0;
    overallMaxY = height - 1;
  }

  const pixelBoundingBox = {
    x: overallMinX,
    y: overallMinY,
    width: Math.max(1, overallMaxX - overallMinX + 1),
    height: Math.max(1, overallMaxY - overallMinY + 1),
  };

  const boundingBox: BoundingBox = {
    x: pixelBoundingBox.x / width,
    y: pixelBoundingBox.y / height,
    width: pixelBoundingBox.width / width,
    height: pixelBoundingBox.height / height,
  };

  const coverage = Number((foregroundPixelCount / pixelCount).toFixed(4));
  const globalConfidence = instances.length > 0
    ? Number((instances.reduce((acc, inst) => acc + inst.confidence, 0) / instances.length).toFixed(3))
    : 0.50;

  const latencyMs = Number((performance.now() - startTime).toFixed(1));

  const mask: SubjectMask = {
    width,
    height,
    data: finalBinaryMask,
    confidenceMap,
  };

  return {
    mask,
    boundingBox,
    pixelBoundingBox,
    instances,
    confidence: globalConfidence,
    coverage,
    scale: image.scale,
    originalDimensions: image.originalDimensions,
    processingDimensions: image.processingDimensions,
    metrics: {
      latencyMs,
      algorithm: 'Perceptual-Saliency-Gradient-Watershed-v1',
    },
  };
}
