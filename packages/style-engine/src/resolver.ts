import {
  RenderState,
  RenderStroke,
  RenderDiagnosticMode,
  StyleConfig,
  DEFAULT_STYLE_CONFIG,
  ResolvedStrokeStyle,
  StyledRenderStroke,
  StyledRenderState,
  StylePresetDefinition,
  GlowStyle,
  BackgroundStyle
} from '@sketch-maker/shared-types';
import { getStylePreset } from './registry';

/**
 * Pure deterministic resolver for diagnostic color overrides.
 */
export function resolveDiagnosticColor(
  stroke: RenderStroke,
  mode: RenderDiagnosticMode,
  totalStrokes: number
): string | null {
  switch (mode) {
    case 'sequence': {
      const progress = totalStrokes > 1 ? stroke.sequenceIndex / (totalStrokes - 1) : 0;
      const hue = Math.round((1.0 - progress) * 260); // 260 (purple) -> 0 (red)
      return `hsl(${hue}, 95%, 60%)`;
    }
    case 'phase': {
      switch (stroke.phase) {
        case 'foundation': return '#10b981';        // Emerald
        case 'primary_structure': return '#00f0ff';  // Cyan
        case 'expressive_features': return '#f43f5e'; // Rose
        case 'secondary_anatomy': return '#c084fc';  // Purple
        case 'refinement': return '#fbbf24';        // Amber
        case 'texture_accent':
        default:
          return '#94a3b8';                         // Slate
      }
    }
    case 'subject': {
      // Deterministic palette for multi-person isolation (BM-11)
      if (stroke.subjectId === 'subject-0') return '#00f0ff'; // Cyan
      if (stroke.subjectId === 'subject-1') return '#fbbf24'; // Amber
      if (stroke.subjectId === 'subject-2') return '#10b981'; // Emerald
      if (stroke.subjectId === 'subject-3') return '#f43f5e'; // Rose
      return '#c084fc';
    }
    case 'timeline': {
      if (stroke.status === 'drawing') return '#00f0ff';  // Active vibrant cyan
      if (stroke.status === 'complete') return '#cbd5e1'; // Finished cool silver
      return '#475569';
    }
    case 'normal':
    default:
      return null; // No diagnostic override; use artistic preset color
  }
}

/**
 * Resolves the visual appearance for a single RenderStroke.
 *
 * Deterministic Precedence Hierarchy:
 * 1. Base Preset defaults
 * 2. Semantic Role Modifiers (role-specific color, width, opacity, glow)
 * 3. Importance & Confidence Modifiers (bounded perceptual emphasis)
 * 4. Diagnostic Overrides (diagnostic color replaces stroke color when active)
 * 5. Explicit User Configuration (user line width / opacity / glow toggles)
 */
export function resolveStrokeStyle(
  stroke: RenderStroke,
  config: StyleConfig,
  presetDefinition?: StylePresetDefinition,
  totalStrokes: number = 1
): ResolvedStrokeStyle {
  const preset = presetDefinition ?? getStylePreset(config.preset);

  // 1. Base preset values
  let color = preset.defaultColor;
  let opacity = preset.defaultOpacity;
  let widthMultiplier = 1.0;
  let glow: GlowStyle | undefined = preset.defaultGlow ? { ...preset.defaultGlow } : undefined;

  // 2. Semantic Role Modifiers
  if (preset.semanticModifiers && stroke.semanticRole) {
    const modifier = preset.semanticModifiers[stroke.semanticRole];
    if (modifier) {
      if (modifier.color) {
        color = modifier.color;
      }
      if (modifier.opacityMultiplier !== undefined) {
        opacity *= modifier.opacityMultiplier;
      }
      if (modifier.widthMultiplier !== undefined) {
        widthMultiplier *= modifier.widthMultiplier;
      }
      if (modifier.glow) {
        glow = {
          enabled: modifier.glow.enabled ?? glow?.enabled ?? true,
          color: modifier.glow.color ?? glow?.color ?? color,
          radius: modifier.glow.radius ?? glow?.radius ?? 8,
          opacity: modifier.glow.opacity ?? glow?.opacity ?? 0.8
        };
      }
    }
  }

  // 3. Importance & Confidence Modifiers
  const impScale = preset.importanceScaling ?? 0.15;
  const confScale = preset.confidenceScaling ?? 0.10;

  // Bounded importance delta around 0.5 midpoint
  const impDelta = Math.max(-0.5, Math.min(0.5, stroke.importance - 0.5));
  widthMultiplier *= (1.0 + impScale * impDelta);
  opacity *= (1.0 + impScale * impDelta);

  // High confidence strengthens, low confidence softens
  const confDelta = Math.max(-0.5, Math.min(0.5, stroke.importance - 0.5)); // use importance as anchor
  opacity *= (1.0 + confScale * confDelta);

  // 4. Diagnostic Color Override (only overrides color; keeps width, caps, glow, background)
  const diagMode = config.diagnosticMode ?? 'normal';
  const diagnosticColor = resolveDiagnosticColor(stroke, diagMode, totalStrokes);
  if (diagnosticColor) {
    color = diagnosticColor;
  } else if (config.overrideColor) {
    color = config.overrideColor;
  }

  // 5. Explicit User Overrides
  if (config.lineWidthMultiplier !== undefined) {
    widthMultiplier *= config.lineWidthMultiplier;
  }
  if (config.opacityMultiplier !== undefined) {
    opacity *= config.opacityMultiplier;
  }
  if (config.enableGlow === false && glow) {
    glow = { ...glow, enabled: false };
  } else if (config.enableGlow === true) {
    glow = glow
      ? { ...glow, enabled: true }
      : { enabled: true, color, radius: 10, opacity: 0.8 };
  }

  // Final clamping and composition
  const finalLineWidth = Math.max(0.2, Math.min(10.0, stroke.lineWidth * preset.baseLineWidth * widthMultiplier));
  const finalOpacity = Math.max(0.0, Math.min(1.0, stroke.opacity * opacity));

  return {
    color,
    opacity: finalOpacity,
    lineWidth: finalLineWidth,
    lineCap: preset.lineCap,
    lineJoin: preset.lineJoin,
    glow,
    dash: preset.defaultDash,
    blendMode: preset.blendMode
  };
}

/**
 * Pure, deterministic transformer compiling a RenderState and StyleConfig into a StyledRenderState.
 *
 * Invariants:
 * 1. Leaves geometry, timeline indices, timestamps, and counts 100% untouched.
 * 2. Zero DOM / window / canvas calls.
 * 3. Resolves in < 1.0 ms.
 */
export function resolveStyledRenderState(
  renderState: RenderState,
  config?: Partial<StyleConfig>
): StyledRenderState {
  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

  const mergedConfig: StyleConfig = {
    ...DEFAULT_STYLE_CONFIG,
    ...config
  };

  const preset = getStylePreset(mergedConfig.preset);
  const totalStrokes = Math.max(1, renderState.totalStrokes);

  const background: BackgroundStyle = mergedConfig.overrideBackground ?? preset.background;

  const styledStrokes: StyledRenderStroke[] = new Array(renderState.strokes.length);

  for (let i = 0; i < renderState.strokes.length; i++) {
    const stroke = renderState.strokes[i];
    const style = resolveStrokeStyle(stroke, mergedConfig, preset, totalStrokes);

    styledStrokes[i] = {
      ...stroke,
      style
    };
  }

  const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const resolutionLatencyMs = Math.max(0, endTime - startTime);

  return {
    ...renderState,
    stylePreset: preset.id,
    background,
    styledStrokes,
    resolutionLatencyMs
  };
}
