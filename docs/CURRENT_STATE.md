# CURRENT_STATE.md

## Project State Snapshot

* **Current Date / Time:** 2026-09-19
* **Current Phase:** Phase 1 — Feasibility Prototype (Headless Photo → Strokes Pipeline)
* **Current Version:** v0.3.18-alpha (TASK-107 Progressive Stroke Timeline & Animation Scheduling Complete)
* **Current Milestone:** M1 — Feasibility Prototype (Headless Pipeline)
* **Status:** IN_PROGRESS (TASK-107 Progressive Stroke Timeline & Animation Scheduling Complete)

---

## 1. Where Exactly Are We Right Now?
Phase 1 pipeline is advancing through structural analysis:
1. **`packages/image-processing` (TASK-101):** Fully implemented, verified with 10 unit tests, and benchmarked across all 12 benchmark categories (68.7ms average latency; 24MP downsampling in 240.3ms).
2. **`packages/structural-analysis` Segmentation (TASK-102):** Implemented multi-cue perceptual saliency & gradient-barrier segmentation with zero external model dependencies (`ADR-008`). Evaluated across all 12 benchmark categories with an average latency of **239.7 ms** (combined pipeline latency: **308.4 ms**, well below the 1500 ms SLA target). Peak heap RAM remained bounded at **~24.5 MB**.
3. **TASK-103 Step 1 & Step 1.1 (Face Region Isolation & Pose Robustness Correction):** Implemented `estimateFaceRegion` and `estimateAllFaceRegions` (`packages/structural-analysis/src/face-region.ts`) with a multi-cue geometric evidence model. Decoupled facial geometry from appearance chrominance; isolated head coordinate frame from torso/chest contamination (`BM-02` true profile: `left_profile`, conf 0.62); decoupled illumination shadow from profile yaw (`BM-06` chiaroscuro: `frontal`, conf 0.78). Average latency: 14.45 ms.
4. **TASK-103 Step 2A (Eye & Eyelid Landmark Detection):** Implemented `detectEyeLandmarks` (`packages/structural-analysis/src/eyes.ts`) with multi-cue ocular search (luminance valleys, lateral sclera-iris contrast, horizontal Sobel edge energy, upper/lower eyelid margin tracing, and evidence-dependent iris/pupil resolution). Strictly enforces pose-driven visibility: profile occluded eyes (`BM-02`) are marked `'occluded'` with confidence 0 and 0 points without hallucinating coordinates. Average extraction latency: **1.17 ms**. Visual inspection report: `tests/artifacts/eye-report.html`.
5. **TASK-103 Step 2B (Eyebrow Landmark Detection & Quality Audit):** Implemented `detectEyebrows` (`packages/structural-analysis/src/eyebrows.ts`) using supraorbital ridge dynamic programming, directional edge gradients, and valley contrast. Enforces strict eyelid/glasses separation constraints. Profile hidden eyebrows are strictly marked `'occluded'` with confidence 0 and 0 points (`BM-02`). Average extraction latency: **3.06 ms - 3.62 ms**. Visual inspection report: `tests/artifacts/eyebrow-report.html`.
6. **TASK-103 Step 2C (Nose Landmark Detection):** Implemented `detectNose` (`packages/structural-analysis/src/nose.ts`) with multi-cue structural evidence: vertical dynamic programming ridge tracing along nasal dorsum, tip dome localization, and alar/nostril boundary extraction with radial contrast analysis. Enforces glasses-frame avoidance (`BM-03`) and mustache boundary separation (`BM-04`). Profile hidden nostril (`BM-02`) is strictly marked `'occluded'` with confidence 0 and 0 points. Average extraction latency: **3.23 ms**. Visual inspection report: `tests/artifacts/nose-report.html`.
7. **TASK-103 Step 2D (Mouth & Lips Landmark Detection):** Implemented `detectMouth` (`packages/structural-analysis/src/mouth.ts`) using horizontal dynamic programming for oral fissure (stomion seam) extraction with bilateral valley contrast, subnasal/ocular anchoring, vermilion border tracing for upper/lower lips, and oral commissure (corner) detection. Mustache/beard step edges are rejected via bilateral valley contrast. Glasses frame and shadow false positives are eliminated. Profile hidden corners are strictly suppressed without hallucination. Average extraction latency: **6.72 ms** (cumulative facial landmark latency ≈29ms, peak heap ≈24.5MB). Visual inspection report: `tests/artifacts/mouth-report.html`.
8. **TASK-103 Step 2E.1 (Jawline & Outer Facial Contour Detection):** Implemented `detectJawline` (`packages/structural-analysis/src/jawline.ts`) deriving outer facial geometry from subject silhouette (`SubjectMask`) and face region geometry with local Sobel gradient edge alignment. In frontal/three-quarter poses, tracks mandibular convergence toward the chin apex and detects shoulder/neck expansion to terminate before clothing collars (`BM-09`, `BM-10`). In profile poses (`BM-02`), preserves visible anterior facial contour (glabella $\to$ nose $\to$ lips $\to$ chin $\to$ submental line) and strictly suppresses occluded hidden-side jaw geometry. In heavy beards (`BM-04`), signals `uncertain` without hallucinating phantom bone lines. Average extraction latency: **1.16 ms**. Visual inspection report: `tests/artifacts/jawline-report.html`.
9. **TASK-103 Step 2E.2 (Ear Landmark & Contour Detection):** Implemented `detectEars` (`packages/structural-analysis/src/ears.ts`) detecting visible anatomical ear structure (helix rim, conchal hollow contrast) and pose-conditioned visibility. For frontal and three-quarter faces, evaluates left and right ears independently; strictly rejects hair curls, glasses temples, and straight silhouette edges via sustained protrusion, curvature analysis, and hair luminance profiling. In side profiles (`BM-02`), detects the visible posterior pinna and strictly suppresses the hidden far-side ear without fabricating mirrored geometry. Average extraction latency: **2.85 ms** (cumulative facial analysis latency ≈33ms, peak heap ≈24.5MB). Visual inspection report: `tests/artifacts/ear-report.html`.
10. **TASK-103 Step 2F (Hair Structure Detection):** Implemented `detectHair` (`packages/structural-analysis/src/hair.ts`) extracting outer hair silhouette and hairline boundary. Average extraction latency: **4.1ms**.
11. **TASK-103.5 (Pretrained Vision Backend Evaluation):** Evaluated MediaPipe Tasks Vision vs. ONNX Runtime Web vs. deterministic baseline. Decision report in `docs/VISION_BACKEND_EVALUATION.md`. Recommended Architecture: **Option C (Hybrid Architecture)**.
12. **TASK-103.6 (Vision Provider Architecture):** Designed and implemented the decoupled provider abstraction (`VisionProvider`, `VisionCoordinator`, `DeterministicVisionProvider`, `MediaPipeVisionProvider`, `VisionResult`). Guarantees zero-download offline fallback, preserves Universal `SubjectModel` as the common IR, and establishes evidence-aware hybrid merge rules. 14/14 automated unit tests pass.
13. **TASK-103.7 (MediaPipe Face Landmarker Integration):** Implemented `MediaPipeWebDelegate` in `apps/web/src/vision/mediapipe/`, isolated via Vite lazy chunking (`dist/assets/vision_bundle-*.js`, 136 kB). Canonical 478-landmark mapper clamps coordinates to `[0.0, 1.0]`, enforces strict profile occlusion (`BM-02`), and prevents ear fabrication. In hybrid mode, `VisionCoordinator` reconciles MediaPipe facial landmarks with deterministic ear pinna and hair contours. 7/7 mapper tests pass; monorepo builds and typechecks cleanly with 0 errors.
14. **TASK-103.8 (MediaPipe Pose Landmarker Integration):** Extended canonical contracts in `packages/shared-types` (`PoseLandmark`, `PoseConnection`, `BodyPose`, `BodyFeatures.pose`). Implemented `pose-mapper.ts` (33-point BlazePose normalized mapping, synthesized neck midpoint, skeletal connections, visibility classification) and `face-pose-associator.ts` (spatial proximity matching $d < 0.25$ for unified `SubjectModel`s, multi-subject handling for `BM-11`). Generalized `MediaPipeWebDelegate` with shared `FilesetResolver`. Vite chunking keeps ML isolated in `vision_bundle` (220 kB), initial page bundle reduced to 172 kB. 12/12 pose mapper unit tests pass; monorepo tests pass (174+ tests); 0 TypeScript errors across 8 workspaces.
15. **TASK-103.9 (MediaPipe Image Segmenter Integration):** Extended canonical contracts in `packages/shared-types` (`SemanticCategory`, `SemanticMask`, `SemanticSegmentation`, `SubjectModel.semanticSegmentation`). Implemented `segmenter-mapper.ts` (discrete 6-class mapping, nearest-neighbor category resampling, bilinear continuous confidence map interpolation) and `segmentation-reconciler.ts` (evidence-aware hybrid reconciliation between ML semantic masks and TASK-102 deterministic masks). Extended `MediaPipeWebDelegate` with shared `FilesetResolver` and lazy loading of `selfie_multiclass_256x256.tflite` (16.37 MB). Vite chunking keeps ML isolated in `vision_bundle` (226.18 kB), initial page bundle is 177.93 kB. 12/12 segmenter unit tests pass; monorepo tests pass (186+ tests); 0 TypeScript errors across 8 workspaces.
16. **TASK-104 (Contour & Vector Generation):** Implemented canonical vector geometry IR (`VectorGeometry`, `VectorPath`, `GeometryMetrics`) in `packages/shared-types/src/vector.ts` and full geometry engine in `packages/stroke-engine/src/geometry/` (cleaning, clamping, spike/collinear reduction, adaptive RDP simplification across hierarchy levels, Catmull-Rom cubic Bézier fitting with overshoot clamp, Moore-neighborhood mask boundary following, and deterministic multi-cue importance scoring: $I = 0.45 w_{\text{semantic}} + 0.25 c + 0.15 v + 0.15 s$). Profile occlusion strictly suppresses occluded side features (`BM-02`); multi-subject isolation cleanly tags paths by `subjectId` (`BM-11`). 20/20 unit tests pass; 12-category benchmark passes (average latency **1.98 ms** vs < 50ms SLA, **81.6% point reduction** from 2,838 to 514 clean points). Interactive UI audit and visualization verified in `apps/web`.
17. **TASK-105 (Procedural Stroke Candidate Generation):** Implemented platform-independent stroke candidate generation IR (`StrokeCandidate`, `StrokeCandidateSet`, `StrokeMetrics`, `StrokeSemanticRole`, `StrokeFilteredReason`) in `packages/shared-types/src/stroke.ts` and generator in `packages/stroke-engine/src/candidates/` (semantic role derivation, protected structural anatomical paths, curvature/length gesture partitioning, deterministic stroke width/density models, composite priority scoring $P = 0.4I + 0.3w_{\text{role}} + 0.2c + 0.1\min(1, 2L)$, profile occlusion filtering, and bounded candidate caps preventing stroke explosion). 18/18 unit tests pass; 12-category benchmark passes (average latency **1.06 ms** vs < 50ms SLA target, average **53.2** candidates per subject, max **59**). Interactive UI audit and canvas preview verified in `apps/web`.
18. **TASK-106 (Stroke Ordering & Composition):** Implemented progressive stroke ordering IR (`OrderedStroke`, `OrderedStrokeSequence`, `CompositionPhase`, `StrokeOrderingMetrics`) in `packages/shared-types/src/stroke.ts` and ordering engine in `packages/stroke-engine/src/ordering/` (6-phase composition model, structural dependency graph, multi-factor deterministic comparator, non-destructive sequence wrapper, contiguous 0-based indexing, strict profile occlusion suppression for `BM-02`, and harmonized multi-subject phase interleaving for `BM-11`). 17/17 unit tests pass; 12-category benchmark passes (average latency **1.19 ms** vs < 10ms SLA target, 100% sequence validity, 0 index gaps, 0 duplicates). Interactive UI audit and canvas color-coded progressive visualization verified in `apps/web`.
19. **TASK-107 (Progressive Stroke Timeline & Animation Scheduling):** Implemented progressive timeline contracts (`TimelineStroke`, `StrokeTimeline`, `TimelineConfig`, `TimelineState`, `TimelineMetrics`) in `packages/shared-types/src/timeline.ts` and scheduling engine in `packages/stroke-engine/src/timeline/` (physical duration model based on arc length and salience, phase-specific multipliers, controlled overlap with phase boundary damping, dependency-aware start offset constraints, target duration normalization, pure math easing curves, and pure $O(N)$ real-time query/scrub API). 17/17 unit tests pass; 12-category benchmark passes (average latency **0.54 ms** vs < 10ms SLA, average query latency **20.2 µs**, 100% temporal validity, 0 occluded timeline strokes, independent multi-person preservation). Interactive UI scrubber, active tip glow, and audit cards verified in `apps/web`.
20. **Automated Verification:** All test suites pass (258+ monorepo tests), all 8 monorepo workspaces typecheck cleanly with 0 errors, and client production build succeeds in ~2.3s.
21. **Stop Condition:** TASK-107 complete. Awaiting user direction before next task (TASK-108).

---

## 2. Completed Items
* [x] **TASK-000:** Project Planning Specification Ingestion (100% extracted).
* [x] **TASK-001:** Persistent Documentation Structure (`docs/*` created with 11 core documents).
* [x] **TASK-002:** Initial Repository Audit & User Direction Alignment.
* [x] **TASK-003:** Git repository and `.gitignore` initialized and committed (`058e8fc`). Connected to remote origin (`https://github.com/Rishi-Dev-pro/sketch-maker.git`). Primary development branch set to `main` (tracking `origin/main`), with historical `master` branch preserved.
* [x] **TASK-004:** Monorepo scaffolding & package workspace structure (`packages/*`, `apps/web`, `tsconfig.base.json`, `npm install` executed, workspaces linked).
* [x] **TASK-005:** Core data contracts defined in `packages/shared-types` (`geometry.ts`, `subject.ts`, `stroke.ts`, `style.ts`, `pipeline.ts`, `index.ts`).
* [x] **TASK-006:** Curate initial benchmark image dataset (`tests/images/*`, `tests/images/dataset.json`, `tests/images/README.md`, automated validator `tests/images/validate.js`, `npm run test:dataset` 12/12 passing).
* [x] **TASK-101:** Image preprocessing & normalization module (`packages/image-processing/*`, `tests/image-processing/*`, 10/10 unit tests, 12/12 benchmark images evaluated, 24MP downsampling verified).
* [x] **TASK-102:** Initial subject segmentation / background separation (`packages/structural-analysis/segmentation.ts`, `types.ts`, `gradient.ts`, `saliency.ts`, 10/10 unit tests, visual inspector on all 12 benchmark images).
* [x] **TASK-103 Step 1 & Step 1.1:** Face region isolation & head pose estimation with illumination and torso robustness (`packages/structural-analysis/face-region.ts`, 14/14 unit & regression tests, 14.45ms average latency on benchmark suite).
* [x] **TASK-103 Step 2A:** Eye & eyelid landmark detection (`packages/structural-analysis/eyes.ts`, 13/13 unit tests, 1.17ms average latency, zero hallucinated occluded points).
* [x] **TASK-103 Step 2B:** Eyebrow landmark detection & quality audit (`packages/structural-analysis/eyebrows.ts`, 12/12 unit tests, 3.06ms average latency, verified supraorbital ridge tracking across all 12 benchmarks).
* [x] **TASK-103 Step 2C:** Nose landmark detection (`packages/structural-analysis/nose.ts`, 13/13 unit tests, 3.23ms average latency, zero hallucinated occluded points).
* [x] **TASK-103 Step 2D:** Mouth & lip landmark detection (`packages/structural-analysis/mouth.ts`, 16/16 unit tests, 6.72ms average latency, verified visual audit on all 12 benchmarks).
* [x] **TASK-103 Step 2E.1:** Jawline & outer facial contour detection (`packages/structural-analysis/jawline.ts`, 16/16 unit tests, 1.16ms average latency, verified visual audit on all 12 benchmarks).
* [x] **TASK-103 Step 2E.2:** Ear landmark & contour detection (`packages/structural-analysis/ears.ts`, 16/16 unit tests, 2.85ms average latency, verified visual audit on all 12 benchmarks).
* [x] **TASK-103 Step 2F:** Hair structure detection (`packages/structural-analysis/hair.ts`, 16/16 unit tests, 4.1ms average latency).
* [x] **TASK-103.5:** Pretrained vision backend evaluation (`docs/VISION_BACKEND_EVALUATION.md`, visual evaluation report).
* [x] **TASK-103.6:** Vision provider architecture (`packages/structural-analysis/src/providers/*`, 14/14 unit tests, `ADR-010`).
* [x] **TASK-103.7:** MediaPipe Face Landmarker integration (`apps/web/src/vision/mediapipe/*`, `docs/MEDIAPIPE_FACE_LANDMARKER.md`, 7/7 mapper tests, interactive web UI inspector, lazy chunk splitting verified).
* [x] **TASK-103.8:** MediaPipe Pose Landmarker integration (`apps/web/src/vision/mediapipe/*`, `docs/MEDIAPIPE_POSE_LANDMARKER.md`, 12/12 mapper tests, interactive web UI inspector with skeleton/joint overlays, lazy chunk splitting verified).
* [x] **TASK-103.9:** MediaPipe Image Segmenter integration (`apps/web/src/vision/mediapipe/*`, `docs/MEDIAPIPE_IMAGE_SEGMENTER.md`, 12/12 mapper/reconciler tests, interactive web UI with semantic mask overlays and category toggles, lazy chunk splitting verified).
* [x] **TASK-104:** Contour & Vector Generation (`packages/stroke-engine/src/geometry/*`, `packages/shared-types/src/vector.ts`, `docs/CONTOUR_VECTOR_GENERATION.md`, `ADR-011`, 20/20 unit tests, 12/12 benchmark images evaluated, 81.6% point reduction, 1.98ms avg latency, interactive web UI audit verified).
* [x] **TASK-105:** Procedural Stroke Candidate Generation (`packages/stroke-engine/src/candidates/*`, `packages/shared-types/src/stroke.ts`, `docs/STROKE_CANDIDATE_GENERATION.md`, `ADR-012`, 18/18 unit tests, 12/12 benchmark images evaluated, 1.06ms avg latency, 0 stroke explosion, profile occlusion verified, interactive web UI preview verified).
* [x] **TASK-106:** Stroke Ordering & Composition (`packages/stroke-engine/src/ordering/*`, `packages/shared-types/src/stroke.ts`, `docs/STROKE_ORDERING.md`, `ADR-013`, 17/17 unit tests, 12/12 benchmark images evaluated, 1.19ms avg latency, 100% valid sequence integrity, profile occlusion verified, interactive web UI preview verified).
* [x] **TASK-107:** Progressive Stroke Timeline & Animation Scheduling (`packages/stroke-engine/src/timeline/*`, `packages/shared-types/src/timeline.ts`, `docs/STROKE_TIMELINE.md`, `ADR-014`, 17/17 unit tests, 12/12 benchmark images evaluated, 0.54ms avg latency, 20.2µs query latency, controlled overlap and dependencies verified, interactive web UI scrubber and audit verified).
* [x] **Web App Foundation Verification:** `apps/web` builds cleanly with Vite, typechecks with 0 errors, and renders verified in browser.

---

## 3. Currently Being Worked On
* **TASK-107 (Complete):** Progressive Stroke Timeline & Animation Scheduling integrated, benchmarked across all 12 categories, and verified in browser diagnostics. Stopped as instructed; awaiting next user instruction.

---

## 4. What Is Partially Implemented
* Headless package stubs (`style-engine`, `export-engine`): Package manifests and version constants exist; algorithmic implementations begin in subsequent Phase 1 tasks.
* `packages/animation-engine`: Re-exports core timeline scheduling and progress interpolation; progressive canvas render runner and frame loops (`TASK-108`) follow.

---

## 5. What Is Blocked
* None. Timeline scheduling is verified and unblocks progressive drawing animation & canvas rendering runner (`TASK-108`).

---

## 6. Known Bugs & Anomalies
* None. All 258+ unit and regression tests pass cleanly across all 8 workspaces.

---

## 7. Known Technical Limitations
* Environment is Windows powershell; commands must account for PowerShell syntax.

---

## 8. Immediate Next Tasks

### Immediate Next Task (Task ID: `TASK-108`):
* `TASK-108`: Headless Canvas Draw Runner & Progressive Animation Test (`tests/rendering/` & `packages/animation-engine`). Progressive canvas drawing loop, frame interpolation, replay control, and visual quality audit.

### Next Few Planned Tasks (Phase 1):
1. `TASK-108`: Headless canvas draw runner & progressive animation test.
2. `TASK-109`: Style engine foundation & first expressive aesthetic preset.


---

## 9. Current Technical Risks & Mitigations

| Risk | Impact | Mitigation Strategy |
| :--- | :--- | :--- |
| **Edge Detection Noise:** Basic edge filters produce excessive clutter in hair and background. | High | Use semantic segmentation and landmark-guided importance weighting. Suppress background contours by default. |
| **Browser Execution Latency:** Complex ML models or heavy pixel processing freezing the UI thread. | High | Offload image processing to Web Workers; leverage lightweight models or optimized WebAssembly; enforce strict image downscaling before analysis. |
| **Coupling Engine to Web DOM:** Relying on browser Canvas/DOM inside core packages, breaking future React Native portability. | Critical | Keep `packages/structural-analysis`, `packages/stroke-engine`, and `packages/animation-engine` 100% pure TypeScript with headless data representations. |
| **Overengineering Scope:** Attempting full Vercel UI, gallery, social sharing, and complex styling before the core vectorization looks aesthetically compelling. | High | Enforce Phase 1 Feasibility Prototype: validate visual stroke quality on a fixed benchmark set before locking UI. |
