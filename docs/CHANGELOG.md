# CHANGELOG.md

## Chronological Project Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased] - Phase 0: Product & Technical Foundation

### Documentation
* **Comprehensive Project Knowledge System:**
  * Created `docs/PROJECT_CONTEXT.md` defining project identity, vision, core user experience, and architecture principles.
  * Created `docs/DEVELOPMENT_RULES.md` establishing 18 strict engineering disciplines and AI session handoff rules.
  * Created `docs/ARCHITECTURE.md` capturing target modular monorepo structure, data contracts (`SubjectModel`, `Stroke`), and pipeline stages.
  * Created `docs/CURRENT_STATE.md` establishing real-time tracking of phase, version, status, risks, and next tasks.
  * Created `docs/ROADMAP.md` covering Phase 0 to Phase 12 and Versions v0.1 to v5.0+.
  * Created `docs/TASK_TRACKER.md` providing granular task tracking by phase with explicit statuses.
  * Created `docs/DECISIONS.md` documenting initial ADRs (Monorepo, Universal Intermediate Representation, Client-Side Local First, Canvas 2D/WebGL rendering, MVP Scope Protection).
  * Created `docs/DEBUG_LOG.md` with strict root-cause debugging protocol and bug entry template.
  * Created `docs/BENCHMARKS.md` defining performance targets, hardware tiers, and quality evaluation matrices.
  * Created `docs/TESTING.md` outlining multi-tier testing strategy (Unit, Integration, Visual Regression, Browser).
  * Created root `README.md` introducing the project and linking to the persistent documentation knowledge system.

### Added
* **Remote Repository Connection & Branch Strategy:**
  * Configured GitHub remote `origin` pointing to `https://github.com/Rishi-Dev-pro/sketch-maker.git`.
  * Preserved historical `master` branch and established `main` as the authoritative primary development branch (tracking `origin/main`).
* **Monorepo Architecture Scaffolding (`TASK-004`):**
  * Configured npm workspaces in root `package.json` covering `packages/*` and `apps/*`.
  * Created `tsconfig.base.json` with strict TypeScript configuration and ES2022 target.
  * Scaffolded engine packages: `@sketch-maker/shared-types`, `@sketch-maker/image-processing`, `@sketch-maker/structural-analysis`, `@sketch-maker/stroke-engine`, `@sketch-maker/style-engine`, `@sketch-maker/animation-engine`, `@sketch-maker/export-engine`.
  * Scaffolded client web application: `apps/web` (React + Vite + TypeScript) with modular path aliases pointing to engine packages.
* **Universal Intermediate Representation Contracts (`TASK-005`):**
  * Implemented `packages/shared-types/src/geometry.ts` (`Point2D`, `BoundingBox`, `Dimensions`, `Polyline`, `BezierCurve`).
  * Implemented `packages/shared-types/src/subject.ts` (`SubjectModel`, `ContourPath`, `FacialFeatures`, `BodyFeatures`, `SemanticRegion`).
  * Implemented `packages/shared-types/src/stroke.ts` (`Stroke`, `StrokePoint`, `StrokeModel`).
  * Implemented `packages/shared-types/src/style.ts` (`StyleConfig`, `StyleId`, `BackgroundMode`, `QualityProfile`).
  * Implemented `packages/shared-types/src/pipeline.ts` (`PipelineProgress`, `PipelineStage`, `RenderFrame`).
* **Standard Benchmark Image Dataset (`TASK-006`):**
  * Curated 12 standard test image categories in `tests/images/` covering neutral portraits, 90° profile silhouettes, eyewear occlusions, dense facial hair, textured afro curls, chiaroscuro/backlight extremes, cluttered urban street backgrounds, noisy low-light night selfies, full standing poses, sitting folded limb poses, multi-person groups, and 24MP+ high-resolution scaling masters.
  * Created `tests/images/dataset.json` with machine-readable schemas, dimensions, aspect ratios, file sizes, SHA-256 cryptographic hashes, challenge factors, and acceptance criteria.
  * Created `tests/images/README.md` cataloging the evaluation dataset.
  * Implemented automated validator `tests/images/validate.js` verifying image structure, JPEG markers, resolution criteria, and checksums.
  * Added `test:dataset` script to root `package.json` integrated into `npm test` (verified 12/12 passing).

---

## [Unreleased] - Phase 1: Feasibility Prototype

### Added
* **Image Preprocessing & Normalization Engine (`TASK-101`):**
  * Implemented `@sketch-maker/image-processing` in pure TypeScript with zero external runtime dependencies.
  * Implemented `calculateTargetDimensions` enforcing profile resolution budgets (`FAST` 512px, `BALANCED` 1024px, `HIGH` 1600px, `ULTRA` 3000px) with strict floating-point aspect ratio preservation and small image protection (zero artificial upscaling).
  * Implemented `resamplePixelBuffer` with area-weighted box downsampling, eliminating Moiré artifacts and aliasing on high-frequency details (hair, textiles, glasses).
  * Implemented `rgbaToLuminance` with ITU-R Rec. BT.709 photometric coefficients ($Y = 0.2126R + 0.7152G + 0.0722B$) outputting both `Uint8Array` [0-255] and `Float32Array` [0.0 - 1.0].
  * Implemented `computeLuminanceStats` single-pass accumulator (min, max, mean, stdDev, 256-bin histogram, 1st and 99th percentiles).
  * Implemented `normalizeLuminanceContrast` gentle percentile-bounded dynamic range normalization ($p_1 \to p_{99}$), preventing crushed shadows or blown highlights.
  * Implemented `bilateralFilterLuminance` edge-preserving bilateral filter for noise suppression in low-light inputs.
  * Created `preprocessPixelBuffer` pipeline producing immutable `NormalizedImage` containers.
  * Created browser DOM adapters for `ImageData`, `ImageBitmap`, `HTMLCanvasElement`, and `OffscreenCanvas`.
  * Added automated test suite `tests/image-processing/preprocess.test.ts` (10/10 unit tests passing) and integrated into `npm test`.
  * Added benchmark evaluation runner `tests/image-processing/benchmark-runner.ts` validating all 12 benchmark images (average latency 68.7ms, 24MP downsampling in 240.3ms with heap bounded at 18.6MB).
  * Documented ADR-007 in `docs/DECISIONS.md`.
* **Initial Subject Segmentation & Background Separation Engine (`TASK-102`):**
  * Implemented `@sketch-maker/structural-analysis` segmentation module in pure TypeScript with zero runtime neural network dependencies.
  * Implemented multi-cue perceptual saliency computation (`packages/structural-analysis/src/saliency.ts`) combining spatial center prior, perimeter-sampled background color contrast, and Sobel gradient energy fields.
  * Implemented directional Sobel operator (`packages/structural-analysis/src/gradient.ts`) computing gradient magnitude and edge orientations.
  * Implemented structural segmentation (`packages/structural-analysis/src/segmentation.ts`) with adaptive hysteresis thresholding, gradient-stopping regional flood fill, and topological hole filling to prevent hollow subject masks.
  * Implemented connected-component instance clustering and bounding box extraction, supporting multi-subject detection (e.g. `BM-11`).
  * Implemented soft boundary confidence mapping computing normalized distance-to-edge confidence fields [0.0 - 1.0].
  * Added automated unit test suite `tests/structural-analysis/segmentation.test.ts` (10/10 passing) covering dimensions, coverage, boundary adherence, multi-instance detection, and high-frequency edge preservation.
  * Added benchmark visual inspection suite `tests/structural-analysis/visual-inspector.ts` evaluating all 12 benchmark categories with performance metrics (average latency 239.7ms, combined preprocessing + segmentation 308.4ms, peak heap 24.5MB).
  * Documented ADR-008 (Pure-TypeScript Multi-Cue Perceptual Subject Segmentation Engine) in `docs/DECISIONS.md`.
* **SubjectModel Contract Refinement for Structural Analysis (`TASK-103`):**
  * Extended `packages/shared-types/src/subject.ts` with `FeatureVisibility` (`'visible' | 'occluded' | 'not_detected' | 'uncertain'`) and `HeadPose` (`'frontal' | 'three_quarter_left' | 'three_quarter_right' | 'left_profile' | 'right_profile'`).
  * Updated `FacialFeatures` to make anatomical feature paths optional with a dedicated `featureVisibility` map, enabling legal representation of side-profile portraits (`BM-02`) and occlusions without hallucinating hidden features.
  * Added `SubjectAnalysisResult` in `packages/structural-analysis/src/types.ts` representing primary subject, multi-subject collections (`BM-11`), coordinate scaling, and structural diagnostic metrics.
  * Documented ADR-009 (Pure-TypeScript Anatomical Landmark & Structural Contour Extraction Engine) in `docs/DECISIONS.md`.
  * Implemented Face Region Isolation & Head Pose Estimation (`packages/structural-analysis/src/face-region.ts`) providing `estimateFaceRegion` and `estimateAllFaceRegions` with evidence-driven confidence scoring over skin chrominance, vertical foreground mass profiling, bilateral symmetry, and silhouette projection asymmetry ratios.
  * Added 14 automated unit and regression tests (`tests/structural-analysis/face-region.test.ts`) covering bounding box containment, coordinate normalization, symmetry scoring, profile vs frontal detection, multi-person isolation, chiaroscuro shadow invariance, and high-resolution scaling invariance.
  * Added visual inspection benchmark suite (`tests/structural-analysis/pose-inspector.ts`) evaluating all 12 benchmark categories with an average latency of 14.45 ms (sub-15ms CPU time).
* **Head Pose Robustness & Multi-Cue Evidence Model (`TASK-103 Step 1.1`):**
  * Decoupled facial geometry from skin chrominance; skin visibility asymmetry is no longer equated with geometric profile yaw.
  * Implemented high-frequency structural edge energy centroid ($y \in [0.18, 0.78]$ of head) tracking facial landmarks (eyelids, nasal bridge, lip fissure) invariant to illumination shadows.
  * Implemented cranium-to-neck boundary isolation with an anatomical head ceiling ($H \le 1.25 \times W_{cranium}$) and shoulder expansion trigger, preventing chest and shirt contours from contaminating head silhouette geometry.
  * Replaced single-threshold classification with a multi-evidence voting model combining boundary asymmetry, centroid offset, structural energy concentration, and appearance consistency.
    * Added `illuminationAsymmetry` and `headSilhouetteAsymmetry` diagnostic metrics to `FaceRegionDiagnostics`.
* **Eye & Eyelid Landmark Detection (`TASK-103 Step 2A`):**
  * Implemented `@sketch-maker/structural-analysis` eye detector (`packages/structural-analysis/src/eyes.ts`) with zero external ML models, operating strictly in normalized [0, 1] coordinates.
  * Implemented multi-cue ocular search: searches within pose-conditioned anatomical ocular search bands using horizontal luminance valleys (sclera-iris-sclera contrast) and horizontal Sobel edge gradients rather than absolute darkness, ensuring robust detection across skin tones, shadows, and low-light portraits.
  * Implemented eyelid margin tracing (`upperLid` and `lowerLid` paths) preserving continuous raw point sequences converging at medial and lateral canthi without early simplification.
  * Implemented evidence-dependent iris and pupil center estimation conditioned on local radial contrast ($\Delta L \ge 0.05$), returning `undefined` when image evidence is insufficient or ambiguous (e.g. glasses rims).
  * Added 13 automated unit tests in `tests/structural-analysis/eyes.test.ts` (13/13 passing) verifying coordinate bounds, containment, determinism, frontal bilateral visibility, profile occlusion, chiaroscuro shadow handling, low-light contrast detection, glasses rim separation, multi-person isolation, and real BM-02 profile occlusion invariant.
  * Added visual inspection benchmark suite (`tests/structural-analysis/eye-inspector.ts`) evaluating all 12 benchmark categories with an average extraction latency of **1.17 ms** (well below the 150 ms budget) and generating visual inspection artifact `tests/artifacts/eye-report.html`.
* **Eyebrow Landmark Detection & Quality Audit (`TASK-103 Step 2B`):**
  * Implemented `@sketch-maker/structural-analysis` eyebrow detector (`packages/structural-analysis/src/eyebrows.ts`) in pure TypeScript with zero external ML models, operating strictly in normalized [0, 1] coordinates.
  * Implemented supraorbital ridge dynamic programming algorithm extracting smooth continuous raw polyline paths along the natural eyebrow arch while penalizing abrupt vertical discontinuities.
  * Anchored search band relative to detected eye landmarks (`EyeDetectionResult`) with strict supraorbital vertical separation constraints ($\ge 2$px above superior palpebral margin), preventing upper eyelids or spectacle rims from hijacking brow contours (`BM-03`).
  * Enforced physical occlusion semantics: profile poses (`BM-02`) strictly mark the hidden eyebrow as `visibility: 'occluded'` with confidence 0 and 0 points, never fabricating or mirroring coordinates.
  * Added 12 automated unit tests in `tests/structural-analysis/eyebrows.test.ts` (12/12 passing) verifying coordinate bounds, determinism, frontal bilateral visibility, three-quarter asymmetry, profile occlusion, glasses robustness, facial-hair robustness, hair/forehead boundary isolation, and multi-person isolation.
  * Added visual inspection benchmark suite (`tests/structural-analysis/eyebrow-inspector.ts`) and audit tool (`tests/structural-analysis/audit-eyebrows.ts`) evaluating all 12 benchmark categories with an average extraction latency of **3.06 ms - 3.62 ms** and generating visual inspection artifact `tests/artifacts/eyebrow-report.html`.
  * Conducted focused Quality Audit across `BM-01` through `BM-12`:
    * Confirmed detected eyebrow paths follow anatomical supraorbital arches (consistently 12% to 17% of face height above eye centers) rather than generic dark ridges.
    * Confirmed `BM-03` spectacle robustness: brow paths sit at $y \in [0.037, 0.067]$, strictly above the glasses upper rims ($y \approx 0.078-0.082$).
    * Confirmed `BM-05` hair variety robustness: brow paths sit at $y \in [0.213, 0.256]$, separated from cranium hairlines ($y \le 0.17$).
    * Confirmed `BM-06` chiaroscuro fidelity: shadowed left brow honestly registers `not_detected` (0 pts) without hallucinating ungrounded contours.
    * Confirmed conservative confidence calibration (0.16–0.24) is appropriate for Phase 1 feasibility without score inflation.
* **Nose Landmark Detection (`TASK-103 Step 2C`):**
  * Implemented `@sketch-maker/structural-analysis` nose detector (`packages/structural-analysis/src/nose.ts`) in pure TypeScript with zero external ML models, operating strictly in normalized [0, 1] coordinates.
  * Implemented multi-cue nasal dorsum vertical dynamic programming algorithm tracing continuous raw bridge paths while enforcing lateral continuity constraints ($|\Delta x| \le 2$ px per row).
  * Implemented nasal lobule dome localization extracting raw tip arcs conditioned on downward subnasal luminance drop.
  * Implemented alar boundary and nostril opening extraction using localized radial contrast analysis ($\Delta L \ge 0.035$).
  * Implemented spectacle-bridge avoidance (`BM-03`) and upper lip / mustache barrier separation (`BM-04`).
  * Enforced physical occlusion semantics: profile poses (`BM-02`) strictly mark hidden-side nostril as `visibility: 'occluded'` with confidence 0 and 0 points, never fabricating or mirroring coordinates.
  * Added 13 automated unit tests in `tests/structural-analysis/nose.test.ts` (13/13 passing) verifying coordinate bounds, determinism, frontal bilateral visibility, three-quarter shifted midline, profile occlusion, glasses robustness, facial-hair robustness, extreme chiaroscuro shadow handling, low-light contrast detection, and multi-person isolation.
  * Added visual inspection benchmark suite (`tests/structural-analysis/nose-inspector.ts`) evaluating all 12 benchmark categories with an average extraction latency of **3.23 ms** and generating visual inspection artifact `tests/artifacts/nose-report.html`.
* **Mouth & Lips Landmark Detection (`TASK-103 Step 2D`):**
  * Implemented `@sketch-maker/structural-analysis` mouth & lips detector (`packages/structural-analysis/src/mouth.ts`) in pure TypeScript with zero external ML models, operating strictly in normalized [0, 1] coordinates.
  * Implemented horizontal dynamic programming algorithm tracing the oral fissure seam (stomion line) with bilateral valley contrast ($\min(\Delta L_{above}, \Delta L_{below})$), ensuring dark horizontal structures bounded by lighter flesh on both sides are captured while rejecting unidirectional step edges (such as mustache bottoms, beard hairlines, and chin shadows).
  * Anchored mouth search ROI dynamically: beneath nasal tip / base when nose is detected ($y_{stomion} = y_{nose} + 0.38 \Delta y_{chin}$), or below ocular midline when nose is absent ($y_{stomion} = y_{eyes} + 0.65 \Delta y_{chin}$).
  * Implemented vermilion border tracing for upper lip (`upperLip`) and lower lip (`lowerLip`) guided by the verified oral fissure seam with scale-adaptive distance priors and skin-vermilion contrast sampling.
  * Implemented oral commissure corner extraction (`leftCorner`, `rightCorner`) anchoring lateral endpoints with local edge convergence evidence.
  * Enforced physical occlusion semantics: profile poses (`BM-02`) strictly suppress hidden-side oral commissures without fabricating or mirroring coordinates.
  * Eliminated glasses frame and lighting shadow false positives (`BM-03`, `BM-06`), honestly reporting `not_detected` when mouth evidence is absent or occluded.
  * Added 16 automated unit tests in `tests/structural-analysis/mouth.test.ts` (16/16 passing) verifying coordinate bounds, determinism, frontal bilateral visibility, open mouth with visible teeth, smiling/asymmetric curvature, three-quarter shifted midline, profile visibility, hidden-side suppression, mustache/beard robustness, glasses robustness, extreme chiaroscuro shadow handling, low-light contrast detection, and multi-person isolation.
  * Added visual inspection benchmark suite (`tests/structural-analysis/mouth-inspector.ts`) evaluating all 12 benchmark categories with an average extraction latency of **6.72 ms** and generating visual inspection artifact `tests/artifacts/mouth-report.html`.
* **Jawline & Facial Contour Detection (`TASK-103 Step 2E.1`):**
  * Implemented `@sketch-maker/structural-analysis` jawline and outer facial contour detector (`packages/structural-analysis/src/jawline.ts`) in pure TypeScript with zero external ML models, operating strictly in normalized [0, 1] coordinates.
  * Reused existing `SubjectMask` and `SubjectRegion` to anchor outer boundary detection in silhouette geometry rather than relying solely on dark line search edges.
  * Implemented bidirectional boundary scanning (`findMaskBoundary`) with subpixel-level local Sobel gradient edge alignment within a $\pm 4$px neighborhood around the mask boundary.
  * Implemented mandibular inward convergence and neck/collar inflection detection: tracks jaw width $W(y) = x_{right}(y) - x_{left}(y)$ below mouth level and terminates before expanding into shirt collar or shoulder boundaries (`BM-09`, `BM-10`), eliminating clothing contamination.
  * Implemented profile facial silhouette preservation (`BM-02`): extracts visible anterior contour (glabella $\to$ nose $\to$ lips $\to$ chin $\to$ submental line) as `leftJaw` for `left_profile` and strictly suppresses hidden-side jaw geometry (`rightJaw: undefined`), without mirroring or phantom coordinate fabrication.
  * Implemented chin tip apex detection (gnathion/pogonion) and lower mandibular chin arc (`chin`).
  * Implemented robust beard and hair handling: prevents beard boundaries from being forced into phantom jawlines (`BM-04` registers `uncertain`), and prevents cranium hair from being traced as cheek/jawline (`BM-05`).
  * Updated `@sketch-maker/shared-types` with `chin?: ContourPath` in `FacialFeatures` and `'chin'` in `FeatureVisibility`.
  * Added 16 automated unit tests in `tests/structural-analysis/jawline.test.ts` (16/16 passing) verifying normalized coordinates, determinism, frontal bilateral jaw and chin arc, asymmetric jawline, three-quarter pose, profile silhouette preservation, profile hidden-side suppression, beard robustness, hair robustness, neck/clothing robustness, complex background clutter handling, extreme chiaroscuro shadow handling, low-light contrast detection, multi-person isolation, weak-evidence confidence reduction, and real BM-02 side profile benchmark.
* **Ear Landmark & Contour Detection (`TASK-103 Step 2E.2`):**
  * Implemented `@sketch-maker/structural-analysis` ear detector (`packages/structural-analysis/src/ears.ts`) in pure TypeScript with zero external ML models, operating strictly in normalized [0, 1] coordinates.
  * Adhered strictly to existing universal data contracts: outputs `leftEar?: ContourPath`, `rightEar?: ContourPath`, `leftVisibility`, `rightVisibility`, `visibility`, and `confidence` using existing `FacialFeatures` schema.
  * Implemented evidence-first detection: evaluated lateral cranium/cheek regions independently for frontal and three-quarter faces without assuming bilateral symmetry or fabricating absent ears.
  * Implemented sustained protrusion and convex curvature analysis to eliminate false positives from straight hair masses, hair curls, and vertical cranium edges ($\sigma_x \ge 0.8\text{px}$, protruding fraction $\ge 0.30$, protrusion ratio $\ge 0.25$).
  * Implemented glasses temple spike rejection: filters out isolated 1-2px horizontal temple arm spikes that lack vertical pinna height or sustained curvature.
  * Implemented local hair luminance profiling (`MAX_HAIR_LUMINANCE = 0.15`): marks regions dominated by dark hair (>60%) as `not_detected` rather than hallucinating ear pinna.
  * Implemented internal concha-to-helix contrast analysis: checks for darker conchal bowl shadow relative to outer helix skin rim.
  * Implemented profile view handling (`BM-02`): detects visible posterior ear pinna (133 points, conf 0.52) and strictly suppresses hidden-side far ear (`rightEar: undefined`, `rightVisibility: 'occluded'`) without phantom coordinate hallucination or mirroring.
  * Added 16 automated unit tests in `tests/structural-analysis/ears.test.ts` (16/16 passing) verifying normalized coordinates, determinism, frontal bilateral visibility, independent left/right detection, three-quarter pose, profile visibility, profile hidden-side suppression, hair robustness, glasses/accessory robustness, beard robustness, complex background clutter handling, extreme chiaroscuro shadow handling, low-light contrast detection, multi-person isolation, weak-evidence confidence reduction, and real BM-02 side profile benchmark.
  * Added visual inspection benchmark suite (`tests/structural-analysis/ear-inspector.ts`) evaluating all 12 benchmark categories with an average extraction latency of **2.85 ms** and generating visual inspection artifact `tests/artifacts/ear-report.html`.

* **Pretrained Vision Backend Evaluation (`TASK-103.5`):**
  * Conducted an architectural and empirical evaluation comparing the pure-TypeScript deterministic perception pipeline against pretrained computer-vision backends (MediaPipe Tasks Vision and ONNX Runtime Web).
  * Evaluated candidates across Face Landmarks (MediaPipe 478-pt FaceMesh), Body Pose (33-pt BlazePose skeleton), and Semantic Segmentation (Selfie Multiclass Segmenter) against the 12 canonical benchmark categories (`BM-01` to `BM-12`).
  * Established empirical performance metrics: deterministic facial landmarks run in an average of **26.5 ms** and total pipeline in **457.9 ms** (with segmentation at **256.1 ms** being the primary CPU phase), while MediaPipe FaceMesh runs in **18–30 ms** on GPU with a 3.7 MB payload.
  * Discovered key structural trade-offs: MediaPipe Face Landmarker completely omits the external ear pinna (helix rim/concha) and struggles on 90° profile yaw (`BM-02`), whereas our deterministic detector provides authoritative ear pinna geometry and clean occluded feature suppression.
  * Evaluated body pose: MediaPipe Pose Landmarker completely solves 33-point skeletal articulation for standing and sitting subjects (`BM-09`, `BM-10`), avoiding thousands of lines of fragile handcrafted heuristics.
  * Created experimental prototype adapter in `tests/vision-backends/adapter-prototype.ts` mapping MediaPipe 478-point mesh and 33-point pose to canonical `SubjectModel` (`FacialFeatures`, `BodyFeatures`).
  * Created benchmark runner in `tests/vision-backends/benchmark-runner.ts` and interactive visual evaluation report in `tests/artifacts/vision-backend-evaluation.html`.
  * Produced comprehensive evaluation document in `docs/VISION_BACKEND_EVALUATION.md`.
  * Recommended **Option C (Hybrid Architecture)**: Retain the deterministic engine as the zero-download, offline core; introduce an optional client-side ML enhancement layer in `apps/web` for dense 3D facial mesh and full-body skeletal pose.

* **Vision Provider Architecture & Decoupled Perception (`TASK-103.6`):**
  * Introduced a formal, decoupled vision provider abstraction (`VisionProvider`, `VisionCoordinator`, `DeterministicVisionProvider`, `MediaPipeVisionProvider`, `VisionResult`) in `packages/structural-analysis/src/providers/`.
  * Preserved the Universal Intermediate Representation (`SubjectModel`) as the strict, single contract between perception and downstream procedural art engines (`ADR-010`), ensuring the procedural engine never depends directly on vision algorithms or neural network packages.
  * Implemented `DeterministicVisionProvider` orchestrating pure-TypeScript segmentation, face region estimation, eyes, eyebrows, nose, mouth, jawline, ears, and hair detectors into canonical `SubjectModel` representations with 100% offline execution and 0 external dependencies.
  * Implemented `MediaPipeVisionProvider` architectural stub with honest availability probing, `MediaPipeUnavailableError`, and pluggable `MediaPipeRuntimeDelegate` interface, without adding `@mediapipe/tasks-vision` or model binaries to production bundles.
  * Implemented `VisionCoordinator` managing execution modes (`'deterministic'`, `'ml'`, `'auto'`, `'hybrid'`). In `'auto'` mode, automatically executes deterministic fallback when ML is unavailable without throwing errors. In `'hybrid'` mode, reconciles dense ML facial landmarks with deterministic ear pinna geometry and silhouette-anchored hair contours.
  * Added 14 automated unit tests in `tests/structural-analysis/vision-provider.test.ts` (14/14 passing) verifying provider contract satisfaction, canonical `SubjectModel` mapping, normalized [0, 1] coordinates, bounded [0, 1] confidence scores, visibility semantics preservation, multi-person group representation, metadata & execution audit trail preservation, zero-ML deterministic operation, honest headless ML unavailability probing, deterministic provider selection, auto mode fallback, hybrid reconciliation with ear pinna preservation, mock ML delegate execution, and zero DOM/window API pollution in core packages.
* **MediaPipe Face Landmarker Integration (`TASK-103.7`):**
  * Installed `@mediapipe/tasks-vision` exclusively in `apps/web/package.json`, keeping `packages/structural-analysis` 100% pure TypeScript with zero DOM/window/WASM dependencies.
  * Configured lazy Vite bundle chunking (`manualChunks: { vision_bundle: [...] }`), resulting in a distinct `dist/assets/vision_bundle-*.js` chunk (136.2 kB, gzip 40.8 kB) and keeping the initial application bundle lightweight (239.4 kB, gzip 75.6 kB).
  * Implemented `MediaPipeWebDelegate` in `apps/web/src/vision/mediapipe/mediapipe-delegate.ts` conforming to the `MediaPipeRuntimeDelegate` interface, with dynamic lazy loading, FilesetResolver initialization, ImageData conversion, and graceful lifecycle cleanup.
  * Implemented canonical 478-landmark mapper (`apps/web/src/vision/mediapipe/landmark-mapper.ts`):
    * Strictly clamps all normalized coordinates to `[0.0, 1.0]`.
    * Maps facial contours, iris centers, eyelids, nasal dorsum/nostrils, vermilion lip borders, and mandibular jawlines to `FacialFeatures` and `SubjectModel`.
    * Derives head pose (`frontal`, `three_quarter`, `profile`) and enforces strict occlusion tagging on the hidden side of profile faces (`BM-02`), preventing landmark hallucinations.
    * Explicitly reports ears as `not_detected` to prevent false ear pinna synthesis.
  * Enhanced `VisionCoordinator` (`packages/structural-analysis/src/providers/coordinator.ts`) to reconcile ear pinna visibility semantics alongside ear contour geometry in hybrid mode.
  * Replaced `node:perf_hooks` with universal `globalThis.performance.now()` across `packages/structural-analysis` and `apps/web` to guarantee seamless browser bundling.
  * Added rich interactive UI in `apps/web/src/App.tsx`: execution mode selector, 12-category benchmark selector, dual-layer interactive canvas, visual layer toggles (Face Mesh, Ear Pinna, Hair, Contours), live latency & provenance indicators, occlusion audit table, and batch runner ("Evaluate All 12").
  * Added 7 automated unit tests in `tests/structural-analysis/mediapipe-landmark-mapper.test.ts` (7/7 passing) verifying coordinate bounds clamping, frontal feature mapping, ear absence, profile occlusion semantics (`BM-02`), multi-person face mapping (`BM-11`), delegate state machine, and disposal.
  * Added `test:mediapipe:mapper` script and integrated into root `npm test` gate (100% pass across 162+ monorepo tests).
  * Documented architectural details, bundle footprint, and benchmark measurements in `docs/MEDIAPIPE_FACE_LANDMARKER.md`.
* **MediaPipe Pose Landmarker Integration (`TASK-103.8`):**
  * Extended canonical data contracts in `packages/shared-types/src/subject.ts`: added `PoseLandmark`, `PoseConnection`, `BodyPose`, and extended `BodyFeatures` with optional `pose?: BodyPose`.
  * Configured official MediaPipe Pose Landmarker Lite model asset path (`pose_landmarker_lite.task`, 5.77 MB) in `apps/web/src/vision/mediapipe/model-config.ts`.
  * Generalized `MediaPipeWebDelegate` in `apps/web/src/vision/mediapipe/mediapipe-delegate.ts` to share a single cached `FilesetResolver` promise across both `FaceLandmarker` and `PoseLandmarker`, eliminating redundant WASM runtime loads.
  * Implemented canonical 33-point BlazePose mapper (`apps/web/src/vision/mediapipe/pose-mapper.ts`):
    * Clamps all normalized coordinates strictly to `[0.0, 1.0]`.
    * Synthesizes anatomical neck midpoint from left/right shoulders.
    * Generates standard skeletal connections with connection-level confidence based on endpoint visibility.
    * Categorizes landmark visibility into discrete thresholds (`visible` $\ge 0.65$, `uncertain` $0.35 \le v < 0.65$, `occluded` $< 0.35$).
    * Emits upper-body and lower-body contour paths for downstream vectorization.
  * Implemented Face + Pose associator (`apps/web/src/vision/mediapipe/face-pose-associator.ts`) using Euclidean spatial proximity ($d < 0.25$) between pose nose/neck anchors and face bounding boxes:
    * Unifies independently detected face and pose outputs into coherent `SubjectModel` instances.
    * Reliably handles single individuals, standing (`BM-09`), sitting (`BM-10`), and multi-person isolation (`BM-11`).
    * Gracefully handles isolated faces without poses and headless bodies without faces.
  * Updated `VisionCoordinator` (`packages/structural-analysis/src/providers/coordinator.ts`) to retain additional ML-detected subjects in hybrid mode and reconcile body pose alongside face and ear pinna contours.
  * Preserved bundle isolation in `apps/web/vite.config.ts`: isolated all vision ML code into `vision_bundle` (220.35 kB, gzip 66.39 kB), reducing initial page bundle to 172.35 kB (gzip 54.26 kB).
  * Enhanced interactive web UI in `apps/web/src/App.tsx`: perception scope selector (`All`, `Face Only`, `Pose Only`), visualization toggles (`Pose Skeleton`, `Pose Joints`), glowing bone/joint canvas rendering, telemetry card for Body Pose, and Body Pose column in batch evaluation table.
  * Added 12 automated unit tests in `tests/structural-analysis/mediapipe-pose-mapper.test.ts` (12/12 passing) verifying coordinate clamping, canonical mapping, neck synthesis, connections, standing, sitting, visibility thresholds, contour paths, multi-person separation, face+pose association, and disposal.
  * Added `test:mediapipe:pose` script and integrated into root `npm test` gate (100% pass across 174+ monorepo tests).
  * Documented full architectural details, topology, bundle impact, benchmark results, and limitations in `docs/MEDIAPIPE_POSE_LANDMARKER.md`.
* **MediaPipe Image Segmenter Integration (`TASK-103.9`):**
  * Extended canonical data contracts in `packages/shared-types/src/subject.ts`: added `SemanticCategory` (`'background' | 'hair' | 'body-skin' | 'face-skin' | 'clothes' | 'others'`), `SemanticMask`, `SemanticSegmentation`, and extended `SubjectModel` with optional `semanticSegmentation?: SemanticSegmentation`. Exported via `packages/shared-types/src/index.ts`.
  * Extended `SegmentationResult` in `packages/structural-analysis/src/types.ts` with optional `semanticSegmentation?: SemanticSegmentation`.
  * Configured official MediaPipe Image Segmenter model asset path (`selfie_multiclass_256x256.tflite`, 16.37 MB) in `apps/web/src/vision/mediapipe/model-config.ts`.
  * Generalized `MediaPipeWebDelegate` in `apps/web/src/vision/mediapipe/mediapipe-delegate.ts` to share the cached `FilesetResolver` promise across `FaceLandmarker`, `PoseLandmarker`, and `ImageSegmenter`, lazily instantiating `ImageSegmenter` on demand with zero startup penalty.
  * Implemented canonical 6-class discrete mapper (`apps/web/src/vision/mediapipe/segmenter-mapper.ts`):
    * Maps discrete model output indices (0: background, 1: hair, 2: body-skin, 3: face-skin, 4: clothes, 5: others) to canonical semantic categories.
    * Resamples category masks strictly using nearest-neighbor interpolation to prevent illegal synthetic category index generation.
    * Computes continuous confidence maps using bilinear interpolation to maintain smooth, anti-aliased probabilities $[0.0, 1.0]$.
    * Normalizes category-specific bounding boxes and computes overall foreground `SubjectMask`.
  * Implemented evidence-aware hybrid segmentation reconciler (`apps/web/src/vision/mediapipe/segmentation-reconciler.ts`):
    * Reconciles ML semantic masks with TASK-102 deterministic masks.
    * Retains high-confidence consensus foreground regions.
    * Applies ML semantic override when deterministic contrast is low, eliminating background clutter (`BM-07`) and recovering deep chiaroscuro torso/face regions (`BM-06`).
    * Preserves deterministic high-gradient Sobel edge barriers, protecting fine hairline wisps and clothing seam contours (`BM-05`).
  * Updated `VisionCoordinator` (`packages/structural-analysis/src/providers/coordinator.ts`) to merge reconciled semantic segmentation into primary and hybrid subjects.
  * Preserved bundle isolation in `apps/web/vite.config.ts`: isolated all vision ML code into `vision_bundle` (226.18 kB, gzip 68.01 kB), keeping initial page bundle lightweight at 177.93 kB (gzip 55.21 kB).
  * Enhanced interactive web UI in `apps/web/src/App.tsx`: perception scope selector (`All`, `Face Only`, `Pose Only`, `Segment Only`), visualization toggles (`Semantic Masks`, `Hair`, `Skin`, `Clothes`), multi-color alpha-blended canvas overlay rendering, telemetry card for Semantic Segmentation, and added `Semantic Seg` column to 12-category batch benchmark table.
  * Added 12 automated unit tests in `tests/structural-analysis/mediapipe-segmenter-mapper.test.ts` (12/12 passing) verifying category mapping, unknown handling, nearest-neighbor resampling, bilinear confidence interpolation, canonical mapping, bounding box normalization, hybrid agreement, ML override, gradient barrier preservation, multi-person semantic vs instance verification, delegate lifecycle, and disposal.
  * Added `test:mediapipe:segmenter` script and integrated into root `npm test` gate (100% pass across 186+ monorepo tests).
  * Documented full architectural details, model specifications, 6 classes, resolution resampling, hybrid reconciliation, multi-person limitation, benchmark results, and bundle impact in `docs/MEDIAPIPE_IMAGE_SEGMENTER.md`.
* **Contour & Vector Generation (`TASK-104`):**
  * Created canonical vector geometry IR data contracts in `packages/shared-types/src/vector.ts`: `GeometrySource`, `PathHierarchyLevel`, `VectorPath`, `GeometryMetrics`, and `VectorGeometry`. Exported via `packages/shared-types/src/index.ts`.
  * Implemented pure TypeScript vector geometry pipeline in `packages/stroke-engine/src/geometry/`:
    * `cleaning.ts`: Coordinate clamping $[0.0, 1.0]$, NaN/Infinity rejection, deduplication ($\epsilon = 10^{-5}$), acute spike suppression ($d > 0.35$), and collinear intermediate point reduction (area $< 10^{-7}$).
    * `simplification.ts`: Deterministic Ramer-Douglas-Peucker reduction with adaptive hierarchy-calibrated tolerances (`primary_structural`: $0.0015$, `secondary_expressive`: $0.0025$, `anatomical_gesture`: $0.0035$, `boundary_contour`: $0.0040$, `tertiary_texture`: $0.0050$), open path endpoint preservation, and closed loop non-collapsing guarantees.
    * `curves.ts`: Continuous parametric cubic Bézier curve fitting using Catmull-Rom tangents with chord length weighting, overshoot clamp ($\|C - P\| \le 0.4 L$), and closed loop continuous tangent wrapping.
    * `mask-contours.ts`: Clockwise 8-connected Moore-neighborhood boundary extraction for raster semantic masks with configurable grid downsampling (default: 4px) and minimum bounding area filtering ($0.001$).
    * `importance.ts`: Deterministic multi-cue path importance formulation ($I = 0.45 w_{\text{semantic}} + 0.25 c + 0.15 v + 0.15 s$) establishing objective rendering priority.
    * `extractor.ts`: Unified vector geometry generator traversing facial landmarks, body pose skeleton, hair, silhouette, and semantic segmentation masks.
  * Preserved strict profile occlusion semantics: on `BM-02` (90° side profile), occluded far-side features produce 0 paths.
  * Preserved multi-subject isolation: on `BM-11` (multi-person), paths are cleanly partitioned with distinct `subjectId` attributes.
  * Added 20 automated unit tests in `tests/stroke-engine/geometry.test.ts` (20/20 passing) verifying cleaning, RDP reduction, curve fitting, mask boundaries, importance weighting, occlusion handling, multi-subject partitioning, and 100% pure TypeScript execution without browser/DOM globals.
  * Added `test:geometry` script and integrated into root `npm test` gate (100% pass across 206+ monorepo tests).
  * Added comprehensive 12-category benchmark runner `tests/benchmarks/geometry-benchmark.ts` and `npm run benchmark:geometry`:
    * Evaluated across all 12 canonical benchmark categories (`BM-01` to `BM-12`).
    * Measured average latency of **1.98 ms** (vs < 50ms SLA budget).
    * Achieved **81.6% point reduction** (from 2,838 to 514 clean, salient points per subject).
    * Peak heap memory delta remained bounded at 68.58 MB.
  * Enhanced interactive web UI in `apps/web/src/App.tsx`:
    * Computed memoized `currentGeometry` from perception results.
    * Added visualization toggles (`Vector Geometry`, `Bézier Curves`, `Importance Heatmap`).
    * Rendered vector path overlays with hierarchy level color coding vs dynamic rainbow importance heatmap.
    * Added `Vector Paths (TASK-104)` metric card and expandable `Vector Geometry Audit Card`.
    * Added `Vectors (TASK-104)` column to the 12-category batch benchmark table.
    * Updated header status pill to `TASK-104 Vector Generation`.
  * Documented full architectural details, RDP tolerances, Bézier formulation, and benchmark results in `docs/CONTOUR_VECTOR_GENERATION.md`, `docs/ARCHITECTURE.md` (Section 8), and `docs/DECISIONS.md` (`ADR-011`).

### Fixed
* **Pose Estimation Failures on BM-02 & BM-06 (`BUG-002`):**
  * Fixed `BM-02` true side profile misclassification: shoulder/chest geometry was pulling the search envelope downwards (row 687) and leftwards (x=268), artificially diluting profile asymmetry. Head coordinate isolation correctly restores `left_profile` classification ($A_{silh} = 0.34$, $offset = -0.32$, confidence 0.62).
  * Fixed `BM-06` extreme chiaroscuro misclassification: shadowed right facial half previously lost skin-chrominance pixels (2.7% coverage), triggering a false `left_profile`. Geometric edge symmetry ($energyRatioLeft = 0.535$, $energyOffset = +0.043$) and silhouette symmetry ($A_{silh} = 0.52$) correctly recognize illumination asymmetry and preserve `frontal` classification with 0.78 confidence.
* **Session Interruption Recovery (`BUG-001`):**
  * Identified root cause of prior session halt (upstream SSE connection drop).
  * Executed `npm install` across workspace tree, linking internal packages.
  * Verified end-to-end `typecheck` (0 errors) and Vite production build.
  * Verified client runtime rendering in browser without console errors.
