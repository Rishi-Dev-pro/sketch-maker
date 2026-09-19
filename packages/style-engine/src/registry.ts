import { StyleId, StylePresetDefinition } from '@sketch-maker/shared-types';
import {
  PROCEDURAL_BLACK_PRESET,
  RED_LINE_PRESET,
  NEON_PRESET,
  BLUEPRINT_PRESET
} from './presets';

/**
 * Built-in registry of verified procedural style presets.
 */
class StyleRegistry {
  private readonly presets: Map<StyleId, StylePresetDefinition> = new Map();

  constructor() {
    this.register(PROCEDURAL_BLACK_PRESET);
    this.register(RED_LINE_PRESET);
    this.register(NEON_PRESET);
    this.register(BLUEPRINT_PRESET);
  }

  /**
   * Registers a new or custom style preset.
   */
  public register(preset: StylePresetDefinition): void {
    this.presets.set(preset.id, Object.freeze({ ...preset }));
  }

  /**
   * Retrieves a preset by ID, falling back to procedural_black if not found.
   */
  public get(id: StyleId): StylePresetDefinition {
    const preset = this.presets.get(id);
    if (!preset) {
      console.warn(`[StyleRegistry] Style preset '${id}' not found, falling back to 'procedural_black'`);
      return this.presets.get('procedural_black') ?? PROCEDURAL_BLACK_PRESET;
    }
    return preset;
  }

  /**
   * Checks whether a preset ID is registered.
   */
  public has(id: string): boolean {
    return this.presets.has(id as StyleId);
  }

  /**
   * Returns all registered style presets.
   */
  public getAll(): StylePresetDefinition[] {
    return Array.from(this.presets.values());
  }

  /**
   * Returns all registered style preset IDs.
   */
  public getIds(): StyleId[] {
    return Array.from(this.presets.keys());
  }
}

/** Global singleton instance */
export const styleRegistry = new StyleRegistry();

export function getStylePreset(id: StyleId): StylePresetDefinition {
  return styleRegistry.get(id);
}

export function getAllStylePresets(): StylePresetDefinition[] {
  return styleRegistry.getAll();
}

export function registerStylePreset(preset: StylePresetDefinition): void {
  styleRegistry.register(preset);
}

export function hasStylePreset(id: string): boolean {
  return styleRegistry.has(id);
}
