import { StylePresetDefinition } from '@sketch-maker/shared-types';

/**
 * Red Line Preset
 *
 * Demonstrates appearance modulation without altering underlying geometry:
 * - Warm antique off-white background
 * - Rich expressive crimson red ink
 * - High opacity with subtle anatomical weight modulation
 * - Round caps and joins
 * - Zero glow bloom
 */
export const RED_LINE_PRESET: StylePresetDefinition = {
  id: 'red_line',
  name: 'Red Line',
  description: 'Expressive crimson ink illustration on warm off-white canvas.',
  background: {
    type: 'solid',
    color: '#faf8f5'
  },
  defaultColor: '#dc2626',
  defaultOpacity: 0.95,
  baseLineWidth: 1.5,
  lineCap: 'round',
  lineJoin: 'round',
  blendMode: 'source-over',
  importanceScaling: 0.15,
  confidenceScaling: 0.10,
  semanticModifiers: {
    eye: {
      color: '#b91c1c',
      widthMultiplier: 1.20,
      opacityMultiplier: 1.05
    },
    eyebrow: {
      color: '#b91c1c',
      widthMultiplier: 1.15,
      opacityMultiplier: 1.0
    },
    nose: {
      color: '#b91c1c',
      widthMultiplier: 1.10,
      opacityMultiplier: 1.0
    },
    mouth: {
      color: '#b91c1c',
      widthMultiplier: 1.15,
      opacityMultiplier: 1.0
    },
    silhouette: {
      color: '#991b1b',
      widthMultiplier: 1.25,
      opacityMultiplier: 1.0
    },
    hair: {
      color: '#ef4444',
      widthMultiplier: 0.90,
      opacityMultiplier: 0.88
    },
    clothing_boundary: {
      color: '#b91c1c',
      widthMultiplier: 1.05,
      opacityMultiplier: 0.92
    },
    detail: {
      color: '#f87171',
      widthMultiplier: 0.80,
      opacityMultiplier: 0.75
    },
    texture: {
      color: '#f87171',
      widthMultiplier: 0.75,
      opacityMultiplier: 0.70
    },
    background: {
      color: '#fca5a5',
      widthMultiplier: 0.65,
      opacityMultiplier: 0.50
    }
  }
};
