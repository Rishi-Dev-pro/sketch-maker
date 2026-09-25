/**
 * Clean Segmentation & Artifact Removal Engine (TASK-114)
 *
 * Implements the deterministic segmentation cleanup pipeline:
 * Raw semantic mask
 *   ↓
 * confidence threshold & foreground classification
 *   ↓
 * connected component analysis (two-pass union-find)
 *   ↓
 * subject component selection (face/pose anchored)
 *   ↓
 * small artifact removal (deterministic area & distance ratio)
 *   ↓
 * morphological cleanup (hole filling & whisker suppression)
 *   ↓
 * Clean Authoritative Subject Mask
 */

import { Point2D, BoundingBox } from '@sketch-maker/shared-types';

export interface ComponentStats {
  readonly id: number;
  readonly area: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly centerX: number;
  readonly centerY: number;
}

export interface CleanSegmentationOptions {
  /** Minimum area fraction relative to primary component to retain (default: 0.02) */
  readonly minAreaFraction?: number;
  /** Minimum absolute pixel count for a component (default: 80) */
  readonly minAbsolutePixels?: number;
  /** Morphological closing radius in pixels (default: 2) */
  readonly closingRadius?: number;
  /** Morphological opening radius in pixels (default: 1) */
  readonly openingRadius?: number;
  /** Max distance fraction from face/pose to retain disconnected component (default: 0.45) */
  readonly maxDisconnectedDistanceFraction?: number;
}

/**
 * Union-Find data structure for connected component labeling.
 */
class UnionFind {
  private parent: Int32Array;

  constructor(size: number) {
    this.parent = new Int32Array(size);
    for (let i = 0; i < size; i++) {
      this.parent[i] = i;
    }
  }

  find(i: number): number {
    let root = i;
    while (root !== this.parent[root]) {
      root = this.parent[root];
    }
    let curr = i;
    while (curr !== root) {
      const next = this.parent[curr];
      this.parent[curr] = root;
      curr = next;
    }
    return root;
  }

  union(i: number, j: number): void {
    const rootI = this.find(i);
    const rootJ = this.find(j);
    if (rootI !== rootJ) {
      if (rootI < rootJ) {
        this.parent[rootJ] = rootI;
      } else {
        this.parent[rootI] = rootJ;
      }
    }
  }
}

/**
 * Performs connected component labeling on a binary mask.
 */
export function labelConnectedComponents(
  binaryMask: Uint8Array,
  width: number,
  height: number
): { labels: Int32Array; components: ComponentStats[] } {
  const pixelCount = width * height;
  const labels = new Int32Array(pixelCount);
  const uf = new UnionFind(pixelCount + 1);
  let nextLabel = 1;

  // Pass 1: Label and record equivalences
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const idx = rowOffset + x;
      if (binaryMask[idx] === 0) continue;

      const west = x > 0 && binaryMask[idx - 1] > 0 ? labels[idx - 1] : 0;
      const north = y > 0 && binaryMask[idx - width] > 0 ? labels[idx - width] : 0;
      const northWest = x > 0 && y > 0 && binaryMask[idx - width - 1] > 0 ? labels[idx - width - 1] : 0;
      const northEast = x < width - 1 && y > 0 && binaryMask[idx - width + 1] > 0 ? labels[idx - width + 1] : 0;

      const neighborLabels = [west, north, northWest, northEast].filter(l => l > 0);

      if (neighborLabels.length === 0) {
        labels[idx] = nextLabel++;
      } else {
        const minL = Math.min(...neighborLabels);
        labels[idx] = minL;
        for (const l of neighborLabels) {
          if (l !== minL) {
            uf.union(minL, l);
          }
        }
      }
    }
  }

  // Pass 2: Resolve canonical labels and accumulate stats
  const rootMap = new Map<number, number>();
  let canonicalCount = 1;
  const statsMap = new Map<number, {
    area: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    sumX: number;
    sumY: number;
  }>();

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const idx = rowOffset + x;
      const rawL = labels[idx];
      if (rawL === 0) continue;

      const root = uf.find(rawL);
      let canonical = rootMap.get(root);
      if (canonical === undefined) {
        canonical = canonicalCount++;
        rootMap.set(root, canonical);
        statsMap.set(canonical, {
          area: 0,
          minX: x,
          maxX: x,
          minY: y,
          maxY: y,
          sumX: 0,
          sumY: 0,
        });
      }

      labels[idx] = canonical;
      const s = statsMap.get(canonical)!;
      s.area++;
      s.sumX += x;
      s.sumY += y;
      if (x < s.minX) s.minX = x;
      if (x > s.maxX) s.maxX = x;
      if (y < s.minY) s.minY = y;
      if (y > s.maxY) s.maxY = y;
    }
  }

  const components: ComponentStats[] = [];
  statsMap.forEach((s, id) => {
    components.push({
      id,
      area: s.area,
      minX: s.minX,
      maxX: s.maxX,
      minY: s.minY,
      maxY: s.maxY,
      centerX: s.sumX / s.area,
      centerY: s.sumY / s.area,
    });
  });

  components.sort((a, b) => b.area - a.area);
  return { labels, components };
}

/**
 * Morphological binary dilation with small square kernel.
 */
function binaryDilate(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return mask;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const rMin = Math.max(0, y - radius);
    const rMax = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] === 0) continue;
      const cMin = Math.max(0, x - radius);
      const cMax = Math.min(width - 1, x + radius);
      for (let ny = rMin; ny <= rMax; ny++) {
        const row = ny * width;
        for (let nx = cMin; nx <= cMax; nx++) {
          out[row + nx] = 255;
        }
      }
    }
  }
  return out;
}

/**
 * Morphological binary erosion with small square kernel.
 */
function binaryErode(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return mask;
  const out = new Uint8Array(width * height);
  for (let y = radius; y < height - radius; y++) {
    for (let x = radius; x < width - radius; x++) {
      let keep = true;
      for (let dy = -radius; dy <= radius; dy++) {
        const row = (y + dy) * width;
        for (let dx = -radius; dx <= radius; dx++) {
          if (mask[row + x + dx] === 0) {
            keep = false;
            break;
          }
        }
        if (!keep) break;
      }
      if (keep) {
        out[y * width + x] = 255;
      }
    }
  }
  return out;
}

/**
 * Morphological binary closing (dilation followed by erosion).
 * Fills pinholes, micro-gaps, and smooths boundary staircases.
 */
export function binaryClose(mask: Uint8Array, width: number, height: number, radius = 2): Uint8Array {
  const dilated = binaryDilate(mask, width, height, radius);
  return binaryErode(dilated, width, height, radius);
}

/**
 * Morphological binary opening (erosion followed by dilation).
 * Eliminates single-pixel spikes and disconnected whisker noise.
 */
export function binaryOpen(mask: Uint8Array, width: number, height: number, radius = 1): Uint8Array {
  const eroded = binaryErode(mask, width, height, radius);
  return binaryDilate(eroded, width, height, radius);
}

export interface CleanSegmentationResult {
  readonly cleanMask: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly rawForegroundArea: number;
  readonly cleanForegroundArea: number;
  readonly removedArtifactArea: number;
  readonly componentCount: number;
  readonly retainedComponentCount: number;
  readonly primaryBounds: BoundingBox;
}

/**
 * Cleans a raw segmentation mask by identifying the authoritative primary subject,
 * removing disconnected side artifacts, filling pinholes, and smoothing boundaries.
 */
export function cleanSubjectSegmentation(
  rawMaskData: Uint8Array,
  width: number,
  height: number,
  options?: CleanSegmentationOptions,
  faceBox?: BoundingBox,
  poseAnchor?: Point2D
): CleanSegmentationResult {
  const minAreaFraction = options?.minAreaFraction ?? 0.02;
  const minAbsolutePixels = options?.minAbsolutePixels ?? 80;
  const closingRadius = options?.closingRadius ?? 2;
  const openingRadius = options?.openingRadius ?? 1;
  const maxDisconnDist = options?.maxDisconnectedDistanceFraction ?? 0.45;

  const totalPixels = width * height;
  let rawForegroundArea = 0;
  const binaryInput = new Uint8Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    if (rawMaskData[i] > 0) {
      binaryInput[i] = 255;
      rawForegroundArea++;
    }
  }

  if (rawForegroundArea === 0) {
    return {
      cleanMask: new Uint8Array(totalPixels),
      width,
      height,
      rawForegroundArea: 0,
      cleanForegroundArea: 0,
      removedArtifactArea: 0,
      componentCount: 0,
      retainedComponentCount: 0,
      primaryBounds: { x: 0, y: 0, width: 0, height: 0 },
    };
  }

  // 1. Connected component analysis
  const { labels, components } = labelConnectedComponents(binaryInput, width, height);

  if (components.length === 0) {
    return {
      cleanMask: new Uint8Array(totalPixels),
      width,
      height,
      rawForegroundArea: 0,
      cleanForegroundArea: 0,
      removedArtifactArea: 0,
      componentCount: 0,
      retainedComponentCount: 0,
      primaryBounds: { x: 0, y: 0, width: 0, height: 0 },
    };
  }

  // 2. Select primary component anchored by face or pose
  let primaryComp = components[0];
  if (faceBox) {
    const faceTargetX = (faceBox.x + faceBox.width * 0.5) * width;
    const faceTargetY = (faceBox.y + faceBox.height * 0.5) * height;

    let bestScore = -Infinity;
    for (const comp of components) {
      const dx = (comp.centerX - faceTargetX) / width;
      const dy = (comp.centerY - faceTargetY) / height;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const areaRatio = comp.area / components[0].area;
      // High score: large component close to face
      const score = areaRatio * 0.7 - dist * 0.3;
      if (score > bestScore) {
        bestScore = score;
        primaryComp = comp;
      }
    }
  } else if (poseAnchor) {
    const poseTargetX = poseAnchor.x * width;
    const poseTargetY = poseAnchor.y * height;
    let bestDist = Infinity;
    for (const comp of components) {
      const dx = (comp.centerX - poseTargetX) / width;
      const dy = (comp.centerY - poseTargetY) / height;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDist) {
        bestDist = dist;
        primaryComp = comp;
      }
    }
  }

  // 3. Filter components based on area ratio and distance from primary subject
  const retainedLabels = new Set<number>();
  retainedLabels.add(primaryComp.id);

  const primaryArea = primaryComp.area;
  const pCx = primaryComp.centerX / width;
  const pCy = primaryComp.centerY / height;

  for (const comp of components) {
    if (comp.id === primaryComp.id) continue;

    // Reject tiny micro-components below absolute threshold
    if (comp.area < minAbsolutePixels) continue;

    // Component area relative to primary
    const areaRatio = comp.area / primaryArea;
    if (areaRatio < minAreaFraction) continue;

    // Distance from primary centroid
    const cCx = comp.centerX / width;
    const cCy = comp.centerY / height;
    const dist = Math.hypot(cCx - pCx, cCy - pCy);

    // Retain only if reasonably close to the primary subject (e.g. torso continuation or arm)
    if (dist <= maxDisconnDist) {
      retainedLabels.add(comp.id);
    }
  }

  // 4. Generate filtered binary mask
  const filteredMask = new Uint8Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    if (retainedLabels.has(labels[i])) {
      filteredMask[i] = 255;
    }
  }

  // 5. Morphological cleanup: closing to fill pinholes, opening to remove whisker spikes
  const closed = binaryClose(filteredMask, width, height, closingRadius);
  const cleanMask = binaryOpen(closed, width, height, openingRadius);

  // Accumulate metrics
  let cleanForegroundArea = 0;
  let minX = width;
  let maxX = 0;
  let minY = height;
  let maxY = 0;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      if (cleanMask[rowOffset + x] > 0) {
        cleanForegroundArea++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const primaryBounds: BoundingBox = cleanForegroundArea > 0 ? {
    x: Number((minX / width).toFixed(5)),
    y: Number((minY / height).toFixed(5)),
    width: Number(((maxX - minX + 1) / width).toFixed(5)),
    height: Number(((maxY - minY + 1) / height).toFixed(5)),
  } : { x: 0, y: 0, width: 0, height: 0 };

  return {
    cleanMask,
    width,
    height,
    rawForegroundArea,
    cleanForegroundArea,
    removedArtifactArea: Math.max(0, rawForegroundArea - cleanForegroundArea),
    componentCount: components.length,
    retainedComponentCount: retainedLabels.size,
    primaryBounds,
  };
}
