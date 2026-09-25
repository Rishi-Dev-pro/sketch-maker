/**
 * Procedural Multi-Scale Shading & Graphite Mark Generator (TASK-111 / TASK-113)
 *
 * Transforms continuous 2D TonalFields and discrete TonalRegions into an authentic
 * procedural graphite pencil value structure:
 * - Scale A: Broad form & mass marks (hair mass, clothing mass, large planes)
 * - Scale B: Medium form strokes (cheek planes, mandibular shelf, temples, forehead)
 * - Scale C: Fine anatomical hatching (eye sockets, nasal sidewalls, lips, chin)
 * - Scale D: Micro accents & crevice cross-hatching (deep crevices, under-nose, socket hollows)
 *
 * CRITICAL INVARIANTS:
 * 1. NEVER use Math.random(). 100% deterministic seeded sinusoidal hashing.
 * 2. Form-following directions: marks align with 3D facial plane geometry, not screen-space raster.
 * 3. Graphite accumulation: multiple soft strokes layer to create deep value rather than single harsh wires.
 * 4. Paper preservation: highlights remain pristine paper white (zero marks where density ≈ 0).
 */

import {
  Point2D,
  ContourPath,
  TonalRegion,
  TonalField,
  GraphiteMarkScale,
} from '@sketch-maker/shared-types';

/**
 * Deterministic pseudo-random number generator in [0.0, 1.0] derived from a seed.
 */
export function seededUnit(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453123;
  return x - Math.floor(x);
}

/**
 * Clamps coordinate to [0.0, 1.0].
 */
function clamp(val: number): number {
  return Math.max(0.0, Math.min(1.0, Number(val.toFixed(5))));
}

export interface ShadingGenerationOptions {
  /** Maximum number of total shading strokes allowed across all regions (default: 320) */
  readonly maxStrokes?: number;
  /** Global stroke density multiplier (default: 1.0) */
  readonly densityMultiplier?: number;
  /** Whether to synthesize broad volumetric hair mass strokes (default: true) */
  readonly includeHairMass?: boolean;
  /** Whether to synthesize clothing mass strokes (default: true) */
  readonly includeClothingMass?: boolean;
}

/**
 * Returns anatomical form-following orientation (in radians) and curvature for a given semantic zone.
 */
export function getAnatomicalOrientation(semantic: string): {
  angle: number;
  bow: number;
  scale: GraphiteMarkScale;
} {
  switch (semantic) {
    case 'cheek_plane':
    case 'left_malar':
      // 60 degrees down-right along left zygomatic arch curving toward mouth
      return { angle: Math.PI * 0.33, bow: 0.08, scale: 'medium' };

    case 'right_malar':
      // 120 degrees down-left along right zygomatic arch
      return { angle: Math.PI * 0.67, bow: -0.08, scale: 'medium' };

    case 'jaw_shadow':
      // 30 degrees following mandibular bone shelf
      return { angle: Math.PI * 0.18, bow: 0.04, scale: 'medium' };

    case 'eye_socket':
      // Downward orbital concentric arc
      return { angle: Math.PI * 0.45, bow: 0.12, scale: 'fine' };

    case 'nose_shadow':
      // 80 degrees steep downward sidewall slope
      return { angle: Math.PI * 0.44, bow: 0.02, scale: 'fine' };

    case 'under_nose':
      // Horizontal shelf beneath nose columella
      return { angle: 0.0, bow: 0.02, scale: 'fine' };

    case 'under_lip':
    case 'lower_lip':
      // Soft horizontal / bowed smile curve modeling lower lip fullness
      return { angle: Math.PI * 0.02, bow: 0.06, scale: 'fine' };

    case 'mouth_shadow':
      // Horizontal stomion depression
      return { angle: 0.0, bow: 0.0, scale: 'micro' };

    case 'forehead_plane':
      // Subtle horizontal / gentle brow curve
      return { angle: Math.PI * 0.04, bow: 0.03, scale: 'medium' };

    case 'temple_plane':
      // 45 degrees temple hollow
      return { angle: Math.PI * 0.25, bow: 0.05, scale: 'medium' };

    case 'neck_shadow':
      // 70 degrees diagonal following sternocleidomastoid muscle
      return { angle: Math.PI * 0.38, bow: 0.05, scale: 'broad' };

    case 'hair_mass':
      // Sweeping downward flow
      return { angle: Math.PI * 0.42, bow: 0.10, scale: 'broad' };

    case 'clothing_mass':
      // Soft diagonal fold flow across torso/shoulders
      return { angle: Math.PI * 0.20, bow: 0.04, scale: 'broad' };

    default:
      return { angle: Math.PI * 0.28, bow: 0.04, scale: 'medium' };
  }
}

/**
 * Generates procedural graphite marks for a continuous 2D spatial TonalField (TASK-113).
 */
export function generateFieldShadingStrokes(
  field: TonalField,
  fieldIndex: number,
  options?: ShadingGenerationOptions
): ContourPath[] {
  const strokes: ContourPath[] = [];
  const { bounds, semanticAssociation, density, width: gridW, height: gridH, mean } = field;

  // Highlights remain pure paper white: zero strokes
  if (field.classification === 'highlight' || mean >= 0.85) {
    return strokes;
  }

  // Calculate average graphite density across field
  let avgDensity = 0;
  for (let i = 0; i < density.length; i++) {
    avgDensity += density[i];
  }
  avgDensity = density.length > 0 ? avgDensity / density.length : 0;

  if (avgDensity < 0.04) {
    return strokes; // Preserves paper white highlights
  }

  const densityMultiplier = options?.densityMultiplier ?? 1.0;
  const { angle, bow, scale } = getAnatomicalOrientation(semanticAssociation);

  const bW = bounds.width;
  const bH = bounds.height;
  const span = Math.max(bW, bH);

  // Determine stroke count, length, and density based on scale & density
  let strokeCount = 0;
  let strokeLen = span * 0.65;
  let allowCrossHatch = false;

  if (semanticAssociation === 'hair_mass') {
    if (options?.includeHairMass === false) return strokes;
    strokeCount = Math.round((20 + avgDensity * 24) * densityMultiplier);
    strokeLen = span * 0.75;
  } else if (semanticAssociation === 'clothing_mass') {
    if (options?.includeClothingMass === false) return strokes;
    strokeCount = Math.round((16 + avgDensity * 22) * densityMultiplier);
    strokeLen = span * 0.80;
  } else if (scale === 'broad') {
    strokeCount = Math.round((10 + avgDensity * 16) * densityMultiplier);
    strokeLen = span * 0.60;
  } else if (scale === 'medium') {
    strokeCount = Math.round((8 + avgDensity * 14) * densityMultiplier);
    strokeLen = span * 0.50;
  } else {
    // Fine / micro
    strokeCount = Math.round((6 + avgDensity * 12) * densityMultiplier);
    strokeLen = span * 0.40;
    allowCrossHatch = [
      'eye_socket',
      'under_nose',
      'under_lip',
      'jaw_shadow',
      'mouth_shadow',
    ].includes(semanticAssociation) && avgDensity > 0.45;
  }

  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const perpX = -sinA;
  const perpY = cosA;

  // Synthesize directional form-following pencil strokes
  for (let i = 0; i < strokeCount; i++) {
    const t = (i + 0.5) / strokeCount;
    const seed = fieldIndex * 100 + i * 7.31;

    // Sample local graphite density at this stroke position
    const sampleGX = Math.max(0, Math.min(gridW - 1, Math.floor(t * gridW)));
    const sampleGY = Math.max(0, Math.min(gridH - 1, Math.floor(0.5 * gridH)));
    const localD = density[sampleGY * gridW + sampleGX];

    // Skip individual strokes if local density is near highlight
    if (localD < 0.06 && scale !== 'broad') {
      continue;
    }

    const jitterOffset = (seededUnit(seed) - 0.5) * 0.12;
    const jitterLen = 0.85 + seededUnit(seed + 1.7) * 0.30;
    const effLen = strokeLen * jitterLen;

    // Anchor point across transverse axis of region
    const cx = bounds.x + bW * 0.5 + perpX * (t - 0.5 + jitterOffset) * bW * 1.1;
    const cy = bounds.y + bH * 0.5 + perpY * (t - 0.5 + jitterOffset) * bH * 1.1;

    const startX = clamp(cx - cosA * effLen * 0.5);
    const startY = clamp(cy - sinA * effLen * 0.5);
    const endX = clamp(cx + cosA * effLen * 0.5);
    const endY = clamp(cy + sinA * effLen * 0.5);

    // 3-point curved stroke incorporating anatomical surface bowing
    const midX = clamp((startX + endX) * 0.5 + perpX * bow * effLen);
    const midY = clamp((startY + endY) * 0.5 + perpY * bow * effLen);

    strokes.push({
      id: `${field.id}_hatch_${scale}_${i}`,
      region: semanticAssociation === 'hair_mass' ? 'hair' : (semanticAssociation === 'clothing_mass' ? 'clothing' : 'texture'),
      points: [
        { x: startX, y: startY },
        { x: midX, y: midY },
        { x: endX, y: endY },
      ],
      closed: false,
      confidence: Math.max(0.70, 0.95 - (1.0 - avgDensity) * 0.2),
      visibility: 'visible',
    });
  }

  // Selective Cross-Hatching (strictly in deep crevices)
  if (allowCrossHatch) {
    const crossAngle = angle + Math.PI * 0.45;
    const crossCos = Math.cos(crossAngle);
    const crossSin = Math.sin(crossAngle);
    const crossCount = Math.max(2, Math.floor(strokeCount * 0.50));

    for (let j = 0; j < crossCount; j++) {
      const t = (j + 0.5) / crossCount;
      const seed = fieldIndex * 200 + j * 9.17;
      const jitter = (seededUnit(seed) - 0.5) * 0.08;
      const effLen = strokeLen * 0.70;

      const cx = bounds.x + bW * 0.5 + (-crossSin) * (t - 0.5 + jitter) * bW * 0.9;
      const cy = bounds.y + bH * 0.5 + crossCos * (t - 0.5 + jitter) * bH * 0.9;

      strokes.push({
        id: `${field.id}_cross_hatch_${j}`,
        region: 'texture',
        points: [
          { x: clamp(cx - crossCos * effLen * 0.5), y: clamp(cy - crossSin * effLen * 0.5) },
          { x: clamp(cx + crossCos * effLen * 0.5), y: clamp(cy + crossSin * effLen * 0.5) },
        ],
        closed: false,
        confidence: 0.85,
        visibility: 'visible',
      });
    }
  }

  return strokes;
}

/**
 * Generates procedural pencil shading strokes for an individual TonalRegion (backwards compatibility).
 */
export function generateRegionShadingStrokes(
  region: TonalRegion,
  regionIndex: number,
  options?: ShadingGenerationOptions
): ContourPath[] {
  const strokes: ContourPath[] = [];

  if (region.classification === 'highlight') {
    return strokes;
  }

  const { bounds, classification, intensity, semanticAssociation } = region;
  const densityMultiplier = options?.densityMultiplier ?? 1.0;

  const width = bounds.width;
  const height = bounds.height;
  const span = Math.max(width, height);
  const isLargePlane = span > 0.08;
  const areaBonus = isLargePlane ? Math.min(4, Math.round(span * 20)) : 0;

  let primaryCount = 0;
  let allowCrossHatch = false;

  switch (classification) {
    case 'deep_shadow':
      primaryCount = Math.round((8 + areaBonus) * densityMultiplier);
      allowCrossHatch = [
        'eye_socket',
        'under_nose',
        'under_lip',
        'jaw_shadow',
        'neck_shadow',
        'mouth_shadow',
      ].includes(semanticAssociation ?? '');
      break;
    case 'shadow':
      primaryCount = Math.round((6 + areaBonus) * densityMultiplier);
      allowCrossHatch = [
        'eye_socket',
        'under_nose',
        'under_lip',
        'jaw_shadow',
        'neck_shadow',
      ].includes(semanticAssociation ?? '') && intensity < 0.55;
      break;
    case 'midtone':
      primaryCount = Math.round((4 + Math.floor(areaBonus * 0.6)) * densityMultiplier);
      break;
    case 'light':
      primaryCount = isLargePlane ? Math.round(3 * densityMultiplier) : 0;
      break;
  }

  if (primaryCount <= 0) {
    return strokes;
  }

  const { angle, bow } = getAnatomicalOrientation(semanticAssociation ?? 'cheek_plane');
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const perpX = -sinA;
  const perpY = cosA;
  const strokeLen = span * 0.70;

  for (let i = 0; i < primaryCount; i++) {
    const t = (i + 0.5) / primaryCount;
    const seed = regionIndex * 50 + i * 3.7;
    const jitter = (seededUnit(seed) - 0.5) * 0.08;

    const cx = bounds.x + width * 0.5 + perpX * (t - 0.5 + jitter) * width * 1.1;
    const cy = bounds.y + height * 0.5 + perpY * (t - 0.5 + jitter) * height * 1.1;

    const startX = clamp(cx - cosA * strokeLen * 0.5);
    const startY = clamp(cy - sinA * strokeLen * 0.5);
    const endX = clamp(cx + cosA * strokeLen * 0.5);
    const endY = clamp(cy + sinA * strokeLen * 0.5);

    const midX = clamp((startX + endX) * 0.5 + perpX * bow * strokeLen);
    const midY = clamp((startY + endY) * 0.5 + perpY * bow * strokeLen);

    strokes.push({
      id: `${region.id}_form_hatch_${i}`,
      region: 'texture',
      points: [
        { x: startX, y: startY },
        { x: midX, y: midY },
        { x: endX, y: endY },
      ],
      closed: false,
      confidence: Math.max(0.70, region.confidence * 0.9),
      visibility: 'visible',
    });
  }

  if (allowCrossHatch) {
    const crossAngle = angle + Math.PI * 0.45;
    const crossCos = Math.cos(crossAngle);
    const crossSin = Math.sin(crossAngle);
    const crossCount = Math.max(2, Math.floor(primaryCount * 0.50));

    for (let j = 0; j < crossCount; j++) {
      const t = (j + 0.5) / crossCount;
      const seed = regionIndex * 200 + j * 9.17;
      const jitter = (seededUnit(seed) - 0.5) * 0.06;

      const cx = bounds.x + width * 0.5 + (-crossSin) * (t - 0.5 + jitter) * width * 0.9;
      const cy = bounds.y + height * 0.5 + crossCos * (t - 0.5 + jitter) * height * 0.9;

      strokes.push({
        id: `${region.id}_cross_hatch_${j}`,
        region: 'texture',
        points: [
          { x: clamp(cx - crossCos * strokeLen * 0.35), y: clamp(cy - crossSin * strokeLen * 0.35) },
          { x: clamp(cx + crossCos * strokeLen * 0.35), y: clamp(cy + crossSin * strokeLen * 0.35) },
        ],
        closed: false,
        confidence: Math.max(0.65, region.confidence * 0.75),
        visibility: 'visible',
      });
    }
  }

  return strokes;
}

/**
 * Generates procedural shading strokes for all tonal regions or tonal fields belonging to a subject.
 * Accepts either:
 * - (tonalRegions, options)
 * - (tonalRegions, tonalFields, options)
 * - (subject, tonalRegions, options)
 */
export function generateSubjectShadingStrokes(
  arg1: readonly TonalRegion[] | readonly TonalField[] | any,
  arg2?: readonly TonalRegion[] | readonly TonalField[] | ShadingGenerationOptions,
  arg3?: ShadingGenerationOptions
): ContourPath[] {
  let tonalRegions: readonly TonalRegion[] = [];
  let tonalFields: readonly TonalField[] = [];
  let options: ShadingGenerationOptions | undefined;

  if (Array.isArray(arg1)) {
    if (arg1.length > 0 && 'values' in arg1[0]) {
      tonalFields = arg1 as readonly TonalField[];
      if (typeof arg2 === 'object' && !Array.isArray(arg2)) {
        options = arg2 as ShadingGenerationOptions;
      }
    } else {
      tonalRegions = arg1 as readonly TonalRegion[];
      if (Array.isArray(arg2) && arg2.length > 0 && 'values' in arg2[0]) {
        tonalFields = arg2 as readonly TonalField[];
        options = arg3;
      } else if (typeof arg2 === 'object' && !Array.isArray(arg2)) {
        options = arg2 as ShadingGenerationOptions;
      }
    }
  } else if (Array.isArray(arg2)) {
    // Called as (subject, tonalRegions) or (subject, tonalFields)
    if (arg2.length > 0 && 'values' in arg2[0]) {
      tonalFields = arg2 as readonly TonalField[];
    } else {
      tonalRegions = arg2 as readonly TonalRegion[];
    }
    if (typeof arg3 === 'object') {
      options = arg3;
    }
  } else if (arg1 && arg1.reconstruction) {
    tonalRegions = arg1.reconstruction.tonalRegions ?? [];
    tonalFields = arg1.reconstruction.tonalFields ?? [];
    options = arg2 as ShadingGenerationOptions | undefined;
  }

  const maxStrokes = options?.maxStrokes ?? 360;
  const allStrokes: ContourPath[] = [];

  // 1. If high-resolution continuous TonalFields are present, prioritize them
  if (tonalFields.length > 0) {
    for (let fIdx = 0; fIdx < tonalFields.length; fIdx++) {
      const field = tonalFields[fIdx];
      const fieldStrokes = generateFieldShadingStrokes(field, fIdx, options);
      for (const stroke of fieldStrokes) {
        allStrokes.push(stroke);
        if (allStrokes.length >= maxStrokes) {
          return allStrokes;
        }
      }
    }
  } else if (tonalRegions.length > 0) {
    // Fallback to discrete tonal regions
    for (let idx = 0; idx < tonalRegions.length; idx++) {
      const region = tonalRegions[idx];
      const regionStrokes = generateRegionShadingStrokes(region, idx, options);
      for (const stroke of regionStrokes) {
        allStrokes.push(stroke);
        if (allStrokes.length >= maxStrokes) {
          return allStrokes;
        }
      }
    }
  }

  return allStrokes;
}
