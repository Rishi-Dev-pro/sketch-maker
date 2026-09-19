import {
  StrokeCandidate,
  CompositionPhase
} from './types';

export interface PhaseInfo {
  readonly phase: CompositionPhase;
  readonly phaseIndex: number;
  readonly phaseName: string;
  readonly description: string;
}

export const COMPOSITION_PHASES: Record<CompositionPhase, { index: number; name: string; description: string }> = {
  foundation: {
    index: 0,
    name: 'Foundation & Silhouette',
    description: 'Overall subject boundary, outer silhouette, and global framing gesture.'
  },
  primary_structure: {
    index: 1,
    name: 'Primary Structure',
    description: 'Core anatomical architecture, facial contour/jawline, and body skeletal connections.'
  },
  expressive_features: {
    index: 2,
    name: 'Expressive Features',
    description: 'Focal facial landmarks defining identity and expression: eyes, eyebrows, nose, mouth.'
  },
  secondary_anatomy: {
    index: 3,
    name: 'Secondary Anatomy',
    description: 'Supporting structures: external ears, hair volume/hairline, and clothing boundaries.'
  },
  refinement: {
    index: 4,
    name: 'Refinement Details',
    description: 'Fine anatomical accents, inner eyelid margins, nostril borders, and seam creases.'
  },
  texture_accent: {
    index: 5,
    name: 'Texture & Context Accents',
    description: 'Surface texture, hair strands, shading hatching, and background context.'
  }
};

/**
 * Deterministically categorizes a StrokeCandidate into one of the six progressive composition phases.
 */
export function assignCompositionPhase(candidate: StrokeCandidate): PhaseInfo {
  const { semanticRole, hierarchyLevel, isBackground } = candidate;

  // Background is always placed in the final phase
  if (isBackground || semanticRole === 'background') {
    const meta = COMPOSITION_PHASES.texture_accent;
    return { phase: 'texture_accent', phaseIndex: meta.index, phaseName: meta.name, description: meta.description };
  }

  // Texture roles
  if (semanticRole === 'texture') {
    const meta = COMPOSITION_PHASES.texture_accent;
    return { phase: 'texture_accent', phaseIndex: meta.index, phaseName: meta.name, description: meta.description };
  }

  // Phase 0: Foundation / Silhouette
  if (semanticRole === 'silhouette' || hierarchyLevel === 0) {
    const meta = COMPOSITION_PHASES.foundation;
    return { phase: 'foundation', phaseIndex: meta.index, phaseName: meta.name, description: meta.description };
  }

  // Phase 1: Primary Structure (Jawline / Facial contour, Body skeleton)
  if (semanticRole === 'facial_contour' || semanticRole === 'body_structure' || (hierarchyLevel === 1 && semanticRole !== 'hair')) {
    const meta = COMPOSITION_PHASES.primary_structure;
    return { phase: 'primary_structure', phaseIndex: meta.index, phaseName: meta.name, description: meta.description };
  }

  // Phase 2: Expressive Features (Eyes, Eyebrows, Nose, Mouth)
  if (
    semanticRole === 'eye' ||
    semanticRole === 'eyebrow' ||
    semanticRole === 'nose' ||
    semanticRole === 'mouth'
  ) {
    const meta = COMPOSITION_PHASES.expressive_features;
    return { phase: 'expressive_features', phaseIndex: meta.index, phaseName: meta.name, description: meta.description };
  }

  // Phase 3: Secondary Anatomy (Ears, Hair volume, Clothing boundary, Semantic boundary)
  if (
    semanticRole === 'ear' ||
    semanticRole === 'hair' ||
    semanticRole === 'clothing_boundary' ||
    semanticRole === 'semantic_boundary' ||
    hierarchyLevel === 3
  ) {
    const meta = COMPOSITION_PHASES.secondary_anatomy;
    return { phase: 'secondary_anatomy', phaseIndex: meta.index, phaseName: meta.name, description: meta.description };
  }

  // Phase 4: Refinement / Fine Details
  if (semanticRole === 'detail' || hierarchyLevel === 4) {
    const meta = COMPOSITION_PHASES.refinement;
    return { phase: 'refinement', phaseIndex: meta.index, phaseName: meta.name, description: meta.description };
  }

  // Fallback safe assignment
  const fallback = COMPOSITION_PHASES.refinement;
  return { phase: 'refinement', phaseIndex: fallback.index, phaseName: fallback.name, description: fallback.description };
}
