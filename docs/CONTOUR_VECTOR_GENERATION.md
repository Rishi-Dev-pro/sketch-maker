# CONTOUR_VECTOR_GENERATION.md — TASK-104 Technical Specification & Evaluation

## 1. Overview & Architectural Role

`TASK-104 (Contour & Vector Generation)` bridges Phase 1 perception (`SubjectModel`, facial landmarks, body pose skeleton, semantic segmentation masks, silhouette, hair) and downstream stroke animation/rendering (`TASK-105+`).

```text
SubjectModel (Perception IR)
  ├── Facial Features (eyes, eyebrows, nose, mouth, jawline, ears)
  ├── Body Pose (33 landmarks, skeletal connections)
  ├── Semantic Segmentation (face, hair, clothing, body skin)
  └── Subject Silhouette Mask (TASK-102 deterministic / hybrid)
                    │
                    ▼
       packages/stroke-engine/src/geometry/
  ├── cleaning.ts           (clamping, NaN/dup/spike/collinear filtering)
  ├── simplification.ts     (adaptive Ramer-Douglas-Peucker reduction)
  ├── curves.ts             (cubic Catmull-Rom Bézier spline fitting)
  ├── mask-contours.ts      (Moore-neighborhood boundary tracing)
  ├── importance.ts         (multi-cue deterministic importance model)
  └── extractor.ts          (unified VectorGeometry generation)
                    │
                    ▼
VectorGeometry (Canonical Resolution-Independent Geometry IR)
  ├── paths: VectorPath[]   (raw evidence, simplified polylines, Bézier curves)
  ├── metrics: GeometryMetrics (counts, arc lengths, reductions, timing)
  └── bounds: BoundingBox   ([0.0, 1.0] normalized coordinate space)
```

### Strict Architectural Boundaries
1. **Zero Browser/DOM Globals:** Core packages (`packages/shared-types`, `packages/stroke-engine`) contain zero references to `window`, `document`, HTMLCanvasElement, CanvasRenderingContext2D, or SVG DOM elements.
2. **Evidence Preservation:** Raw perception points are strictly preserved in `rawPoints: Point2D[]`. Simplification produces `points: Point2D[]` and `curves: BezierCurve[]` without mutating the underlying perception evidence.
3. **No Stroke Generation/Animation:** Vector generation extracts pure geometric topology. Stroke width modeling, drawing order, brush textures, progressive reveals, and canvas rendering strictly belong to TASK-105+.

---

## 2. Canonical Data Contracts (`packages/shared-types/src/vector.ts`)

```typescript
export type GeometrySource =
  | 'face_landmark'
  | 'jawline'
  | 'ear'
  | 'hair'
  | 'pose_connection'
  | 'semantic_mask'
  | 'silhouette'
  | 'fallback_edge';

export type PathHierarchyLevel =
  | 'primary_structural'   // Eyes, nose apex, oral fissure (highest fidelity)
  | 'secondary_expressive'  // Eyebrows, lip margins, ear contours
  | 'anatomical_gesture'    // Skeletal pose connections, jawline
  | 'boundary_contour'      // Silhouette, hair outer boundary, clothing masks
  | 'tertiary_texture';     // Subtle folds, secondary contours

export interface VectorPath {
  id: string;
  source: GeometrySource;
  level: PathHierarchyLevel;
  subjectId: string;
  featureName: string;
  points: Point2D[];            // Simplified polyline (RDP)
  rawPoints: Point2D[];         // Unmodified input perception points
  curves?: BezierCurve[];       // Fitted cubic Bézier segments
  isClosed: boolean;
  confidence: number;           // [0.0, 1.0]
  visibility: LandmarkVisibility;
  importance: number;           // [0.0, 1.0] calculated sorting weight
  bounds: BoundingBox;
  arcLength: number;            // Cumulative normalized length
}

export interface GeometryMetrics {
  totalPaths: number;
  totalRawPoints: number;
  totalSimplifiedPoints: number;
  reductionPercentage: number;
  extractionLatencyMs: number;
}

export interface VectorGeometry {
  paths: VectorPath[];
  bounds: BoundingBox;
  metrics: GeometryMetrics;
}
```

---

## 3. Geometric Processing Pipeline

### 3.1 Point Cleaning & Normalization (`cleaning.ts`)
Raw points from perception backends may contain floating-point anomalies, duplicated coordinates, out-of-bounds projections, or gradient noise.
* **Coordinate Clamping:** Every point is clamped strictly to $[0.0, 1.0]$.
* **Sanitization:** Rejects `NaN`, `Infinity`, and negative infinity coordinates.
* **Deduplication:** Filters out consecutive duplicate points within $\epsilon = 10^{-5}$.
* **Spike Filtering:** Identifies acute angle spikes where a single intermediate vertex jumps away from neighbors ($d > 0.35$) while the baseline distance between neighbors is small ($d < 0.35$).
* **Collinear Reduction:** Prunes redundant intermediate collinear points using the triangle area cross-product formula ($\text{area} < 10^{-7}$).

### 3.2 Adaptive Ramer-Douglas-Peucker Simplification (`simplification.ts`)
The RDP algorithm reduces dense polyline points to their salient geometric inflection points while preserving topological fidelity.

Tolerances are adaptively configured per hierarchy level:
* **`primary_structural`:** $\epsilon = 0.0015$ (Preserves intricate eyelid curves and nasal apex).
* **`secondary_expressive`:** $\epsilon = 0.0025$ (Smooths eyebrow arches and ear helix rim).
* **`anatomical_gesture`:** $\epsilon = 0.0035$ (Streamlines long skeletal limb segments).
* **`boundary_contour`:** $\epsilon = 0.0040$ (Removes staircase pixelation from raster segmentation masks).
* **`tertiary_texture`:** $\epsilon = 0.0050$ (Aggressively simplifies micro-details).

**Topological Safety Guarantees:**
* Open paths preserve exact start and end vertices ($P_0$ and $P_n$).
* Closed contours cannot collapse into single lines or points (requires $\ge 3$ vertices).

### 3.3 Smooth Cubic Bézier Curve Fitting (`curves.ts`)
Converts discrete polylines into continuous parametric cubic Bézier curves:
$$B(t) = (1-t)^3 P_0 + 3(1-t)^2 t C_0 + 3(1-t) t^2 C_1 + t^3 P_1, \quad t \in [0, 1]$$

* **Tangent Derivation:** Uses Catmull-Rom centripetal tangents scaled by chord length:
  $$\vec{t}_i = \frac{P_{i+1} - P_{i-1}}{2}, \quad C_{0, i} = P_i + \frac{\vec{t}_i}{3}, \quad C_{1, i} = P_{i+1} - \frac{\vec{t}_{i+1}}{3}$$
* **Overshoot Suppression:** Control point displacements are clamped so $\|C_0 - P_0\| \le 0.4 \times \|P_1 - P_0\|$, preventing unwanted looping or acute corner ballooning.
* **Closed Loop Wrapping:** Tangents at the seam vertex wrap smoothly between $P_n$ and $P_1$.

### 3.4 Boundary Following from Raster Masks (`mask-contours.ts`)
Extracts smooth vector boundaries from raster segmentation masks:
* **Grid Sampling:** Uses configurable sampling step (default: 4px) to balance extraction speed and boundary resolution.
* **Moore-Neighborhood Boundary Tracing:** Traces 8-connected external boundaries clockwise.
* **Area Filtering:** Rejects isolated speckles and noise islands whose bounding box area is $< 0.001$.

### 3.5 Deterministic Semantic Importance Model (`importance.ts`)
Downstream stroke animation (`TASK-105`) requires sorting paths from essential structural landmarks to secondary silhouettes. The importance score $I \in [0.0, 1.0]$ is computed deterministically:

$$I = 0.45 \times w_{\text{semantic}} + 0.25 \times c + 0.15 \times v + 0.15 \times s$$

Where:
* **$w_{\text{semantic}}$ (Semantic Weight):**
  * `primary_structural`: $1.00$ (Eyes, nose apex, mouth fissure)
  * `secondary_expressive`: $0.80$ (Eyebrows, lips, ears)
  * `anatomical_gesture`: $0.65$ (Pose limbs, jawline)
  * `boundary_contour`: $0.45$ (Silhouette, clothing masks)
  * `tertiary_texture`: $0.25$ (Internal folds, micro-edges)
* **$c$ (Confidence):** Normalized detector confidence $[0.0, 1.0]$.
* **$v$ (Visibility):** `visible` ($1.0$), `uncertain` ($0.5$), `occluded` ($0.0$).
* **$s$ (Scale Factor):** Normalized arc length clamped to $[0.0, 1.0]$ ($s = \min(1.0, L \times 1.5)$).

---

## 4. Benchmark Evaluation (12 Canonical Categories)

Tested via `npm run benchmark:geometry` on Node.js v24.16.0 / Windows x64:

| Benchmark ID | Geometry Latency | Vector Paths | Raw Points | Simplified Points | Point Reduction | Profile Occlusion | Multi-Person Isolation |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `BM-01-FRONT-PORTRAIT` | 6.49 ms | 20 | 3,373 | 398 | **88.2%** | N/A | Single Subject |
| `BM-02-SIDE-PROFILE` | 1.33 ms | 12 | 1,425 | 215 | **84.9%** | **PASS (0 hidden paths)** | Single Subject |
| `BM-03-GLASSES` | 2.32 ms | 16 | 1,954 | 337 | **82.8%** | N/A | Single Subject |
| `BM-04-FACIAL-HAIR` | 3.48 ms | 20 | 3,644 | 738 | **79.8%** | N/A | Single Subject |
| `BM-05-HAIR-VARIETY` | 1.54 ms | 18 | 3,071 | 622 | **79.8%** | N/A | Single Subject |
| `BM-06-EXTREME-LIGHTING` | 1.61 ms | 13 | 1,937 | 331 | **82.9%** | N/A | Single Subject |
| `BM-07-COMPLEX-BACKGROUND` | 2.24 ms | 21 | 5,772 | 892 | **84.6%** | N/A | Single Subject |
| `BM-08-LOW-LIGHT` | 1.42 ms | 21 | 3,136 | 547 | **82.6%** | N/A | Single Subject |
| `BM-09-FULL-BODY-STANDING` | 0.91 ms | 21 | 2,573 | 603 | **76.6%** | N/A | Skeletal Articulation |
| `BM-10-FULL-BODY-SITTING` | 0.57 ms | 20 | 1,484 | 337 | **77.3%** | N/A | Skeletal Articulation |
| `BM-11-MULTI-PERSON` | 0.61 ms | 20 | 2,589 | 478 | **81.5%** | N/A | **PASS (Distinct subjectIds)** |
| `BM-12-HIGH-RES` | 1.23 ms | 19 | 3,102 | 670 | **78.4%** | N/A | Single Subject |
| **AVERAGE** | **1.98 ms** | **18.4** | **2,838.3** | **514.0** | **81.6%** | **100% Occlusion Pass** | **100% Subject Isolation** |

### Performance SLA Compliance
* **Latency Budget:** Average **1.98 ms** vs. < 50.0 ms target (**96.0% below SLA ceiling**).
* **Data Reduction:** Average **81.6% point reduction** (from 2,838 down to 514 clean, salient points per subject) while preserving visual fidelity.
* **Peak Memory Usage:** Total heap remained bounded at **~79.92 MB** during complete 12-image batch execution.
* **Profile Occlusion Guarantee:** On `BM-02` (90° side profile), all occluded far-side ocular, brow, nasal, and auricular features produce strictly **0 paths**.
* **Multi-Subject Separation:** On `BM-11` (Multi-person), paths are cleanly partitioned with distinct `subjectId` attributes.

---

## 5. Automated Verification Summary

1. **Unit Tests:** `tests/stroke-engine/geometry.test.ts` (20/20 passing)
   * Coordinate cleaning, NaN sanitization, deduplication, spike rejection, collinear reduction
   * RDP simplification across hierarchy levels and tolerance scaling
   * Open endpoint retention and closed loop non-collapsing guarantees
   * Cubic Bézier fitting, Catmull-Rom tangent alignment, overshoot suppression
   * Moore-neighborhood boundary extraction from binary/semantic masks
   * Deterministic importance calculation and ranking ordering
   * Profile occlusion filtering (`BM-02`) and multi-subject isolation (`BM-11`)
   * Pure TypeScript verification (zero `window`, `document`, canvas references)
2. **Monorepo Test Suite:** 206+ total tests passing across all packages.
3. **Typecheck:** 0 errors across all 8 workspaces (`npm run typecheck`).
4. **Production Build:** Vite production bundle succeeds in 1.52s.
