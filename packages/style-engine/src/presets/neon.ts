import { StylePresetDefinition } from '@sketch-maker/shared-types';

/**
 * Neon Preset
 *
 * Dark-mode luminescent aesthetic with vivid glow:
 * - Deep dark abyss background
 * - High-contrast electric cyan and neon violet strokes
 * - Sleek core line weight
 * - Dedicated bloom glow parameters
 * - Screen composite blend mode for additive luminance
 */
export const NEON_PRESET: StylePresetDefinition = {
  id: 'neon',
  name: 'Neon',
  description: 'Luminescent dark-mode aesthetic with vivid bloom glow and high-contrast electric lines.',
  background: {
    type: 'solid',
    color: '#090a10'
  },
  defaultColor: '#00f0ff',
  defaultOpacity: 1.0,
  baseLineWidth: 1.3,
  lineCap: 'round',
  lineJoin: 'round',
  blendMode: 'screen',
  defaultGlow: {
    enabled: true,
    color: '#00f0ff',
    radius: 12,
    opacity: 0.85
  },
  importanceScaling: 0.20,
  confidenceScaling: 0.15,
  semanticModifiers: {
    eye: {
      color: '#38bdf8',
      widthMultiplier: 1.25,
      opacityMultiplier: 1.0,
      glow: {
        enabled: true,
        color: '#38bdf8',
        radius: 14,
        opacity: 0.90
      }
    },
    eyebrow: {
      color: '#38bdf8',
      widthMultiplier: 1.15,
      opacityMultiplier: 1.0,
      glow: {
        enabled: true,
        color: '#38bdf8',
        radius: 10,
        opacity: 0.80
      }
    },
    nose: {
      color: '#00f0ff',
      widthMultiplier: 1.10,
      opacityMultiplier: 1.0
    },
    mouth: {
      color: '#f43f5e', // Hot neon pink for lips
      widthMultiplier: 1.20,
      opacityMultiplier: 1.0,
      glow: {
        enabled: true,
        color: '#f43f5e',
        radius: 12,
        opacity: 0.85
      }
    },
    silhouette: {
      color: '#00f0ff',
      widthMultiplier: 1.35,
      opacityMultiplier: 1.0,
      glow: {
        enabled: true,
        color: '#00f0ff',
        radius: 14,
        opacity: 0.85
      }
    },
    hair: {
      color: '#c084fc', // Neon purple/violet for hair strands
      widthMultiplier: 0.95,
      opacityMultiplier: 0.90,
      glow: {
        enabled: true,
        color: '#c084fc',
        radius: 10,
        opacity: 0.75
      }
    },
    clothing_boundary: {
      color: '#06b6d4',
      widthMultiplier: 1.10,
      opacityMultiplier: 0.95
    },
    detail: {
      color: '#67e8f9',
      widthMultiplier: 0.80,
      opacityMultiplier: 0.80,
      glow: {
        enabled: true,
        color: '#67e8f9',
        radius: 6,
        opacity: 0.60
      }
    },
    texture: {
      color: '#67e8f9',
      widthMultiplier: 0.75,
      opacityMultiplier: 0.75,
      glow: {
        enabled: true,
        color: '#67e8f9',
        radius: 6,
        opacity: 0.50
      }
    },
    background: {
      color: '#334155',
      widthMultiplier: 0.65,
      opacityMultiplier: 0.40,
      glow: {
        enabled: false,
        color: '#334155',
        radius: 0,
        opacity: 0
      }
    }
  }
};
