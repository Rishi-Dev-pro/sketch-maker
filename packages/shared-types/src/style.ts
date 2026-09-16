/**
 * Style identifiers supported by the style engine.
 */
export type StyleId =
  | 'cinematic'
  | 'sketch'
  | 'binary'
  | 'neon'
  | 'blueprint'
  | 'terminal'
  | 'red_line';

/**
 * Background rendering mode.
 */
export type BackgroundMode =
  | 'keep'
  | 'remove'
  | 'blur'
  | 'outline_only'
  | 'solid_color';

/**
 * Adaptive quality profiles.
 */
export type QualityProfile =
  | 'fast'
  | 'balanced'
  | 'high'
  | 'ultra';

/**
 * User-adjustable customization parameters.
 * Changing these does NOT re-trigger structural analysis.
 */
export interface StyleConfig {
  readonly styleId: StyleId;
  readonly lineColor: string;
  readonly backgroundColor: string;
  readonly lineThickness: number;  // Multiplier, e.g. 1.0 = base thickness
  readonly strokeDensity: number;  // [0.1 - 1.0] Filter strokes by importance threshold
  readonly animationSpeed: number; // Multiplier, 1.0 = standard speed
  readonly glowIntensity: number;  // [0.0 - 1.0] Bloom/glow effect (for neon/cinematic)
  readonly detailLevel: number;    // [0.0 - 1.0] Controls fine detail curve inclusions
  readonly backgroundMode: BackgroundMode;
  readonly qualityProfile: QualityProfile;
}
