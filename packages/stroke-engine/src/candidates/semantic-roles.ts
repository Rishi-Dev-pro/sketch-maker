import { VectorPath, StrokeSemanticRole } from './types';

/**
 * Derives a fine-grained, artistic/anatomical semantic role for a given vector path.
 */
export function deriveSemanticRole(path: VectorPath): StrokeSemanticRole {
  const { source, region, level, id } = path;

  // Background check
  if (region === 'background' || id.includes('background')) {
    return 'background';
  }

  // Tonal & Hatching checks
  if (id.includes('cross')) {
    return 'cross_hatching';
  }
  if (id.includes('hatch')) {
    return 'hatching';
  }
  if (source === 'tonal_shading') {
    return 'tonal_stroke';
  }

  // Hair strands & flow
  if (source === 'hair_strand' || id.includes('hair_strand')) {
    return 'hair_strand';
  }
  if (source === 'hair_flow' || id.includes('hair_flow') || source === 'hair_mass' || id.includes('hair_mass')) {
    return 'hair';
  }

  // Skeletal pose connections
  if (source === 'pose_connection' || source === 'pose_landmark') {
    return 'body_structure';
  }

  // Silhouette check
  if (source === 'silhouette') {
    return 'silhouette';
  }

  if (source === 'semantic_boundary') {
    return 'semantic_boundary';
  }

  // Facial features
  switch (region) {
    case 'eyes':
      return 'eye';
    case 'eyebrows':
      return 'eyebrow';
    case 'nose':
      return 'nose';
    case 'mouth':
      return 'mouth';
    case 'ears':
      return 'ear';
    case 'jawline':
      return 'facial_contour';
    case 'hair':
    case 'hair_boundary':
      return 'hair';
    case 'clothing':
      return 'clothing_boundary';
    case 'shoulders':
    case 'body_outline':
      return 'body_structure';
    case 'texture':
      return 'tonal_stroke';
  }

  if (region === 'face_contour') {
    return level === 0 ? 'silhouette' : 'facial_contour';
  }

  // Fine details
  if (level === 4) {
    return 'detail';
  }

  return 'contour';
}
