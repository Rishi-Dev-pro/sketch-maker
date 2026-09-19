import { StylePresetDefinition } from '@sketch-maker/shared-types';

/**
 * Blueprint Preset
 *
 * Technical architectural draft aesthetic:
 * - Deep Prussian blueprint navy background
 * - Crisp technical cyan-white strokes
 * - Precision line weights with subtle structural transparency
 * - Round caps and joins
 * - Zero heavy bloom (clean drafting look)
 */
export const BLUEPRINT_PRESET: StylePresetDefinition = {
  id: 'blueprint',
  name: 'Blueprint',
  description: 'Architectural blueprint draft on deep Prussian navy canvas with technical cyan lines.',
  background: {
    type: 'solid',
    color: '#0b1d3a'
  },
  defaultColor: '#e0f2fe',
  defaultOpacity: 0.90,
  baseLineWidth: 1.3,
  lineCap: 'round',
  lineJoin: 'round',
  blendMode: 'source-over',
  importanceScaling: 0.15,
  confidenceScaling: 0.10,
  semanticModifiers: {
    eye: {
      color: '#38bdf8',
      widthMultiplier: 1.20,
      opacityMultiplier: 1.0
    },
    eyebrow: {
      color: '#38bdf8',
      widthMultiplier: 1.15,
      opacityMultiplier: 1.0
    },
    nose: {
      color: '#38bdf8',
      widthMultiplier: 1.10,
      opacityMultiplier: 1.0
    },
    mouth: {
      color: '#38bdf8',
      widthMultiplier: 1.15,
      opacityMultiplier: 1.0
    },
    silhouette: {
      color: '#bae6fd',
      widthMultiplier: 1.30,
      opacityMultiplier: 1.0
    },
    hair: {
      color: '#7dd3fc',
      widthMultiplier: 0.90,
      opacityMultiplier: 0.85
    },
    clothing_boundary: {
      color: '#7dd3fc',
      widthMultiplier: 1.05,
      opacityMultiplier: 0.90
    },
    detail: {
      color: '#38bdf8',
      widthMultiplier: 0.75,
      opacityMultiplier: 0.70
    },
    texture: {
      color: '#38bdf8',
      widthMultiplier: 0.70,
      opacityMultiplier: 0.65
    },
    background: {
      color: '#1e3a5f',
      widthMultiplier: 0.60,
      opacityMultiplier: 0.40
    }
  }
};
