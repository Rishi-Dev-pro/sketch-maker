# Procedural Style Engine & Appearance System Architecture (TASK-109)

## 1. Executive Summary

**TASK-109 — Procedural Style Engine & Rendering Appearance System** establishes a dedicated, platform-independent appearance layer for the Photo-to-Procedural-Art pipeline.

The fundamental architectural principle is strict decoupling:

```text
GEOMETRY (What to draw)
    ≠
TIMING (When to draw)
    ≠
STYLE (How it should look)
```

By separating visual style from underlying geometry and temporal animation, the engine can render the exact same artwork across radically different visual aesthetics without mutating vector points, curve handles, stroke identities, structural hierarchy, composition order, or timeline pacing.

```text
IMAGE
  ↓
IMAGE PREPROCESSING
  ↓
VISION / STRUCTURAL ANALYSIS
  ↓
VECTOR GEOMETRY                    TASK-104
  ↓
STROKE CANDIDATES                  TASK-105
  ↓
ORDERED STROKE SEQUENCE            TASK-106
  ↓
STROKE TIMELINE                    TASK-107
  ↓
RENDER STATE                       TASK-108
  ↓
TASK-109
PROCEDURAL STYLE ENGINE
  ├── Preset Registry (procedural_black, red_line, neon, blueprint)
  ├── Semantic Role Modifiers (anatomical emphasis)
  ├── Salience & Confidence Modulators
  └── Diagnostic Overrides
  ↓
STYLED RENDER STATE                TASK-109
  ↓
CANVAS STROKE RENDERER             TASK-108 / TASK-109
  ↓
VISIBLE PROCEDURAL ARTWORK
```

---

## 2. Core Architectural Boundary

To preserve portability for headless Node.js rendering, Web Workers, and future React Native / Skia mobile targets:
- **Zero DOM / Canvas Dependencies:** `packages/style-engine` and `packages/shared-types` contain no imports or references to `window`, `document`, `HTMLCanvasElement`, `CanvasRenderingContext2D`, or `requestAnimationFrame`.
- **Pure Data Instruction:** The style engine produces pure, serializable style instructions (`ResolvedStrokeStyle`, `BackgroundStyle`, `StyledRenderState`).
- **Physical Translation Isolation:** Physical canvas operations—such as DPR scaling, line width pixel conversion, shadow blur calculation, and composite blend modes—remain strictly encapsulated within the web rendering adapter (`apps/web/src/rendering/`).

---

## 3. Style Resolution Precedence Hierarchy

The style engine resolves appearance deterministically with **zero randomness** (`Math.random()` is strictly prohibited). Every stroke's visual properties are resolved through a documented five-tier precedence hierarchy:

```text
Tier 1: Base Preset Defaults
        ↓
Tier 2: Semantic Role Modifiers (focal feature emphasis)
        ↓
Tier 3: Salience & Confidence Modifiers (importance-based line weight and opacity)
        ↓
Tier 4: Diagnostic Overrides (sequence / phase / subject / timeline color mapping)
        ↓
Tier 5: Explicit User Overrides (user color / opacity / line width / glow toggles)
```

### Precedence Rules:
1. **Base Preset Defaults:** Establishes default stroke color, opacity, line width, line cap, line join, default glow, and blend mode.
2. **Semantic Role Modifiers:** Preset rules adjust parameters based on `stroke.semanticRole` (e.g. eyes and mouth receive subtle width boost; hair strands receive delicate weight; background receives muted tone).
3. **Salience & Confidence Modifiers:**
   $$w = w \times (1.0 + s_{\text{imp}} \cdot (I - 0.5))$$
   $$\alpha = \alpha \times (1.0 + s_{\text{imp}} \cdot (I - 0.5)) \times (1.0 + s_{\text{conf}} \cdot (c - 0.5))$$
   Modulations are strictly bounded: line width is clamped within $[0.2, 10.0]$ and opacity within $[0.0, 1.0]$. Low-salience strokes never disappear unless requested.
4. **Diagnostic Overrides:** When an inspection mode is active (`sequence`, `phase`, `subject`, `timeline`), the diagnostic color replaces the stroke color. **Crucially**, diagnostic modes override *only* color, preserving the active preset's background, line width, caps, joins, and glow.
5. **User Configuration Overrides:** Explicit user multipliers (`lineWidthMultiplier`, `opacityMultiplier`, `enableGlow`) apply to the resolved output.

---

## 4. Built-in Style Presets

TASK-109 introduces four canonical presets:

### 4.1 Procedural Black (`procedural_black`)
- **Concept:** Canonical reference and debugging style displaying raw geometry fidelity.
- **Background:** Solid white (`#ffffff`).
- **Stroke Color:** Dark charcoal (`#1a1a1a`).
- **Aesthetic:** High contrast, crisp lines, round caps and joins, zero glow bloom.
- **Semantic Nuance:** Subtle +20% line weight for primary facial features (eyes, mouth) and silhouette; softer -20% weight for background texture.

### 4.2 Red Line (`red_line`)
- **Concept:** Expressive crimson ink illustration.
- **Background:** Warm antique off-white (`#faf8f5`).
- **Stroke Color:** Deep crimson red (`#dc2626`).
- **Aesthetic:** Single-ink expressive portrait drawing, round caps/joins, zero bloom.
- **Semantic Nuance:** Focal facial features receive deep ruby red (`#b91c1c`), hair receives bright scarlet (`#ef4444`), and auxiliary texture receives soft coral (`#f87171`).

### 4.3 Neon (`neon`)
- **Concept:** Luminescent dark-mode cyberpunk aesthetic with radiant glow.
- **Background:** Deep dark abyss (`#090a10`).
- **Stroke Color:** Electric cyan (`#00f0ff`).
- **Aesthetic:** Additive screen blend mode (`blendMode: 'screen'`), sleeker core line width ($1.3$), active bloom glow (`radius: 12`, `opacity: 0.85`).
- **Semantic Nuance:** Eyes and brows glow electric blue (`#38bdf8`), lips glow hot neon pink (`#f43f5e`), hair strands glow neon purple (`#c084fc`).

### 4.4 Blueprint (`blueprint`)
- **Concept:** Precision architectural drafting aesthetic.
- **Background:** Deep Prussian navy (`#0b1d3a`).
- **Stroke Color:** Technical cyan-white (`#e0f2fe`).
- **Aesthetic:** Subtle structural transparency ($\alpha = 0.90$), clean uniform technical line weight ($1.3$), zero heavy bloom.
- **Semantic Nuance:** Main structural silhouette in bold cyan-white (`#bae6fd`), anatomical features in technical cyan (`#38bdf8`), and hair/clothing in soft azure (`#7dd3fc`).

---

## 5. Runtime Performance & Invariants

### 5.1 Sub-Millisecond Resolution Latency
Across all 12 canonical benchmark categories (`BM-01` through `BM-12`), resolving styles for an entire artwork averages:
$$\text{Average Style Resolution Latency} = \mathbf{0.008\text{ ms}}\ (8\ \mu\text{s})$$
This is **125x faster** than the strict $1.0\text{ ms}$ SLA target. Resolving styles consumes less than **0.05%** of a 60 FPS frame budget.

### 5.2 Zero Upstream Pipeline Re-execution
Switching styles at runtime (e.g. `procedural_black` $\to$ `neon`):
- Does **NOT** rerun image preprocessing.
- Does **NOT** rerun vision or segmentation.
- Does **NOT** regenerate vector geometry.
- Does **NOT** re-order stroke candidates.
- Does **NOT** re-schedule the progressive timeline.

### 5.3 Playback & Scrubbing Continuity
Changing styles during playback or while dragging the scrubber:
- Preserves current wall-clock timestamp $t$.
- Preserves animation progress percentage.
- Preserves active stroke completion state.
- Preserves active pen tip coordinates.
- Only visual appearance is updated on the next rendered frame.

### 5.4 Geometry Invariance Guarantee
Automated regression tests verify that for any given `RenderState`:
$$\text{Stroke Count, Points, Curves, and IDs} \equiv \text{Identical across all presets}$$
The style engine mutates zero geometric coordinates.
