import {
  StrokeSemanticRole,
  PathHierarchyLevel,
  StrokeGenerationConfig
} from './types';

/**
 * Computes deterministic stroke line weight multiplier based on anatomical role,
 * hierarchy level, detector confidence, and importance.
 */
export function computeStrokeWidth(
  role: StrokeSemanticRole,
  level: PathHierarchyLevel,
  importance: number,
  confidence: number,
  config: StrokeGenerationConfig
): number {
  const baseStructural = config.baseStructuralWidth ?? 2.2;
  const baseDetail = config.baseDetailWidth ?? 1.6;
  const baseTexture = config.baseTextureWidth ?? 0.9;

  let baseWidth = baseDetail;

  switch (role) {
    case 'silhouette':
      baseWidth = baseStructural * 1.1; // 2.42
      break;
    case 'facial_contour':
    case 'body_structure':
      baseWidth = baseStructural * 0.9; // 1.98
      break;
    case 'eye':
    case 'mouth':
      baseWidth = baseDetail * 1.1; // 1.76
      break;
    case 'eyebrow':
    case 'nose':
      baseWidth = baseDetail; // 1.6
      break;
    case 'ear':
    case 'hair':
    case 'clothing_boundary':
    case 'semantic_boundary':
      baseWidth = 1.3;
      break;
    case 'detail':
      baseWidth = level === 4 ? 1.0 : 1.2;
      break;
    case 'texture':
    case 'background':
      baseWidth = baseTexture; // 0.9
      break;
    default:
      baseWidth = 1.2;
  }

  // Hierarchy level modifier
  if (level === 0) {
    baseWidth = Math.max(baseWidth, baseStructural);
  } else if (level === 4) {
    baseWidth = Math.min(baseWidth, 1.1);
  }

  // Modulate slightly by confidence and importance
  const confFactor = 0.8 + 0.2 * Math.max(0, Math.min(1, confidence));
  const impFactor = 0.85 + 0.15 * Math.max(0, Math.min(1, importance));
  const finalWidth = baseWidth * confFactor * impFactor;

  return Math.round(Math.max(0.4, Math.min(4.0, finalWidth)) * 100) / 100;
}

/**
 * Computes detail density allocation score [0.0, 1.0].
 * High density denotes focal regions requiring intricate line distribution.
 */
export function computeStrokeDensity(
  role: StrokeSemanticRole,
  level: PathHierarchyLevel,
  config: StrokeGenerationConfig
): number {
  const scale = config.densityScale ?? 1.0;
  let baseDensity = 0.5;

  switch (role) {
    case 'eye':
    case 'mouth':
    case 'nose':
      baseDensity = 1.0;
      break;
    case 'eyebrow':
    case 'ear':
    case 'facial_contour':
      baseDensity = 0.85;
      break;
    case 'hair':
      baseDensity = 0.80;
      break;
    case 'silhouette':
      baseDensity = 0.75;
      break;
    case 'body_structure':
      baseDensity = 0.70;
      break;
    case 'clothing_boundary':
    case 'semantic_boundary':
      baseDensity = 0.60;
      break;
    case 'detail':
      baseDensity = 0.50;
      break;
    case 'texture':
      baseDensity = 0.40;
      break;
    case 'background':
      baseDensity = 0.20;
      break;
  }

  if (level === 4) {
    baseDensity = Math.min(baseDensity, 0.6);
  }

  const result = Math.max(0.1, Math.min(1.0, baseDensity * scale));
  return Math.round(result * 100) / 100;
}

/**
 * Computes deterministic relative priority score [0.0, 1.0] for future timeline ordering.
 * Ranks essential anatomical facial landmarks above secondary body and background elements.
 */
export function computeStrokePriorityScore(
  importance: number,
  role: StrokeSemanticRole,
  level: PathHierarchyLevel,
  confidence: number,
  length: number
): number {
  let roleWeight = 0.5;

  switch (role) {
    case 'eye':
    case 'eyebrow':
    case 'nose':
    case 'mouth':
      roleWeight = 1.0;
      break;
    case 'silhouette':
    case 'facial_contour':
      roleWeight = 0.85;
      break;
    case 'ear':
    case 'hair':
      roleWeight = 0.72;
      break;
    case 'body_structure':
      roleWeight = 0.65;
      break;
    case 'clothing_boundary':
    case 'semantic_boundary':
      roleWeight = 0.52;
      break;
    case 'detail':
      roleWeight = 0.42;
      break;
    case 'texture':
      roleWeight = 0.30;
      break;
    case 'background':
      roleWeight = 0.10;
      break;
  }

  const lengthFactor = Math.min(1.0, length * 2.0);

  // 40% importance + 30% role + 20% confidence + 10% length factor
  const score =
    0.40 * importance +
    0.30 * roleWeight +
    0.20 * confidence +
    0.10 * lengthFactor;

  return Math.round(Math.max(0.0, Math.min(1.0, score)) * 1000) / 1000;
}
