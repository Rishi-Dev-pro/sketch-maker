import { StrokeSemanticRole, CompositionPhase } from './stroke';
import { RenderState, RenderStroke, RenderDiagnosticMode } from './render';

/**
 * Canonical procedural style identifiers supported by the style engine.
 */
export type StyleId =
  | 'procedural_black'
  | 'red_line'
  | 'neon'
  | 'blueprint';

/**
 * Background rendering specification.
 */
export type BackgroundStyle =
  | {
      readonly type: 'solid';
      readonly color: string;
    }
  | {
      readonly type: 'transparent';
    };

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
 * Data specification for stroke bloom and glowing appearance.
 */
export interface GlowStyle {
  /** Whether glow is enabled for this stroke */
  readonly enabled: boolean;
  /** Bloom color in hex or rgba format */
  readonly color: string;
  /** Blur radius in normalized viewport points */
  readonly radius: number;
  /** Glow alpha opacity [0.0 - 1.0] */
  readonly opacity: number;
}

/**
 * Pure, resolved appearance parameters for drawing a single stroke.
 * Free of Canvas/DOM/browser API bindings.
 */
export interface ResolvedStrokeStyle {
  /** Stroke color (hex, rgb, hsl) */
  readonly color: string;
  /** Stroke alpha opacity [0.0 - 1.0] */
  readonly opacity: number;
  /** Normalized line width multiplier */
  readonly lineWidth: number;
  /** Line end cap style */
  readonly lineCap: 'butt' | 'round' | 'square';
  /** Line join style */
  readonly lineJoin: 'miter' | 'round' | 'bevel';
  /** Optional bloom glow effect */
  readonly glow?: GlowStyle;
  /** Optional stroke dash pattern [dashLength, gapLength] */
  readonly dash?: readonly number[];
  /** Canvas 2D blend mode override */
  readonly blendMode?: 'source-over' | 'screen' | 'lighter' | 'multiply';
}

/**
 * Semantic modifier rule for adjusting appearance based on anatomical role.
 */
export interface SemanticStyleModifier {
  readonly color?: string;
  readonly opacityMultiplier?: number;
  readonly widthMultiplier?: number;
  readonly glow?: Partial<GlowStyle>;
}

/**
 * Definition contract for a registered style preset in the style engine.
 */
export interface StylePresetDefinition {
  readonly id: StyleId;
  readonly name: string;
  readonly description: string;
  /** Base canvas background style */
  readonly background: BackgroundStyle;
  /** Base stroke color */
  readonly defaultColor: string;
  /** Base opacity [0.0 - 1.0] */
  readonly defaultOpacity: number;
  /** Base line width multiplier */
  readonly baseLineWidth: number;
  /** Default line cap */
  readonly lineCap: 'butt' | 'round' | 'square';
  /** Default line join */
  readonly lineJoin: 'miter' | 'round' | 'bevel';
  /** Default glow specification */
  readonly defaultGlow?: GlowStyle;
  /** Optional default dash pattern */
  readonly defaultDash?: readonly number[];
  /** Default blend mode */
  readonly blendMode?: 'source-over' | 'screen' | 'lighter' | 'multiply';
  /** Role-specific appearance adjustments */
  readonly semanticModifiers?: Partial<Record<StrokeSemanticRole, SemanticStyleModifier>>;
  /** Importance modulation scaling factor (0.0 = disabled, 0.2 = subtle) */
  readonly importanceScaling?: number;
  /** Confidence modulation scaling factor (0.0 = disabled, 0.15 = subtle) */
  readonly confidenceScaling?: number;
}

/**
 * User-adjustable customization parameters passed into the style engine.
 * Changing these does NOT re-trigger structural analysis, vectorization, or timeline generation.
 */
export interface StyleConfig {
  /** Active style preset */
  readonly preset: StyleId;
  /** Optional stroke color override (undefined = preset default) */
  readonly overrideColor?: string;
  /** Optional background override (undefined = preset default) */
  readonly overrideBackground?: BackgroundStyle;
  /** Global line width multiplier (default: 1.0) */
  readonly lineWidthMultiplier?: number;
  /** Global opacity multiplier (default: 1.0) */
  readonly opacityMultiplier?: number;
  /** Enable or disable glow effects (default: follows preset) */
  readonly enableGlow?: boolean;
  /** Active diagnostic visualization mode override */
  readonly diagnosticMode?: RenderDiagnosticMode;
}

/**
 * Default style configuration using the canonical procedural_black preset.
 */
export const DEFAULT_STYLE_CONFIG: StyleConfig = {
  preset: 'procedural_black',
  lineWidthMultiplier: 1.0,
  opacityMultiplier: 1.0,
  diagnosticMode: 'normal'
};

/**
 * Extended RenderStroke carrying resolved appearance metadata.
 */
export interface StyledRenderStroke extends RenderStroke {
  readonly style: ResolvedStrokeStyle;
}

/**
 * Complete immutable snapshot of procedural artwork with resolved style parameters.
 */
export interface StyledRenderState extends RenderState {
  readonly stylePreset: StyleId;
  readonly background: BackgroundStyle;
  readonly styledStrokes: StyledRenderStroke[];
  readonly resolutionLatencyMs: number;
}
