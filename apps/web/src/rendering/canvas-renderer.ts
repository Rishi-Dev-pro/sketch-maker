import {
  RenderState,
  RenderStroke,
  RenderDiagnosticMode,
  CompositionPhase,
  StrokeSemanticRole
} from '@sketch-maker/shared-types';
import { ViewportTransform, ViewportOptions } from './viewport';

export interface CanvasRenderOptions {
  /** Canvas background mode */
  readonly backgroundMode?: 'solid' | 'transparent';
  /** Solid background color (default: '#0a0b10') */
  readonly backgroundColor?: string;
  /** Primary artwork ink color in normal mode (default: '#f8fafc') */
  readonly strokeColor?: string;
  /** Visual diagnostic mode override */
  readonly diagnosticMode?: RenderDiagnosticMode;
  /** Whether to render active pen tip glow indicator (default: true) */
  readonly penTipGlow?: boolean;
  /** Whether to render sequence index badges in sequence debug mode (default: true) */
  readonly showSequenceBadges?: boolean;
  /** Optional background image element to draw behind artwork */
  readonly backgroundImage?: HTMLImageElement | null;
  /** Background image opacity [0.0 - 1.0] (default: 0.25) */
  readonly backgroundImageOpacity?: number;
}

/**
 * High-performance, resolution-independent HTML5 Canvas 2D Procedural Stroke Renderer.
 * Consumes the platform-independent RenderState and renders progressive procedural artwork
 * with high-DPI scaling, smooth anti-aliased curves, and active drawing tip visualizers.
 */
export class CanvasStrokeRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private viewport: ViewportTransform;

  constructor(canvas: HTMLCanvasElement, viewportOptions?: Partial<ViewportOptions>) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to obtain CanvasRenderingContext2D');
    }
    this.ctx = context;

    this.viewport = new ViewportTransform({
      width: viewportOptions?.width ?? (canvas.clientWidth || 800),
      height: viewportOptions?.height ?? (canvas.clientHeight || 800),
      dpr: viewportOptions?.dpr,
      padding: viewportOptions?.padding ?? 0.04,
      artworkAspectRatio: viewportOptions?.artworkAspectRatio ?? 1.0
    });

    this.applyCanvasDimensions();
  }

  /**
   * Resizes canvas backing store and updates viewport transformation.
   */
  public resize(
    width: number,
    height: number,
    dpr?: number,
    aspectRatio: number = 1.0
  ): void {
    this.viewport = new ViewportTransform({
      width,
      height,
      dpr,
      artworkAspectRatio: aspectRatio
    });
    this.applyCanvasDimensions();
  }

  private applyCanvasDimensions(): void {
    this.canvas.width = this.viewport.pixelWidth;
    this.canvas.height = this.viewport.pixelHeight;
    this.canvas.style.width = `${this.viewport.displayWidth}px`;
    this.canvas.style.height = `${this.viewport.displayHeight}px`;

    // Scale context by DPR so drawing operations use display CSS coordinates
    this.ctx.setTransform(this.viewport.dpr, 0, 0, this.viewport.dpr, 0, 0);
  }

  public getViewport(): ViewportTransform {
    return this.viewport;
  }

  /**
   * Clears the entire canvas viewport.
   */
  public clear(): void {
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();
  }

  /**
   * Renders the progressive RenderState or StyledRenderState onto the canvas.
   */
  public render(
    renderState: RenderState | (RenderState & { background?: { type: 'solid' | 'transparent'; color?: string } }),
    options?: CanvasRenderOptions
  ): void {
    const ctx = this.ctx;
    const vp = this.viewport;

    // 1. Clear viewport
    this.clear();

    // 2. Render background (resolves from StyledRenderState or options fallback)
    const stateBg = 'background' in renderState ? renderState.background : undefined;
    const bgMode = options?.backgroundMode ?? stateBg?.type ?? 'solid';
    const bgColor = options?.backgroundColor ?? (stateBg && stateBg.type === 'solid' ? stateBg.color : '#ffffff');

    if (bgMode === 'solid' && bgColor) {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, vp.displayWidth, vp.displayHeight);
    }

    // Optional background photograph underlay with dimming
    if (options?.backgroundImage) {
      ctx.save();
      ctx.globalAlpha = options.backgroundImageOpacity ?? 0.25;
      ctx.drawImage(
        options.backgroundImage,
        vp.offsetX,
        vp.offsetY,
        vp.scaleX,
        vp.scaleY
      );
      ctx.restore();
    }

    const totalStrokes = Math.max(1, renderState.totalStrokes);
    const diagMode = options?.diagnosticMode ?? 'normal';
    const defaultColor = options?.strokeColor ?? '#1a1a1a';
    const penGlow = options?.penTipGlow ?? true;
    const showBadges = options?.showSequenceBadges ?? true;

    // 3. Render strokes in deterministic timeline order
    for (let i = 0; i < renderState.strokes.length; i++) {
      const s = renderState.strokes[i];
      if (s.status === 'pending') {
        continue; // Pending strokes are completely invisible
      }

      ctx.save();

      // Resolve appearance from resolved style or fallback to defaults
      if (s.style) {
        ctx.strokeStyle = s.style.color;
        ctx.fillStyle = s.style.color;
        ctx.lineWidth = vp.toPixelWidth(s.style.lineWidth, 0.8, 10.0);
        ctx.lineCap = s.style.lineCap;
        ctx.lineJoin = s.style.lineJoin;
        ctx.globalAlpha = s.style.opacity;

        if (s.style.blendMode) {
          ctx.globalCompositeOperation = s.style.blendMode;
        }

        if (s.style.glow?.enabled && s.style.glow.radius > 0) {
          ctx.shadowColor = s.style.glow.color;
          ctx.shadowBlur = s.style.glow.radius * Math.min(vp.scaleX, vp.scaleY);
        }

        if (s.style.dash && s.style.dash.length > 0) {
          ctx.setLineDash(s.style.dash as number[]);
        }
      } else {
        // Fallback for unstyled RenderStroke
        const color = this.resolveStrokeColor(s, diagMode, defaultColor, totalStrokes);
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = vp.toPixelWidth(s.lineWidth, 1.0, 8.0);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = s.opacity;
      }
      ctx.miterLimit = 2;

      // Draw Bézier curves or polyline
      if (s.geometry.curves && s.geometry.curves.length > 0) {
        ctx.beginPath();
        const first = s.geometry.curves[0];
        const pStart = vp.toPixel(first.start);
        ctx.moveTo(pStart.x, pStart.y);

        for (let cIdx = 0; cIdx < s.geometry.curves.length; cIdx++) {
          const c = s.geometry.curves[cIdx];
          const cp1 = vp.toPixel(c.cp1);
          const cp2 = vp.toPixel(c.cp2 ?? c.cp1);
          const end = vp.toPixel(c.end);
          ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, end.x, end.y);
        }
        ctx.stroke();
      } else if (s.geometry.points.length >= 2) {
        ctx.beginPath();
        const pStart = vp.toPixel(s.geometry.points[0]);
        ctx.moveTo(pStart.x, pStart.y);

        for (let pIdx = 1; pIdx < s.geometry.points.length; pIdx++) {
          const p = vp.toPixel(s.geometry.points[pIdx]);
          ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      } else if (s.geometry.points.length === 1) {
        const p = vp.toPixel(s.geometry.points[0]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, ctx.lineWidth * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Active drawing tip indicator
      if (s.status === 'drawing' && s.geometry.tipPoint && penGlow) {
        const tip = vp.toPixel(s.geometry.tipPoint);
        ctx.beginPath();
        const tipRadius = Math.max(2.5, ctx.lineWidth * 1.3);
        ctx.arc(tip.x, tip.y, tipRadius, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = s.style?.glow?.enabled ? s.style.glow.color : (s.style?.color ?? '#00f0ff');
        ctx.shadowBlur = 10;
        ctx.fill();
      }

      // Sequence index badge in sequence debug mode
      if (diagMode === 'sequence' && showBadges && s.geometry.points.length > 0) {
        const badgePt = vp.toPixel(s.geometry.points[0]);
        ctx.font = 'bold 9px monospace';
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#000000';
        ctx.shadowBlur = 4;
        ctx.fillText(`${s.sequenceIndex}`, badgePt.x + 3, badgePt.y - 3);
      }

      ctx.restore();
    }
  }

  private resolveStrokeColor(
    s: RenderStroke,
    mode: RenderDiagnosticMode,
    defaultColor: string,
    totalStrokes: number
  ): string {
    switch (mode) {
      case 'sequence': {
        const progress = totalStrokes > 1 ? s.sequenceIndex / (totalStrokes - 1) : 0;
        const hue = Math.round((1.0 - progress) * 260); // 260 (purple) -> 0 (red)
        return `hsl(${hue}, 95%, 60%)`;
      }
      case 'phase': {
        switch (s.phase) {
          case 'foundation': return '#10b981';       // Emerald
          case 'primary_structure': return '#00f0ff'; // Cyan
          case 'expressive_features': return '#f43f5e'; // Rose
          case 'secondary_anatomy': return '#c084fc'; // Purple
          case 'refinement': return '#fbbf24';       // Amber
          case 'texture_accent': return '#94a3b8';   // Slate
          default: return '#cbd5e1';
        }
      }
      case 'subject': {
        // Multi-person distinct subject colors
        if (s.subjectId === 'subject-0') return '#00f0ff'; // Cyan
        if (s.subjectId === 'subject-1') return '#fbbf24'; // Amber
        if (s.subjectId === 'subject-2') return '#10b981'; // Emerald
        return '#c084fc';
      }
      case 'timeline': {
        if (s.status === 'drawing') return '#00f0ff'; // Active vibrant cyan
        if (s.status === 'complete') return '#cbd5e1'; // Finished cool silver
        return '#475569';
      }
      case 'normal':
      default:
        return defaultColor;
    }
  }

  public dispose(): void {
    this.clear();
  }
}
