# STROKE_CANDIDATE_GENERATION.md — TASK-105 Technical Specification & Evaluation

## 1. Overview & Architectural Role

`TASK-105 (Procedural Stroke Candidate Generation)` marks the foundational transition where the project begins operating as an actual **Photo-to-Procedural-Art engine** rather than purely a perception and vectorization system.

```text
VectorGeometry (TASK-104 Canonical Geometry IR)
  ├── paths: VectorPath[] (simplified polylines, Bézier splines, hierarchy levels)
  └── bounds: BoundingBox ([0.0, 1.0] normalized space)
                    │
                    ▼
       packages/stroke-engine/src/candidates/
  ├── semantic-roles.ts     (anatomical/structural role classification)
  ├── partitioning.ts       (curvature/length-aware gesture segmenting)
  ├── properties.ts         (deterministic width, density, and priority modeling)
  ├── filtering.ts          (eligibility, occlusion, confidence, & length filtering)
  ├── validator.ts          (strict finite coordinate & bounds validation)
  └── generator.ts          (unified StrokeCandidateSet orchestrator)
                    │
                    ▼
StrokeCandidateSet (TASK-105 Procedural Stroke Candidate IR)
  ├── candidates: StrokeCandidate[]
  │     ├── points: Point2D[], curves?: BezierCurve[]
  │     ├── semanticRole: StrokeSemanticRole
  │     ├── width: number (expressive line weight)
  │     ├── density: number (detail density allocation)
  │     ├── priorityScore: number (relative drawing priority)
  │     ├── drawable: boolean
  │     └── filteredReason?: StrokeFilteredReason
  └── metrics: StrokeMetrics
```

### Strict Architectural Boundaries
1. **Zero Browser/DOM Globals:** Core packages (`packages/shared-types`, `packages/stroke-engine`) contain zero references to `window`, `document`, HTMLCanvasElement, CanvasRenderingContext2D, or SVG DOM elements.
2. **Stroke vs. Path Distinction:** A single `VectorPath` represents pure geometric evidence and may yield 0, 1, or multiple `StrokeCandidate`s (e.g. long silhouettes are partitioned into gesture-sized drawing arcs, occluded features yield 0 drawable strokes).
3. **No Timeline Ordering or Progressive Animation:** TASK-105 produces drawing instruction candidates. Global timeline sequence scheduling, canvas style effects (neon, glow, watercolor), and video export strictly belong to TASK-106+.

---

## 2. Canonical Data Contracts (`packages/shared-types/src/stroke.ts`)

```typescript
export type StrokeSemanticRole =
  | 'silhouette'
  | 'facial_contour'
  | 'eye'
  | 'eyebrow'
  | 'nose'
  | 'mouth'
  | 'ear'
  | 'hair'
  | 'body_structure'
  | 'clothing_boundary'
  | 'semantic_boundary'
  | 'texture'
  | 'detail'
  | 'background';

export type StrokeFilteredReason =
  | 'occluded'
  | 'not_detected'
  | 'low_confidence'
  | 'too_short'
  | 'invalid_geometry'
  | 'background'
  | 'filtered_noise'
  | 'density_pruned';

export interface StrokeCandidate {
  readonly id: string;
  readonly subjectId: string;
  readonly sourcePathId: string;
  readonly source: GeometrySource;
  readonly points: Point2D[];
  readonly curves?: BezierCurve[];
  readonly closed: boolean;
  readonly confidence: number;           // [0.0, 1.0]
  readonly importance: number;           // [0.0, 1.0]
  readonly priorityScore: number;        // [0.0, 1.0]
  readonly semanticRole: StrokeSemanticRole;
  readonly hierarchyLevel: PathHierarchyLevel;
  readonly width: number;                // Relative line weight multiplier
  readonly density: number;              // Detail density allocation [0.0, 1.0]
  readonly length: number;               // Normalized geometric arc length
  readonly bounds: BoundingBox;
  readonly visibility?: FeatureVisibility;
  readonly drawable: boolean;            // Qualified for progressive drawing
  readonly isBackground: boolean;
  readonly isSkeletal?: boolean;
  readonly filteredReason?: StrokeFilteredReason;
  readonly metadata?: Record<string, unknown>;
}

export interface StrokeMetrics {
  readonly totalCandidates: number;
  readonly drawableCandidates: number;
  readonly filteredCandidates: number;
  readonly totalLength: number;
  readonly averageLength: number;
  readonly averageConfidence: number;
  readonly averageImportance: number;
  readonly averageWidth: number;
  readonly strokesBySemanticRole: Partial<Record<StrokeSemanticRole, number>>;
  readonly strokesByHierarchy: Partial<Record<PathHierarchyLevel, number>>;
  readonly strokesBySubject: Record<string, number>;
  readonly generationLatencyMs: number;
}

export interface StrokeCandidateSet {
  readonly version: string;
  readonly candidates: StrokeCandidate[];
  readonly bounds: BoundingBox;
  readonly metrics: StrokeMetrics;
  readonly timestamp: number;
}
```

---

## 3. Algorithmic Pipeline & Mathematical Formulations

### 3.1 Semantic Role Classification (`semantic-roles.ts`)
Maps heterogeneous perception evidence into structured artistic roles:
* `eyes` $\to$ `'eye'`, `eyebrows` $\to$ `'eyebrow'`, `nose` $\to$ `'nose'`, `mouth` $\to$ `'mouth'`, `ears` $\to$ `'ear'`, `jawline` $\to$ `'facial_contour'`.
* `source: 'silhouette'` $\to$ `'silhouette'`.
* `source: 'pose_connection' | 'pose_landmark'` $\to$ `'body_structure'`.
* `source: 'semantic_boundary'` $\to$ `'semantic_boundary'`.
* `hair` / `hair_boundary` $\to$ `'hair'`.
* `clothing` $\to$ `'clothing_boundary'`.
* `background` $\to$ `'background'`.

### 3.2 Path Partitioning & Gesture Subdivision (`partitioning.ts`)
Converts mathematical continuous loops into natural drawing strokes:
* **Protected Anatomical Features:** Primary facial details (`eyes`, `eyebrows`, `nose`, `mouth`, `ears`) are **never fragmented**, preserving delicate palpebral fissures, nostril contours, and vermilion margins intact.
* **Sharp Angular Inflection:** Detects interior vertex deflection angles:
  $$\theta = \arccos\left(\frac{\vec{u} \cdot \vec{v}}{\|\vec{u}\| \|\vec{v}\|}\right) > 1.30 \text{ rad} \ (\approx 75^\circ)$$
  Splitting occurs at natural anatomical corners (chin apex, shoulder turns, collar breaks).
* **Length-Based Subsegmenting:** Paths exceeding `maxStrokeLength` (default $0.35$ in $[0.0, 1.0]$ space) are subdivided into gesture-sized arcs.
* **Closed Loop Opening:** Continuous silhouette loops are opened into complementary gesture strokes.
* **Anti-Explosion Guardrail:** `maxCandidatesPerPath` (default: 8) caps segment count per path.

### 3.3 Stroke Width Modeling (`properties.ts`)
Determines line weight multipliers ($w$) calibrated by anatomical prominence:
$$w = w_{\text{base}} \times (0.8 + 0.2 \cdot c) \times (0.85 + 0.15 \cdot I)$$
* **$w_{\text{base}}$ Calibrations:**
  * `silhouette`: $2.42$ (bold framing)
  * `facial_contour` / `body_structure`: $1.98$ (structural grounding)
  * `eye` / `mouth`: $1.76$ (primary focal definition)
  * `eyebrow` / `nose`: $1.60$ (expressive feature line)
  * `ear` / `hair` / `clothing_boundary`: $1.30$ (contour volume)
  * `detail`: $1.00 - 1.20$ (fine accent)
  * `texture` / `background`: $0.90$ (receding context)
* Clamped strictly to $[0.4, 4.0]$.

### 3.4 Detail Density Modeling (`properties.ts`)
Quantifies detail capacity per region $[0.0, 1.0]$:
* `eye`, `mouth`, `nose`: $1.00$ (highest detail focus)
* `eyebrow`, `ear`, `facial_contour`: $0.85$
* `hair`: $0.80$
* `silhouette`: $0.75$
* `body_structure`: $0.70$
* `clothing_boundary`: $0.60$
* `texture`, `detail`: $0.40 - 0.50$
* `background`: $0.20$

### 3.5 Priority Scoring (`properties.ts`)
Calculates objective ranking $P \in [0.0, 1.0]$ for future timeline scheduling:
$$P = 0.40 \cdot I + 0.30 \cdot w_{\text{role}} + 0.20 \cdot c + 0.10 \cdot \min(1.0, 2L)$$
Ranks primary facial features highest, followed by outer contours, secondary features, clothing boundaries, and background textures.

### 3.6 Eligibility Filtering (`filtering.ts`)
Evaluates drawability state (`drawable: boolean`, `filteredReason?: StrokeFilteredReason`):
* **Profile Occlusion:** Features marked `visibility === 'occluded'` or `visibility === 'not_detected'` strictly yield `drawable: false`.
* **Confidence Gate:** $c < \text{minConfidence}$ (default: $0.15$) $\to$ `drawable: false, filteredReason: 'low_confidence'`.
* **Length Gate:** $L < \text{minLength}$ (default: $0.003$) $\to$ `drawable: false, filteredReason: 'too_short'`.
* **Background Suppression:** If `isBackground` and `!config.enableBackground` $\to$ `drawable: false, filteredReason: 'background'`.
* **Geometric Sanitization:** Non-finite or empty coordinates $\to$ `drawable: false, filteredReason: 'invalid_geometry'`.

---

## 4. Benchmark Evaluation (12 Canonical Categories)

Evaluated via `npm run benchmark:strokes` on Node.js v24.16.0 / Windows x64:

| Benchmark ID | Category Description | Stroke Latency | Total Candidates | Drawable Candidates | Filtered Candidates | Avg Arc Length | Avg Importance | Profile Occlusion | Multi-Person Isolation |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `BM-01` | Frontal Portrait | 2.68 ms | 48 | 45 | 3 | 0.216 | 0.72 | N/A | Single Subject |
| `BM-02` | 90° Side Profile | 0.79 ms | 37 | 37 | 0 | 0.168 | 0.69 | **PASS (0 occluded drawable)** | Single Subject |
| `BM-03` | Eyewear Occlusion | 0.85 ms | 54 | 46 | 8 | 0.119 | 0.71 | N/A | Single Subject |
| `BM-04` | Dense Facial Hair | 1.19 ms | 58 | 49 | 9 | 0.179 | 0.71 | N/A | Single Subject |
| `BM-05` | Textured Afro Curls | 1.18 ms | 56 | 54 | 2 | 0.230 | 0.69 | N/A | Single Subject |
| `BM-06` | Extreme Chiaroscuro | 0.88 ms | 50 | 43 | 7 | 0.131 | 0.72 | N/A | Single Subject |
| `BM-07` | Complex Background | 0.76 ms | 59 | 57 | 2 | 0.243 | 0.72 | N/A | Single Subject |
| `BM-08` | Low-Light Selfie | 1.24 ms | 58 | 48 | 10 | 0.139 | 0.69 | N/A | Single Subject |
| `BM-09` | Full Body Standing | 1.92 ms | 59 | 55 | 4 | 0.209 | 0.69 | N/A | Skeletal Articulation |
| `BM-10` | Full Body Sitting | 0.37 ms | 51 | 42 | 9 | 0.140 | 0.71 | N/A | Skeletal Articulation |
| `BM-11` | Multi-Person Group | 0.57 ms | 51 | 50 | 1 | 0.182 | 0.71 | N/A | **PASS (Independent subjectIds)** |
| `BM-12` | High-Resolution Master | 0.35 ms | 57 | 54 | 3 | 0.193 | 0.71 | N/A | Single Subject |
| **AVERAGE** | — | **1.06 ms** | **53.2** | **48.3** | **4.8** | **0.1790** | **0.71** | **100% Pass** | **100% Isolated** |

### Key Benchmark Findings
1. **Exceptional Latency SLA:** Candidate generation executes in **1.06 ms** on average, consuming ~2% of the 50 ms budget.
2. **Safe Scaling & Zero Stroke Explosion:** Maximum candidate count across all 12 challenging categories is bounded at **59 strokes** (average: 53.2 total, 48.3 drawable).
3. **Strict Profile Occlusion (`BM-02`):** Zero strokes are generated or marked drawable for occluded far-side eyes, eyebrows, or ears.
4. **Multi-Person Cohesion (`BM-11`):** Distinct subject IDs are strictly maintained across candidates, preventing cross-subject stroke merging.
5. **Memory Boundedness:** Heap memory delta remained at **56.81 MB** across the entire 12-image batch run.

---

## 5. Automated Verification Summary

1. **Unit Tests (`tests/stroke-engine/stroke-candidate.test.ts`):** 18/18 tests pass in 12ms covering contracts, validation, eligibility filtering, profile occlusion, semantic roles, width/density calculations, path partitioning, multi-subject isolation, determinism, and pure TypeScript compliance.
2. **Monorepo Test Suite (`npm test`):** 224+ tests pass across all packages with zero regressions.
3. **Typecheck (`npm run typecheck`):** 0 errors across all 8 workspaces.
4. **Production Build (`npm run build`):** Builds cleanly in 1.58s with lazy vision chunk isolation (`dist/assets/vision_bundle-*.js`).
