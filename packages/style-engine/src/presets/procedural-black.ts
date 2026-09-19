import { StylePresetDefinition } from '@sketch-maker/shared-types';

/**
 * Procedural Black Preset (Canonical Reference Style)
 *
 * Designed to showcase raw procedural geometry fidelity with maximum clarity:
 * - Pure white background
 * - Crisp dark charcoal ink strokes
 * - High opacity with subtle anatomical weight modulation
 * - Round caps and joins
 * - Zero glow bloom
 */
export const PROCEDURAL_BLACK_PRESET: StylePresetDefinition = {
  id: 'procedural_black',
  name: 'Procedural Black',
  description: 'High-contrast monochrome sketch on pure white canvas. The canonical debugging and fidelity reference.',
  background: {
    type: 'solid',
    color: '#ffffff'
  },
  defaultColor: '#1a1a1a',
  defaultOpacity: 0.95,
  baseLineWidth: 1.5,
  lineCap: 'round',
  lineJoin: 'round',
  blendMode: 'source-over',
  importanceScaling: 0.15,
  confidenceScaling: 0.10,
  semanticModifiers: {
    eye: {
      widthMultiplier: 1.20,
      opacityMultiplier: 1.05
    },
    eyebrow: {
      widthMultiplier: 1.15,
      opacityMultiplier: 1.0
    },
    nose: {
      widthMultiplier: 1.10,
      opacityMultiplier: 1.0
    },
    mouth: {
      widthMultiplier: 1.15,
      opacityMultiplier: 1.0
    },
    silhouette: {
      widthMultiplier: 1.25,
      opacityMultiplier: 1.0
    },
    hair: {
      widthMultiplier: 0.90,
      opacityMultiplier: 0.88
    },
    clothing_boundary: {
      widthMultiplier: 1.05,
      opacityMultiplier: 0.92
    },
    detail: {
      widthMultiplier: 0.80,
      opacityMultiplier: 0.75
    },
    texture: {
      widthMultiplier: 0.75,
      opacityMultiplier: 0.70
    },
    background: {
      widthMultiplier: 0.65,
      opacityMultiplier: 0.50
    }
  }
};
