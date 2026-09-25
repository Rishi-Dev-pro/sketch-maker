import { StylePresetDefinition } from '@sketch-maker/shared-types';

/**
 * Realistic Pencil Preset (High-Fidelity Graphite)
 *
 * Emulates authentic graphite pencil strokes (2B–4B) layered on textured paper:
 * - Pure white or neutral paper canvas
 * - Deep graphite carbon stroke tone (#222224)
 * - Fine baseline width (1.1) simulating a sharpened graphite pencil lead
 * - Soft layered opacities for hatching, cross-hatching, and hair strands
 * - Crisp, confident accents for anatomical anchors (eyes, vermilion border, alar base)
 * - Multiply blend mode for natural pencil layering
 */
export const REALISTIC_PENCIL_PRESET: StylePresetDefinition = {
  id: 'realistic_pencil',
  name: 'Realistic Pencil',
  description: 'Authentic graphite portrait sketch with delicate hatching, hair strands, and anatomical line weight modulation.',
  background: {
    type: 'solid',
    color: '#ffffff'
  },
  defaultColor: '#222224',
  defaultOpacity: 0.85,
  baseLineWidth: 1.1,
  lineCap: 'round',
  lineJoin: 'round',
  blendMode: 'multiply',
  importanceScaling: 0.22,
  confidenceScaling: 0.15,
  semanticModifiers: {
    eye: {
      widthMultiplier: 1.30,
      opacityMultiplier: 1.15
    },
    eyebrow: {
      widthMultiplier: 0.90,
      opacityMultiplier: 0.90
    },
    nose: {
      widthMultiplier: 0.82,
      opacityMultiplier: 0.80
    },
    mouth: {
      widthMultiplier: 1.05,
      opacityMultiplier: 0.95
    },
    silhouette: {
      widthMultiplier: 1.05,
      opacityMultiplier: 0.88
    },
    facial_contour: {
      widthMultiplier: 0.95,
      opacityMultiplier: 0.85
    },
    hair: {
      widthMultiplier: 0.90,
      opacityMultiplier: 0.82
    },
    hair_strand: {
      widthMultiplier: 0.80,
      opacityMultiplier: 0.75
    },
    contour: {
      widthMultiplier: 0.85,
      opacityMultiplier: 0.80
    },
    hatching: {
      widthMultiplier: 0.75,
      opacityMultiplier: 0.65
    },
    cross_hatching: {
      widthMultiplier: 0.80,
      opacityMultiplier: 0.72
    },
    tonal_stroke: {
      widthMultiplier: 0.75,
      opacityMultiplier: 0.65
    },
    shadow_stroke: {
      widthMultiplier: 0.85,
      opacityMultiplier: 0.75
    },
    highlight_accent: {
      widthMultiplier: 0.50,
      opacityMultiplier: 0.40
    },
    clothing_boundary: {
      widthMultiplier: 0.90,
      opacityMultiplier: 0.78
    },
    detail: {
      widthMultiplier: 0.70,
      opacityMultiplier: 0.68
    },
    texture: {
      widthMultiplier: 0.70,
      opacityMultiplier: 0.62
    },
    background: {
      widthMultiplier: 0.50,
      opacityMultiplier: 0.40
    }
  }
};
