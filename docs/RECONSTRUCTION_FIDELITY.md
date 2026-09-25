# TASK-110: Artistic Reconstruction Fidelity Recovery

## Executive Summary

TASK-110 resolves the fundamental structural fidelity deficit in the Photo-to-Procedural-Art pipeline.

Prior to TASK-110, raw perception evidence (landmarks, segmentation masks, contours) was mapped directly into vector geometry. Because perception evidence is fundamentally not artwork, photographic likeness was lost at three key bottlenecks:
1. Single landmark points (nose tip, chin apex) were dropped by polyline vector extraction (`points.length >= 2`).
2. Volumetric anatomical features (eyebrow hair masses, eyelid creases, iris/pupil discs) were flattened into 1D wire contours.
3. Raw segmentation masks (spiky staircase loops from 256x256 segmentation) generated dozens of distracting noise strokes that crowded out facial anatomy.

TASK-110 institutes an explicit **Feature Reconstruction & Interpretation Layer** between Perception and Vector Extraction, governed by the foundational maxim:

> *"Perception evidence is not automatically artwork."*

---

## Architectural Position

```text
┌────────────────────────────────────────────────────────┐
│ 1. Perception & Structural Analysis                   │
│    (Deterministic CV / MediaPipe ML / Hybrid Reconciled)│
└───────────────────────────┬────────────────────────────┘
                            │ Raw SubjectModel
                            ▼
┌────────────────────────────────────────────────────────┐
│ 2. Feature Reconstruction & Interpretation (TASK-110)  │
│    ├── Face Reconstructor (Eyes, Brows, Nose, Mouth, Jaw)│
│    ├── Hair Reconstructor (Silhouette, Masses, Flow)    │
│    ├── Body Reconstructor (Bilateral Neck, Shoulders)  │
│    ├── Semantic Boundary Relevance Filter               │
│    └── 19-Feature Coverage Reporter                     │
└───────────────────────────┬────────────────────────────┘
                            │ SubjectModel + ArtisticReconstruction
                            ▼
┌────────────────────────────────────────────────────────┐
│ 3. Contour & Vector Generation (TASK-104)              │
│    (Polyline Cleaning, Adaptive RDP, Catmull-Rom Bézier)│
└───────────────────────────┬────────────────────────────┘
                            │ VectorGeometry
                            ▼
┌────────────────────────────────────────────────────────┐
│ 4. Procedural Stroke Candidate Generation (TASK-105)   │
│    (Curvature Partitioning, Importance Scoring)        │
└───────────────────────────┬────────────────────────────┘
                            │ StrokeCandidateSet
                            ▼
┌────────────────────────────────────────────────────────┐
│ 5. Stroke Ordering & Composition (TASK-106)            │
│    (6 Composition Phases, Hierarchy Scheduling)        │
└───────────────────────────┬────────────────────────────┘
                            │ OrderedStrokeSequence
                            ▼
┌────────────────────────────────────────────────────────┐
│ 6. Progressive Stroke Timeline (TASK-107)              │
│    (Physical Duration, Overlap Ratio, Normalized Time) │
└───────────────────────────┬────────────────────────────┘
                            │ StrokeTimeline
                            ▼
┌────────────────────────────────────────────────────────┐
│ 7. Procedural Stroke Renderer (TASK-108)               │
│    (De Casteljau Bézier Trimming, Arc-Length Polyline) │
└───────────────────────────┬────────────────────────────┘
                            │ RenderState
                            ▼
┌────────────────────────────────────────────────────────┐
│ 8. Procedural Style Engine (TASK-109)                  │
│    (Color Presets, Semantics, Glow, Line Weight)       │
└───────────────────────────┬────────────────────────────┘
                            │ StyledRenderState
                            ▼
┌────────────────────────────────────────────────────────┐
│ 9. Progressive Canvas Presentation                     │
│    (Generated-Only mode, Clean White/Dark/Transparent) │
└────────────────────────────────────────────────────────┘
```

---

## The 19 Core Anatomical Features

| Feature ID | Category | Reconstructed Structure | Importance Score |
| :--- | :--- | :--- | :--- |
| `leftEye` | Eye | Upper lid, lower lid, supratarsal crease, iris crescent, pupil disc, canthus corners | 0.95 |
| `rightEye` | Eye | Upper lid, lower lid, supratarsal crease, iris crescent, pupil disc, canthus corners | 0.95 |
| `leftEyebrow` | Eyebrow | Primary arch, medial head mass, lateral tapered tail, volumetric upper/lower boundaries | 0.88 |
| `rightEyebrow` | Eyebrow | Primary arch, medial head mass, lateral tapered tail, volumetric upper/lower boundaries | 0.88 |
| `noseBridge` | Nose | Dorsum nasal ridge line | 0.82 |
| `noseTip` | Nose | Multi-point convex apex dome curve (never a single dropped point) | 0.90 |
| `nostrils` | Nose | Columella under-nose shadow shelf + left/right alar wing curves | 0.85 |
| `upperLip` | Mouth | Vermilion boundary with pronounced Cupid's bow contour | 0.92 |
| `lowerLip` | Mouth | Vermilion boundary curve + lower lip fullness highlight | 0.90 |
| `mouthCorners` | Mouth | Oral fissure central seam + bilateral commissure tick marks | 0.94 |
| `jaw` | Jaw & Chin | Bilateral mandibular curves converging to chin in frontal, anterior contour in profile | 0.80 |
| `chin` | Jaw & Chin | Distinct 3-point chin apex dome + sub-labial mental crease | 0.85 |
| `leftEar` | Ear | Helical outer rim + antihelix / conchal bowl hollow curve | 0.75 |
| `rightEar` | Ear | Helical outer rim + antihelix / conchal bowl hollow curve | 0.75 |
| `hairSilhouette`| Hair | Anti-aliased outer silhouette smoothed with low-pass Gaussian filter | 0.85 |
| `hairMasses` | Hair | Major volumetric locks/masses derived from luminance gradient valleys | 0.80 |
| `hairFlow` | Hair | Dominant directional flow streamlines following hair growth | 0.70 |
| `neck` | Body | Bilateral sternocleidomastoid curves connecting jaw to collar | 0.75 |
| `shoulders` | Body | Organic curved shoulder lines with natural anatomical drop | 0.78 |
| `clothing` | Body | Filtered collar curves and prominent garment structural seams | 0.65 |

---

## Semantic Boundary Relevance Filtering

Raw segmentation masks suffer from two major visual flaws:
1. Spiky staircase pixel artifacts.
2. An explosion of micro-loops that overwhelm the stroke budget (e.g. 50+ tiny clothing/skin blobs).

The `SemanticBoundaryFilter` applies strict relevance criteria:
- **Area Threshold**: Polygons below `0.004` normalized area are classified as micro-speckle noise and discarded.
- **Vertex Count**: Loops with fewer than 6 vertices are rejected as degenerate.
- **Redundancy Suppression**:
  - `hair` segmentation loops are discarded because hair structure is provided by the Hair Reconstructor.
  - `face_skin` loops are discarded because face contours are provided by the Face Reconstructor.
- **Quota Cap**: Maximum 2 loops per category to prevent background clutter from crowding out focal facial anatomy.

---

## Generated-Only Render Mode

A dedicated `generatedOnly` render mode allows evaluation of procedural artwork purely on the strength of its generated strokes:
- Strictly suppresses photograph underlay / background blending.
- Supports Solid White (`#ffffff`), Solid Dark (`#0a0b10`), and Transparent Checkerboard backgrounds.
- Verified in `apps/web/src/rendering/canvas-renderer.ts` and interactive web controls.

---

## 12-Image Benchmark Verification

Benchmark script: `tests/benchmarks/reconstruction-benchmark.ts` (`npm run benchmark:reconstruction`).

```text
ID    | Category            | Recon | Vectors | Strokes (Drw) | Face Cov | Total Cov | Meaningful | Latency  | Checks
------|---------------------|-------|---------|---------------|----------|-----------|------------|----------|-------
BM-01 | portrait_neutral    |    47 |      43 |         33/65 |      83% |       80% |       100% |  353.1ms | PASS
BM-02 | portrait_profile    |    27 |      25 |         11/39 |      30% |       59% |       100% |  271.5ms | PASS
BM-03 | occlusion_eyewear   |    36 |      32 |         24/55 |      33% |       50% |       100% |  224.1ms | PASS
BM-04 | texture_facial_hair |    47 |      43 |         21/68 |      83% |       80% |       100% |  355.0ms | PASS
BM-05 | texture_hair        |    43 |      39 |         36/64 |      58% |       70% |       100% |  333.2ms | PASS
BM-06 | lighting_hdr        |    31 |      29 |         13/50 |      33% |       50% |       100% |  292.1ms | PASS
BM-07 | segmentation_clutter|    47 |      43 |         37/69 |      83% |       80% |       100% |  279.1ms | PASS
BM-08 | noise_low_light     |    47 |      43 |         17/66 |      83% |       80% |       100% |  296.4ms | PASS
BM-09 | pose_full_standing  |    49 |      45 |         33/67 |      83% |       85% |       100% |  322.1ms | PASS
BM-10 | pose_full_sitting   |    47 |      43 |         19/64 |      83% |       80% |       100% |  207.8ms | PASS
BM-11 | multi_subject       |    47 |      43 |         41/61 |      83% |       80% |       100% |  239.7ms | PASS
BM-12 | performance_scale   |    42 |      40 |         32/65 |      83% |       80% |       100% |  261.1ms | PASS
```

- **Average Facial Feature Coverage**: 68% (83% on unoccluded frontal portraits).
- **Average Overall Structural Coverage**: 73%.
- **Meaningful Stroke Ratio**: 100% (raw noisy mask loops eliminated).
- **BM-02 Profile Occlusion**: PASS (hidden eye, eyebrow, ear marked occluded; no phantom strokes fabricated).
- **BM-11 Multi-Person Isolation**: PASS (distinct subject IDs preserved).
- **Average End-to-End Latency**: 286.3 ms.
