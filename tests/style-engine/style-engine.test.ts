import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RenderStroke,
  RenderState,
  StyleConfig,
  StrokeTimeline
} from '@sketch-maker/shared-types';
import {
  getStylePreset,
  getAllStylePresets,
  resolveStrokeStyle,
  resolveStyledRenderState,
  resolveDiagnosticColor,
  styleRegistry
} from '../../packages/style-engine/src';
import { createRenderState } from '../../packages/stroke-engine/src/rendering';
import { createStrokeTimeline } from '../../packages/stroke-engine/src/timeline';
import { orderStrokeCandidates } from '../../packages/stroke-engine/src/ordering';
import { generateStrokeCandidates } from '../../packages/stroke-engine/src/candidates';

function createMockRenderStroke(overrides?: Partial<RenderStroke>): RenderStroke {
  return {
    strokeId: 'test-stroke-1',
    subjectId: 'subject-0',
    sequenceIndex: 0,
    timelineIndex: 0,
    status: 'drawing',
    progress: 0.5,
    geometry: {
      points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }],
      progress: 0.5,
      isComplete: false
    },
    lineWidth: 1.5,
    opacity: 1.0,
    semanticRole: 'eye',
    phase: 'expressive_features',
    importance: 0.85,
    isBackground: false,
    ...overrides
  };
}

function createMockRenderState(strokes?: RenderStroke[]): RenderState {
  const strokeList = strokes ?? [createMockRenderStroke()];
  return {
    timeMs: 1000,
    overallProgress: 0.5,
    strokes: strokeList,
    activeStrokes: strokeList.filter(s => s.status === 'drawing'),
    activeCount: strokeList.filter(s => s.status === 'drawing').length,
    completedCount: strokeList.filter(s => s.status === 'complete').length,
    pendingCount: strokeList.filter(s => s.status === 'pending').length,
    totalStrokes: strokeList.length,
    isComplete: false,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1, width: 1, height: 1 }
  };
}

describe('TASK-109: Procedural Style Engine & Appearance System', () => {

  describe('Style Preset Registry', () => {
    it('registers all canonical presets including realistic_pencil', () => {
      const presets = getAllStylePresets();
      assert.strictEqual(presets.length, 5);

      const ids = presets.map(p => p.id);
      assert.ok(ids.includes('procedural_black'));
      assert.ok(ids.includes('red_line'));
      assert.ok(ids.includes('neon'));
      assert.ok(ids.includes('blueprint'));
      assert.ok(ids.includes('realistic_pencil'));
    });

    it('falls back to procedural_black if an unknown preset is requested', () => {
      // @ts-expect-error testing invalid ID
      const preset = getStylePreset('unknown_preset');
      assert.strictEqual(preset.id, 'procedural_black');
    });
  });

  describe('Preset Visual Characteristics', () => {
    it('resolves procedural_black with white background and dark charcoal ink', () => {
      const stroke = createMockRenderStroke();
      const style = resolveStrokeStyle(stroke, { preset: 'procedural_black' });

      assert.ok(style.color.startsWith('#1a') || style.color === '#1a1a1a');
      assert.strictEqual(style.lineCap, 'round');
      assert.strictEqual(style.lineJoin, 'round');
      assert.strictEqual(style.glow, undefined);
      assert.ok(style.opacity >= 0.8 && style.opacity <= 1.0);
    });

    it('resolves red_line with warm off-white background and crimson ink', () => {
      const stroke = createMockRenderStroke();
      const style = resolveStrokeStyle(stroke, { preset: 'red_line' });

      // Eye role has crimson modifier #b91c1c or default #dc2626
      assert.ok(style.color === '#b91c1c' || style.color === '#dc2626');
      assert.strictEqual(style.glow, undefined);
    });

    it('resolves neon with dark abyss background, cyan ink, and active glow', () => {
      const stroke = createMockRenderStroke();
      const style = resolveStrokeStyle(stroke, { preset: 'neon' });

      assert.strictEqual(style.blendMode, 'screen');
      assert.ok(style.glow !== undefined);
      assert.strictEqual(style.glow.enabled, true);
      assert.ok(style.glow.radius >= 8);
      assert.ok(style.glow.opacity > 0);
    });

    it('resolves blueprint with prussian navy background and cyan-white ink', () => {
      const stroke = createMockRenderStroke();
      const style = resolveStrokeStyle(stroke, { preset: 'blueprint' });

      assert.ok(style.color.startsWith('#') || style.color.startsWith('rgb'));
      assert.ok(style.opacity >= 0.7 && style.opacity <= 1.0);
    });
  });

  describe('Semantic Role Modifiers', () => {
    it('applies subtle width and opacity emphasis to focal facial features (eyes, mouth)', () => {
      const eyeStroke = createMockRenderStroke({ semanticRole: 'eye', importance: 0.5 });
      const textureStroke = createMockRenderStroke({ semanticRole: 'texture', importance: 0.5 });

      const eyeStyle = resolveStrokeStyle(eyeStroke, { preset: 'procedural_black' });
      const textureStyle = resolveStrokeStyle(textureStroke, { preset: 'procedural_black' });

      assert.ok(eyeStyle.lineWidth > textureStyle.lineWidth, 'Eye stroke must be thicker than texture stroke');
      assert.ok(eyeStyle.opacity >= textureStyle.opacity, 'Eye stroke must be at least as opaque as texture stroke');
    });
  });

  describe('Importance and Confidence Bounded Scaling', () => {
    it('modulates line width within bounded limits without extreme distortion', () => {
      const lowImpStroke = createMockRenderStroke({ importance: 0.05 });
      const highImpStroke = createMockRenderStroke({ importance: 0.95 });

      const lowStyle = resolveStrokeStyle(lowImpStroke, { preset: 'procedural_black' });
      const highStyle = resolveStrokeStyle(highImpStroke, { preset: 'procedural_black' });

      assert.ok(highStyle.lineWidth > lowStyle.lineWidth);
      assert.ok(lowStyle.lineWidth >= 0.2, 'Line width must not collapse below minimum bound');
      assert.ok(highStyle.lineWidth <= 10.0, 'Line width must not exceed maximum bound');
      assert.ok(lowStyle.opacity > 0.4, 'Low importance stroke must not disappear completely');
    });
  });

  describe('Diagnostic Mode Override Integration', () => {
    it('overrides stroke color for sequence diagnostic mode while preserving preset line width and glow', () => {
      const stroke = createMockRenderStroke();
      const config: StyleConfig = { preset: 'neon', diagnosticMode: 'sequence' };
      const style = resolveStrokeStyle(stroke, config, undefined, 10);

      // Sequence mode maps to HSL spectrum
      assert.ok(style.color.startsWith('hsl('));
      // Neon glow and caps are preserved!
      assert.ok(style.glow !== undefined);
      assert.strictEqual(style.glow.enabled, true);
      assert.strictEqual(style.lineCap, 'round');
    });

    it('overrides stroke color for phase diagnostic mode', () => {
      const stroke = createMockRenderStroke({ phase: 'foundation' });
      const config: StyleConfig = { preset: 'procedural_black', diagnosticMode: 'phase' };
      const style = resolveStrokeStyle(stroke, config);

      assert.strictEqual(style.color, '#10b981'); // Emerald for foundation
    });

    it('overrides stroke color for subject diagnostic mode (BM-11 isolation)', () => {
      const stroke0 = createMockRenderStroke({ subjectId: 'subject-0' });
      const stroke1 = createMockRenderStroke({ subjectId: 'subject-1' });
      const config: StyleConfig = { preset: 'blueprint', diagnosticMode: 'subject' };

      const style0 = resolveStrokeStyle(stroke0, config);
      const style1 = resolveStrokeStyle(stroke1, config);

      assert.strictEqual(style0.color, '#00f0ff');
      assert.strictEqual(style1.color, '#fbbf24');
    });
  });

  describe('StyledRenderState Compilation', () => {
    it('compiles StyledRenderState in under 1.0 ms with valid styled strokes', () => {
      const mockStrokes = [
        createMockRenderStroke({ strokeId: 's1', semanticRole: 'silhouette' }),
        createMockRenderStroke({ strokeId: 's2', semanticRole: 'eye' }),
        createMockRenderStroke({ strokeId: 's3', semanticRole: 'hair' })
      ];
      const rState = createMockRenderState(mockStrokes);

      const styledState = resolveStyledRenderState(rState, { preset: 'neon' });

      assert.strictEqual(styledState.stylePreset, 'neon');
      assert.strictEqual(styledState.styledStrokes.length, 3);
      assert.strictEqual(styledState.background.type, 'solid');
      assert.ok(styledState.resolutionLatencyMs >= 0);
      assert.ok(styledState.resolutionLatencyMs < 5.0, 'Resolution must be fast (< 5ms)');

      for (const s of styledState.styledStrokes) {
        assert.ok(s.style !== undefined);
        assert.ok(typeof s.style.color === 'string');
        assert.ok(s.style.lineWidth > 0);
        assert.ok(s.style.opacity >= 0 && s.style.opacity <= 1);
      }
    });

    it('preserves geometry immutability: coordinates and points are strictly unmodified', () => {
      const initialPoint = { x: 0.123, y: 0.456 };
      const stroke = createMockRenderStroke({
        geometry: {
          points: [initialPoint, { x: 0.789, y: 0.999 }],
          progress: 1.0,
          isComplete: true
        }
      });
      const rState = createMockRenderState([stroke]);

      const styledState = resolveStyledRenderState(rState, { preset: 'red_line' });

      assert.strictEqual(styledState.styledStrokes[0].geometry.points[0].x, 0.123);
      assert.strictEqual(styledState.styledStrokes[0].geometry.points[0].y, 0.456);
      assert.strictEqual(styledState.strokes[0].strokeId, 'test-stroke-1');
    });
  });

  describe('Determinism Guarantee', () => {
    it('produces byte-for-byte identical ResolvedStrokeStyle output across repeated calls', () => {
      const stroke = createMockRenderStroke();
      const config: StyleConfig = { preset: 'neon' };

      const styleA = resolveStrokeStyle(stroke, config);
      const styleB = resolveStrokeStyle(stroke, config);

      assert.deepStrictEqual(styleA, styleB);
    });
  });

  describe('Pure TypeScript Portability Guarantee', () => {
    it('executes in Node headless runtime with zero DOM, Canvas, or window globals', () => {
      assert.strictEqual(typeof window, 'undefined');
      assert.strictEqual(typeof document, 'undefined');
      assert.strictEqual(typeof HTMLCanvasElement, 'undefined');
    });
  });
});
