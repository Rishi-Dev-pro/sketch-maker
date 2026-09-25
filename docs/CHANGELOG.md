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

### Added & Fixed
* **Facial Structural Ownership Restoration & Jawline Discontinuity Fix (`TASK-114.6`):**
  * **Authoritative Silhouette Selection:** Replaced the greedy vertex-count heuristic in `packages/stroke-engine/src/candidates/generator.ts` with explicit semantic binding (`authoritative_silhouette` / `source === 'silhouette'`). Prevents high-vertex regional hair boundaries (`hair_outer_boundary`) from usurping the whole-subject silhouette.
  * **Regional Hair Boundary Semantic Separation:** Reclassified `hair_outer_boundary` in `packages/stroke-engine/src/geometry/extractor.ts` to `level = 3` and `source = 'hair_mass'`. Regional boundaries are now strictly decoupled from whole-person ownership.
  * **Bilateral Jawline Continuity & Bridge Elimination:** Fixed point concatenation order in `packages/structural-analysis/src/providers/deterministic-provider.ts` by reversing the second jaw segment (`rightJaw.points.reverse()`). The mandibular path flows continuously from left ear $\to$ chin $\to$ right ear, completely eliminating the false diagonal bridge across the face.
  * **Facial Geometry Recovery:** Replaced brittle confidence drops in `packages/structural-analysis/src/reconstruction/face-reconstructor.ts` with calibrated confidence floors (>=0.35) for vermilion borders and oral fissure, ensuring soft lower-lip contours survive `minConfidence = 0.15` filtering without reverting to cartoon outlines.
  * **Hair Flank Lateral Flow Anchoring:** Fixed bottom endpoint coordinates in `packages/structural-analysis/src/reconstruction/hair-reconstructor.ts` for left and right hair flow curves, guaranteeing strands stay anchored to lateral cheeks and shoulders rather than sweeping inward across the chin and mouth.
  * **Facial Accounting & Structural Regression Suite:** Added `tests/structural-analysis/facial-structural-recovery.test.ts` (4 unit tests verifying accounting, silhouette separation, jawline continuity, and lip survival) and generated Section 14 diagnostic SVGs (`bm-01-*-fixed.svg`). All 12 benchmarks pass within SLA (512ms avg).
* **Photographic Likeness Optimization & Distortion Removal (`TASK-113`):**
  * **Suppressed Pose Skeleton Sticks in Artwork:** Defaulted `includePoseConnections` to false in `packages/stroke-engine/src/geometry/extractor.ts`, preventing BlazePose stick connections (`nose_to_left_eye_inner`, `nose_to_right_eye_inner`, horizontal shoulder cross-bar) from contaminating artwork contours.
  * **3-Zone Natural Flow Hair Engine:** Rewrote `packages/structural-analysis/src/reconstruction/hair-reconstructor.ts` to use an anatomical 3-zone volume model (cranial crown arches, left flank mass flowing around cheek to shoulder, right flank mass flowing around cheek to shoulder). Replaced the rigid swimming-cap ellipse with natural flowing strands and seeded wave dynamics framing the face, and integrated neural semantic hair mask contours.
  * **Cheek Warpaint Scar Suppression:** Omitted malar cheekbone planes from `allReconstructedPaths` in `packages/structural-analysis/src/reconstruction/index.ts`, preserving them exclusively for soft directional shading.
  * **Natural Eyebrow Reconstruction:** Decomposed MediaPipe's 10-point closed loop in `packages/structural-analysis/src/reconstruction/face-reconstructor.ts` into a smooth midline arch and fine directional hair strokes, eliminating boxed outlines and caterpillar knots.
  * **Body & Crew-Neck Collar Reconstruction:** Replaced horizontal stick lines in `packages/structural-analysis/src/reconstruction/body-reconstructor.ts` with organic curved shoulder paths, natural sternocleidomastoid neck lines, smooth crew-neck collar curves, and neural clothing segmentation mask contours.
  * **Unified Multi-Model Perception Scope:** Defaulted `perceptionScope` in `apps/web/src/App.tsx` to `'all'` so Face Landmarker, BlazePose, and Image Segmenter execute concurrently. Added automatic re-enrichment via `enrichSubjectWithReconstruction` upon segmentation completion.
  * **Closed Mask Contour Guarantee:** Updated `packages/image-processing/src/mask-contours.ts` to guarantee explicitly closed normalized loops.
  * **Verification:** Monorepo test suites passing 100% (22 suites, 320+ tests); browser subagent verified clean, accurate, realistic pencil portrait matching the photo.

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
* **Procedural Stroke Candidate Generation (`TASK-105`):**
  * Created canonical stroke candidate IR data contracts in `packages/shared-types/src/stroke.ts`: `StrokeSemanticRole`, `StrokeFilteredReason`, `StrokeCandidate`, `StrokeMetrics`, `StrokeCandidateSet`. Exported via `packages/shared-types/src/index.ts`.
  * Implemented pure TypeScript stroke candidate generation pipeline in `packages/stroke-engine/src/candidates/`:
    * `types.ts`: Stroke generation configuration (`StrokeGenerationConfig`, `DEFAULT_STROKE_GENERATION_CONFIG`).
    * `semantic-roles.ts`: Semantic role derivation mapping feature provenance and region context to 12 artistic stroke roles (`eye`, `eyebrow`, `nose`, `mouth`, `ear`, `silhouette`, `hair`, `body_structure`, `clothing_boundary`, `detail`, `texture`, `background`).
    * `partitioning.ts`: Anatomical gesture partitioning with protected anatomical structures (eyes, eyebrows, nose, mouth, ears are never fragmented), curvature inflection detection ($\theta > 75^\circ$), arc length thresholding ($L > 0.35$), closed loop opening, and `maxCandidatesPerPath` cap (8) preventing stroke explosion.
    * `properties.ts`: Deterministic stroke width model ($w = w_{\text{base}} \times (0.8 + 0.2c) \times (0.85 + 0.15I)$), parametric point density model ($\max(4, \lceil L / 0.008 \rceil)$), and composite priority scoring ($P = 0.4I + 0.3w_{\text{role}} + 0.2c + 0.1\min(1, 2L)$).
    * `filtering.ts`: Progressive stroke eligibility evaluation enforcing strict profile occlusion filtering (0 occluded drawable strokes), low-confidence rejection ($< 0.15$), degenerate length filtering ($< 0.003$), background suppression policy, and geometric validity.
    * `validator.ts`: Comprehensive candidate validation ensuring finite coordinates in $[0.0, 1.0]$, positive width/length, valid point counts, and bounded scores.
    * `generator.ts`: Unified candidate set generator transforming `VectorGeometry` into `StrokeCandidateSet` with aggregated metrics (`StrokeMetrics`).
  * Preserved strict profile occlusion semantics: on `BM-02` (90° side profile), occluded far-side features produce 0 drawable stroke candidates (filtered with reason `'occluded'`).
  * Preserved multi-subject isolation: on `BM-11` (multi-person), stroke candidates maintain isolated `subjectId` allocations.
  * Added 18 automated unit tests in `tests/stroke-engine/stroke-candidate.test.ts` (18/18 passing) verifying data contracts, validation, eligibility, occlusion handling, semantic roles, width/density models, gesture partitioning, multi-person isolation, determinism, and 100% pure TypeScript execution without browser/DOM globals.
  * Added `test:strokes` script and integrated into root `npm test` gate (100% pass across 224+ monorepo tests).
  * Added comprehensive 12-category benchmark runner `tests/benchmarks/stroke-candidate-benchmark.ts` and `npm run benchmark:strokes`:
    * Evaluated across all 12 canonical benchmark categories (`BM-01` to `BM-12`).
    * Measured average latency of **1.06 ms** (vs < 50ms SLA budget).
    * Measured average total candidates of **53.2** (Max: **59**) with **48.3** drawable candidates and **4.8** filtered candidates, completely preventing stroke explosion.
    * Peak heap memory delta remained bounded at 56.81 MB.
  * Enhanced interactive web UI in `apps/web/src/App.tsx`:
    * Computed memoized `currentStrokeCandidates` from `currentGeometry`.
    * Added visualization toggles (`Stroke Candidates`, `Drawable Only`) and Color Mode selector (`Semantic Role`, `Importance`, `Line Weight`).
    * Rendered stroke candidates on canvas with proportional line weight and dashed lines for filtered candidates.
    * Added `Stroke Candidates (TASK-105)` metric card and expandable `Stroke Candidates Audit Card` with role distribution.
    * Added `Strokes (TASK-105)` column to 12-category batch benchmark table.
    * Updated header status pill to `TASK-105 Stroke Candidates`.
  * Documented full architectural details, role mapping, partitioning logic, width/density models, and benchmark results in `docs/STROKE_CANDIDATE_GENERATION.md`, `docs/ARCHITECTURE.md` (Section 9), and `docs/DECISIONS.md` (`ADR-012`).
* **Deterministic Stroke Ordering & Composition (`TASK-106`):**
  * Created canonical stroke ordering IR data contracts in `packages/shared-types/src/stroke.ts`: `CompositionPhase`, `OrderedStroke`, `StrokeOrderingMetrics`, `OrderedStrokeSequence`. Exported via `packages/shared-types/src/index.ts`.
  * Implemented pure TypeScript stroke ordering and composition pipeline in `packages/stroke-engine/src/ordering/`:
    * `types.ts`: Ordering configuration (`StrokeOrderingConfig`, `DEFAULT_STROKE_ORDERING_CONFIG`).
    * `phases.ts`: 6-phase composition mapping (`foundation`, `primary_structure`, `expressive_features`, `secondary_anatomy`, `refinement`, `texture_accent`) reflecting human macro-to-micro drawing progression.
    * `dependencies.ts`: Directed dependency graph mapping parent structures to dependent children (iris $\to$ eye contour, eye/nose/mouth $\to$ head/jawline, hair $\to$ head, clothing $\to$ pose) and calculating dependency depth ($L_0 \to L_1 \to L_2$).
    * `comparator.ts`: Deterministic multi-factor comparator (Phase $\to$ Subject $\to$ Dependency Level $\to$ Role Precedence $\to$ Spatial Top-to-Bottom Flow $\to$ Importance $\to$ Arc Length $\to$ SourcePathId $\to$ Candidate ID tie-breaker).
    * `sorter.ts`: Partitioning into drawable vs filtered candidates, sorting drawable candidates, assigning contiguous 0-based `sequenceIndex` and `phaseIndex`, and calculating sequence metrics.
    * `validator.ts`: Comprehensive sequence validation verifying contiguous 0-based indices, uniqueness, occlusion exclusion (0 occluded drawable strokes), subject preservation, and coordinate immutability.
  * Preserved strict profile occlusion semantics: on `BM-02` (90° side profile), occluded far-side features produce 0 drawable ordered strokes.
  * Preserved multi-subject isolation: on `BM-11` (multi-person), harmonized phase interleaving ensures both subjects emerge synchronously across phases rather than one sequentially after the other.
  * Added 17 automated unit tests in `tests/stroke-engine/stroke-ordering.test.ts` (17/17 passing) verifying phase mapping, dependency hierarchy, multi-factor ordering, multi-person isolation, profile occlusion, geometry immutability, sequence integrity, and 100% pure TypeScript execution without browser/DOM globals.
  * Added `test:ordering` script and integrated into root `npm test` gate (100% pass across 241+ monorepo tests).
  * Added comprehensive 12-category benchmark runner `tests/benchmarks/stroke-ordering-benchmark.ts` and `npm run benchmark:ordering`:
    * Evaluated across all 12 canonical benchmark categories (`BM-01` to `BM-12`).
    * Measured average latency of **1.19 ms** (vs < 10ms SLA budget).
    * Validated 100% sequence integrity (0 gaps, 0 duplicates, 0 occluded drawable strokes).
    * Peak heap memory delta remained bounded at 59.50 MB.
  * Enhanced interactive web UI in `apps/web/src/App.tsx`:
    * Computed memoized `currentOrderedSequence` from `currentStrokeCandidates`.
    * Added visualization toggles (`Stroke Ordering`, `# Badges`) and Color Mode selector (`Composition Phase`, `Sequence Gradient`, `Dependency Level`).
    * Rendered ordered stroke paths with phase/gradient colors and start-of-stroke sequence index badges.
    * Added `Stroke Ordering (TASK-106)` metric card and expandable `Stroke Ordering & Composition Audit Card` with phase distribution and drawing step preview.
    * Added `Ordered (TASK-106)` column to 12-category batch benchmark table.
    * Updated header status pill to `TASK-106 Stroke Ordering`.
  * Documented full technical specifications in `docs/STROKE_ORDERING.md`, `docs/ARCHITECTURE.md` (Section 10), and `docs/DECISIONS.md` (`ADR-013`).
* **Progressive Stroke Timeline & Animation Scheduling (`TASK-107`):**
  * Created canonical stroke timeline IR data contracts in `packages/shared-types/src/timeline.ts`: `TimelineEasing`, `TimelineStroke`, `TimelineConfig`, `DEFAULT_TIMELINE_CONFIG`, `TimelineMetrics`, `StrokeTimeline`, `TimelineStrokeState`, `TimelineState`. Exported via `packages/shared-types/src/index.ts`.
  * Implemented pure TypeScript stroke timeline engine in `packages/stroke-engine/src/timeline/`:
    * `timeline-types.ts`: Internal and re-exported contracts.
    * `easing.ts`: Pure mathematical easing functions (`linear`, `easeIn`, `easeOut`, `easeInOut`, `applyEasing`).
    * `phase-timing.ts`: Composition phase multipliers ($M_{\text{phase}}$) and semantic role duration weights ($M_{\text{role}}$) with phase boundary damping.
    * `duration-model.ts`: Physical stroke drawing duration model ($\text{naturalDuration} = \text{clamp}(\text{baseDuration} + \text{lengthFactor} \cdot L \cdot M_{\text{phase}} \cdot M_{\text{role}} \cdot (0.9 + 0.2I), \text{minDuration}, \text{maxDuration})$).
    * `dependencies.ts`: Structural dependency constraint enforcement ($\text{startTime}(\text{child}) \ge \text{startTime}(\text{parent}) + \text{duration}(\text{parent}) \times 0.75$).
    * `scheduler.ts`: Natural progressive timeline scheduler with controlled overlapping ($\rho = 0.35$, max $250\text{ ms}$) and phase boundary damping ($+100\text{ ms}$).
    * `normalizer.ts`: Target duration scaling preserving stroke min/max clamps ($[80\text{ ms}, 800\text{ ms}]$).
    * `progress.ts`: Pure $O(N)$ timeline query/scrub API (`getStrokeProgress`, `getTimelineState`) with active stroke detection, tip coordinates, and out-of-bounds timestamp clamping.
    * `validator.ts`: Comprehensive mathematical validation verifying monotonicity, non-negativity, contiguous indexing, profile occlusion exclusion, and geometry immutability.
    * `index.ts`: Unified timeline orchestrator `createStrokeTimeline` compiling `OrderedStrokeSequence` into `StrokeTimeline` with concurrency and duration metrics.
  * Preserved strict profile occlusion semantics: on `BM-02` (90° side profile), occluded far-side features produce 0 timeline strokes.
  * Preserved multi-subject isolation: on `BM-11` (multi-person), stroke candidates maintain distinct `subjectId` allocations with synchronized phase timelines.
  * Added 17 automated unit tests in `tests/stroke-engine/stroke-timeline.test.ts` (17/17 passing) verifying easing curves, physical duration model, progressive scheduling, dependency ordering, overlap control, target duration normalization, query API, profile occlusion, multi-person isolation, and pure TS execution with zero DOM/window globals.
  * Added `test:timeline` script and integrated into root `npm test` gate (100% pass across 258+ monorepo tests).
  * Added comprehensive 12-category benchmark runner `tests/benchmarks/stroke-timeline-benchmark.ts` and `npm run benchmark:timeline`:
    * Evaluated across all 12 canonical benchmark categories (`BM-01` to `BM-12`).
    * Measured average timeline generation latency of **0.54 ms** (vs < 10ms SLA target).
    * Measured average stroke query latency of **20.2 µs** (0.02 ms per query).
    * Measured average stroke duration of **378.8 ms** (Min: 80ms, Max: 800ms).
    * Measured average concurrency of **2.8 simultaneous strokes**.
    * Validated 100% sequence integrity and profile occlusion exclusion across all 12 images.
    * Peak heap memory delta remained bounded at 64.18 MB.
  * Enhanced interactive web UI in `apps/web/src/App.tsx`:
    * Computed memoized `currentTimeline` and `currentTimelineState` from `currentOrderedSequence`.
    * Added visualization toggle (`Progressive Timeline`) and interactive time scrub slider ($0\% \to 100\%$) with millisecond and active/completed stroke telemetry.
    * Canvas progressive stroke drawing with real-time active drawing tip indicator glow.
    * Added `Timeline (TASK-107)` telemetry card and expandable `Progressive Stroke Timeline & Animation Scheduling Audit Card`.
    * Added `Timeline (TASK-107)` column to 12-category batch benchmark table.
    * Updated header status pill to `TASK-107 Stroke Timeline`.
  * Documented full technical specifications in `docs/STROKE_TIMELINE.md`, `docs/ARCHITECTURE.md` (Section 11), and `docs/DECISIONS.md` (`ADR-014`).
* **Procedural Stroke Renderer & Progressive Canvas Rendering (`TASK-108`):**
  * Created canonical render contract in `packages/shared-types/src/render.ts`: `PartialStrokeGeometry`, `RenderDiagnosticMode`, `RenderStroke`, `RenderConfig`, `DEFAULT_RENDER_CONFIG`, `RenderState`. Exported via `packages/shared-types/src/index.ts`.
  * Implemented pure TypeScript rendering and subdivision math in `packages/stroke-engine/src/rendering/`:
    * `bezier-subdivide.ts`: Pure De Casteljau cubic subdivision (`trimCubicBezier`), 4-segment chord arc length approximation (`approximateCubicBezierLength`), point evaluation (`evaluateCubicBezier`), and tangent evaluation (`evaluateCubicBezierDerivative`).
    * `partial-geometry.ts`: Pure arc-length parameterized partial geometry extraction (`getPartialStrokeGeometry`) for polylines and cubic Bézier splines with zero input geometry mutation.
    * `render-state.ts`: Deterministic compilation (`createRenderState`) of `StrokeTimeline` into immutable `RenderState` frame snapshots at arbitrary timestamp $t$.
    * `validator.ts`: Comprehensive mathematical validation (`validateRenderState`) verifying bounds, counts, and coordinate finiteness.
    * `index.ts`: Unified module exports re-exported by `@sketch-maker/stroke-engine` and `@sketch-maker/animation-engine`.
  * Implemented Web Canvas adapter layer in `apps/web/src/rendering/`:
    * `viewport.ts`: `ViewportTransform` mapping normalized $[0, 1] \times [0, 1]$ coordinates to physical device pixels with aspect-ratio contain letterboxing, margin padding, and `devicePixelRatio` scaling.
    * `canvas-renderer.ts`: `CanvasStrokeRenderer` with anti-aliasing, round line caps/joins, glowing cyan pen tip indicator, and 5 diagnostic color modes (`normal`, `sequence`, `phase`, `subject`, `timeline`).
    * `animation-player.ts`: `AnimationPlayer` driving wall-clock progressive animation via `requestAnimationFrame` and `performance.now()`, supporting Play, Pause, Reset, Replay, scrubbing, and speed modulation ($0.5\times$ to $3.0\times$).
    * `index.ts`: Web rendering module barrel.
  * Maintained strict architectural boundary: zero DOM/window/canvas globals in core packages (`packages/shared-types`, `packages/stroke-engine`, `packages/animation-engine`).
  * Preserved strict profile occlusion semantics: `BM-02` occluded features produce 0 rendered strokes or pixels.
  * Preserved multi-subject isolation: `BM-11` distinct `subjectId` attributes maintained and visually separable.
  * Added 10 automated unit tests in `tests/stroke-engine/procedural-renderer.test.ts` (10/10 passing) verifying De Casteljau trimming, polyline/Bézier arc-length traversal, boundary clamping, RenderState compilation, occlusion enforcement, multi-person isolation, geometry immutability, and headless portability.
  * Added `test:renderer` script and integrated into root `npm test` gate (268+ monorepo tests passing with 0 failures).
  * Added comprehensive 12-category benchmark runner `tests/benchmarks/renderer-benchmark.ts` and `npm run benchmark:renderer`:
    * Evaluated across all 12 canonical benchmark categories (`BM-01` to `BM-12`).
    * Measured average RenderState compilation latency of **0.12 ms** (vs < 2.0ms SLA target, 16.6x faster).
    * Measured average partial geometry extraction latency of **1.8 µs**.
    * Measured average stroke query latency of **4.5 µs**.
    * Measured average total strokes: **48.3**.
    * Validated 100% mathematical validity, 0 occluded strokes rendered (`BM-02`), and multi-person isolation (`BM-11`).
    * Peak heap RAM delta remained bounded at 38.80 MB.
  * Integrated interactive Animation Player into `apps/web/src/App.tsx`:
    * Play/Pause, Reset, Replay, Playback Speed controls, scrub slider, and diagnostic color mode selector.
    * Real-time canvas drawing with De Casteljau trimmed curves and pen tip glow.
    * Added `Renderer (TASK-108)` telemetry card, `Procedural Stroke Renderer Audit Card`, and benchmark table column.
    * Updated header status pill to `TASK-108 Procedural Renderer`.
  * Documented full technical specifications in `docs/PROCEDURAL_RENDERER.md`, `docs/ARCHITECTURE.md` (Section 12), and `docs/DECISIONS.md` (`ADR-015`).
* **Procedural Style Engine & Rendering Appearance System (`TASK-109`):**
  * Created canonical style contracts in `packages/shared-types/src/style.ts`: `StyleId` (`'procedural_black' | 'red_line' | 'neon' | 'blueprint' | (string & {})`), `BackgroundStyle`, `GlowStyle`, `ResolvedStrokeStyle`, `SemanticStyleModifier`, `StylePresetDefinition`, `StyleConfig`, `DEFAULT_STYLE_CONFIG`, `StyledRenderStroke`, `StyledRenderState`. Retained backward-compatible `QualityProfile` and `BackgroundMode`. Exported via `packages/shared-types/src/index.ts`.
  * Extended `RenderStroke` in `packages/shared-types/src/render.ts` with optional `style?: ResolvedStrokeStyle`.
  * Implemented pure TypeScript style engine in `packages/style-engine/`:
    * `presets/procedural-black.ts`: Reference monochrome preset with charcoal ink (`#1a1a1a`) on pure white background (`#ffffff`), solid opacity ($1.0$), round caps/joins, zero glow.
    * `presets/red-line.ts`: Expressive crimson ink (`#dc2626`) on warm parchment canvas (`#faf8f5`), high opacity ($0.95$), round caps/joins, zero glow.
    * `presets/neon.ts`: Cyberpunk dark-mode art on deep abyss (`#090a10`), electric cyan/magenta lines (`#00f0ff`), screen blend mode (`screen`), active multi-pass bloom glow (`radius: 12`, `opacity: 0.85`).
    * `presets/blueprint.ts`: Architectural draft on deep Prussian navy (`#0b1d3a`), crisp technical cyan-white lines (`#e0f2fe`), subtle transparency ($0.90$), zero glow.
    * `registry.ts`: `StyleRegistry` singleton with pre-registered presets, deterministic ID resolution, and dynamic registration via `registerStylePreset`.
    * `resolver.ts`: Deterministic 5-tier cascading precedence hierarchy resolver (`resolveStrokeStyle`, `resolveStyledRenderState`, `resolveDiagnosticColor`) mapping `RenderState` $\to$ `StyledRenderState`.
    * `index.ts`: Package barrel export with `STYLE_ENGINE_VERSION = '0.2.0'`.
  * Enforced core design invariant: `GEOMETRY (what) ≠ TIMING (when) ≠ STYLE (how)`. Coordinates, Bézier curves, arc lengths, bounding boxes, sequence indices, and timelines are 100% immutable and never modified by the style engine.
  * Preserved strict profile occlusion semantics: on `BM-02` (90° side profile), occluded far-side features produce 0 styled strokes or visible pixels.
  * Preserved multi-subject isolation: on `BM-11` (multi-person), all styled strokes maintain independent `subjectId` annotations.
  * Updated HTML5 Canvas adapter in `apps/web/src/rendering/canvas-renderer.ts`:
    * Draws preset canvas background color and opacity.
    * Applies resolved stroke properties: `color`, `lineWidth`, `lineCap`, `lineJoin`, `opacity`, `blendMode`, `glow` (`shadowColor`, `shadowBlur`), and `dash`.
    * Cleanly separates canvas DOM rendering from pure TypeScript core contracts.
  * Added 15 automated unit tests in `tests/style-engine/style-engine.test.ts` (15/15 passing in 10.87 ms) verifying registry lookups, all 4 presets, 5-tier precedence hierarchy, role modifiers, phase modifiers, hierarchy modifiers, diagnostic overrides, active pen tip styling, profile occlusion preservation, multi-person isolation, geometry immutability, and zero DOM/window/canvas globals.
  * Added `test:styles` script and integrated into root `npm test` gate (283+ monorepo tests passing with 0 failures).
  * Added comprehensive 12-category benchmark runner `tests/benchmarks/style-benchmark.ts` and `npm run benchmark:styles`:
    * Evaluated across all 12 canonical benchmark categories (`BM-01` to `BM-12`) across all 4 presets.
    * Measured average style resolution latency of **0.008 ms** ($8\ \mu\text{s}$), which is **125x faster** than the < 1.0 ms SLA target.
    * Validated 100% geometry immutability (0 coordinates modified), 100% profile occlusion enforcement (`BM-02`), and 100% multi-person isolation (`BM-11`).
    * Peak heap RAM delta remained bounded at 12.69 MB.
  * Integrated interactive Style Preset selector into `apps/web/src/App.tsx`:
    * Dropdown selector with all 4 presets (`procedural_black`, `red_line`, `neon`, `blueprint`).
    * Instantaneous style switching during active playback without interrupting time or resetting pen position.
    * Added `Style Engine (TASK-109)` telemetry card and expandable `Procedural Style Engine Audit Card`.
    * Added `Style (TASK-109)` column to 12-category batch benchmark table.
    * Updated header status pill to `TASK-109 Style Engine`.
  * Documented full architectural specifications in `docs/STYLE_ENGINE.md`, `docs/ARCHITECTURE.md` (Section 13), and `docs/DECISIONS.md` (`ADR-016`).
* **Artistic Reconstruction Fidelity Recovery (`TASK-110`):**
  * Created dedicated Feature Reconstruction & Interpretation layer in `packages/structural-analysis/src/reconstruction/` and core data contracts in `packages/shared-types/src/reconstruction.ts`:
    * `FeatureTraceStatus`: granular lifecycle states (`missing`, `detected_in_perception`, `reconstructed_in_subject`, `extracted_to_vector`, `admitted_as_candidate`, `rendered_in_stroke`).
    * `FeatureCoverageReport`: 19-anatomical-feature diagnostic matrix and aggregate coverage percentage.
    * Anatomical interfaces: `ReconstructedEye`, `ReconstructedEyebrow`, `ReconstructedNose`, `ReconstructedMouth`, `ReconstructedJawChin`, `ReconstructedEar`, `ReconstructedHair`, `ReconstructedBody`, `ArtisticReconstruction`.
  * Extended `SubjectModel.reconstruction` in `packages/shared-types/src/subject.ts` and `GeometrySource` in `packages/shared-types/src/vector.ts` (`reconstructed_feature`, `hair_mass`, `hair_flow`, `neck_contour`, `clothing_structure`).
  * Implemented pure TypeScript reconstructors in `packages/structural-analysis/src/reconstruction/`:
    * `face-reconstructor.ts`: Synthesizes anatomical eyelids, iris crescent arcs, pupil anchors, volumetric dual-contour eyebrows with medial-to-lateral tapering, 3-point convex nose tip apex dome, alar wings, columella shelf, cupid's bow, oral fissure, lower vermilion, mental crease, continuous mandibular jawline, and 3-point chin apex dome.
    * `hair-reconstructor.ts`: Anti-aliased outer silhouette smoothing, primary hair mass clusters, and internal flow direction streamlines.
    * `body-reconstructor.ts`: Bilateral neck contours, organic shoulder transitions, and clothing collar boundaries.
    * `semantic-boundary-filter.ts`: Category-specific relevance filtering (`evaluateSemanticBoundaryEligibility`) discarding noisy raw pixel-staircase hair/face_skin mask loops, filtering micro-speckle loops (<0.004 area), and capping clothing loops.
    * `coverage-reporter.ts`: 19-feature matrix trace and aggregate coverage percentage calculation for upstream and downstream pipeline stages.
    * `index.ts`: Unified reconstruction orchestrator (`reconstructSubjectFeatures`).
  * Integrated reconstruction into perception providers:
    * `DeterministicVisionProvider` attaches feature reconstruction and preserves bilateral jawline paths.
    * `landmark-mapper.ts` (MediaPipe Face/Pose/Segmenter) automatically generates and attaches `reconstruction`.
  * Enhanced Vector Extraction & Candidate Generation in `packages/stroke-engine/`:
    * `extractor.ts`: Prioritizes reconstructed feature geometry over raw perception paths; guarantees single-point landmarks (nose tip, chin apex) expand into 3-point convex arcs so vectorization never drops them; filters semantic mask loops through `evaluateSemanticBoundaryEligibility`.
    * `importance.ts`: Updated `BASE_SEMANTIC_WEIGHTS` with Section 12 artistic hierarchy: upper eyelid margin (0.95), oral fissure (0.95), pupil / iris (0.90), eyebrow mass (0.85), alar wing / nose tip (0.85), lower eyelid (0.80), cupid's bow / vermilion (0.80), jawline / chin (0.80).
  * Web Client & Visual Diagnostic Improvements in `apps/web/`:
    * Added `generatedOnly` render mode to `canvas-renderer.ts` and `App.tsx` suppressing photo underlay to expose pure procedural artwork quality.
    * Added canvas background selector: Solid White (`#ffffff`), Solid Dark (`#090a10`), and Transparent Checkerboard.
    * Added Feature Reconstruction Layer toggle and real-time visualization.
    * Added 19-Feature Coverage Diagnostic Card with progress bar, active trace pills, and provider mode badges.
    * Added Coverage % column to 12-category batch benchmark table.
    * Updated header status pill to `TASK-110 Reconstruction Fidelity`.
  * Added 17 automated unit tests:
    * `tests/structural-analysis/feature-reconstruction.test.ts`: 10/10 passing (synthesizes eyes, eyebrows, nose apex, mouth fissure, jaw/chin, hair, body, coverage report).
    * `tests/structural-analysis/semantic-boundary-filter.test.ts`: 7/7 passing (rejects noise, admits silhouette, caps clothing).
  * Added 12-category benchmark runner `tests/benchmarks/reconstruction-benchmark.ts` and `npm run benchmark:reconstruction`:
    * Average facial feature coverage: **68%** (**83%** on unoccluded frontal portraits).
    * Average overall structural coverage: **73%**.
    * Meaningful stroke ratio: **100%** (0 meaningless pixel-staircase mask loops).
    * End-to-end latency: **286.3 ms** average (well below the 1500 ms SLA).
    * Profile occlusion (`BM-02`): 100% pass (occluded side features suppressed).
    * Multi-person isolation (`BM-11`): 100% pass (distinct subject IDs preserved).
  * Documented full architectural specifications in `docs/RECONSTRUCTION_FIDELITY.md`, `docs/ARCHITECTURE.md` (Section 14), and `docs/DECISIONS.md` (`ADR-017`).
* **MediaPipe High-Fidelity Realistic Sketch Reconstruction (`TASK-111`):**
  * Established MediaPipe ML as the primary high-fidelity reconstruction provider, with fallback to deterministic CV disabled during fidelity evaluation to eliminate false-negative visual regressions.
  * Mapped complete 478 MediaPipe landmarks:
    * Left iris boundary ring (`469, 470, 471, 472`) and right iris boundary ring (`474, 475, 476, 477`) mapped to closed vector contours.
    * Upper eyelid supratarsal creases (`246, 161, 160, 159, 158, 157, 173` and `466, 388, 387, 386, 385, 384, 398`).
    * Canthi tick accents (medial/lateral corners) and directional eyelash accents.
    * Eyebrow directional hairs aligned to head, arch, and tail anatomy.
    * Nasal columella shelf (`2, 94, 278, 48`), subnasale, and nostril rims (`98, 327`).
    * Oral philtrum column ridges (`0, 37, 267, 164`), cupid's bow vermilion, and mental crease.
    * Continuous mandibular jawline (`10, 338, ..., 109`) and bilateral malar (cheekbone) planes (`117, 118, 123` and `346, 347, 352`).
  * Implemented feature-specific RDP simplification tolerances (`getFeatureSpecificTolerance` in `packages/stroke-engine/src/geometry/simplification.ts`):
    * Ultra-fine (0.0004 - 0.0006) for eyes, lashes, canthi ticks, iris, and lips.
    * Fine (0.0007 - 0.0008) for nose, eyebrows, nostrils, and hatching strokes.
    * Medium (0.0012 - 0.0018) for jawline and organic hair curves.
    * Broad (0.0035) for clothing and body outline.
  * Adaptive candidate filtering (`filtering.ts`): preserves short delicate anatomical accents and shading segments with `effectiveMinLength = 0.0006`.
  * Implemented tonal luminance analysis (`packages/structural-analysis/src/tonal/tonal-analyzer.ts`):
    * Samples photographic luminance across 8 key anatomical zones (eye sockets, nose bridge chiaroscuro, under-nose shelf, mental crease depression, submandibular jaw shadow, left and right malar planes).
    * Classifies zones into `deep_shadow`, `shadow`, `midtone`, `light`, and `highlight`.
  * Implemented 100% deterministic procedural pencil hatching & cross-hatching (`packages/structural-analysis/src/tonal/shading-generator.ts`):
    * Zero `Math.random()`; uses seeded sinusoidal hash PRNG.
    * Generates parallel directional hatching lines across midtone and shadow regions.
    * Generates cross-hatching across deep shadow regions to build realistic graphite density.
  * Created `realistic_pencil` style preset in `packages/style-engine/src/presets/realistic-pencil.ts`:
    * Clean white paper canvas (`#ffffff`).
    * Natural graphite tone `#222224`.
    * `multiply` blend mode for realistic graphite-paper interaction.
    * Dynamic stroke weights modulated by anatomical semantic role.
  * Web Client improvements in `apps/web/src/App.tsx`:
    * Default provider set to `'ml'`, default style set to `'realistic_pencil'`.
    * Default canvas mode set to pure generated-only (`showSourceImage = false`, `generatedOnly = true`).
    * Added Primary High-Fidelity Provider Status Banner displaying active provider status and notice of disabled fallback.
    * Added dedicated 8 visual debug layer toggles toolbar (`Source Image`, `MediaPipe Landmarks`, `Reconstructed Features`, `Contours`, `Tonal Regions`, `Hatching`, `Hair Flow`, `Final Artwork`).
    * Render loop updated to filter and style all reconstructed anatomical paths, tonal planes, hair streamlines, and graphite strokes.
  * Added 8 unit tests in `tests/structural-analysis/realistic-sketch.test.ts` (all 8 passing in ~49 ms).
  * Created 12-category benchmark runner `tests/benchmarks/realistic-sketch-benchmark.ts`:
    * Generates visual artifacts: `tests/benchmarks/output/bm-01-realistic-pencil.svg` and `tests/benchmarks/output/bm-01-realistic-sketch.html`.
    * Validates 100% populated tonal regions (4 to 8) and shading strokes (20 to 77) across all BM-01 to BM-12 categories.
    * Verified 100% pass across all 22 monorepo test suites (320+ tests) and 0 typecheck errors.
  * Documented full architecture in `docs/REALISTIC_SKETCH_ENGINE.md`, `docs/ARCHITECTURE.md`, `docs/BENCHMARKS.md`, and `docs/DECISIONS.md` (`ADR-018`).
* **Visual Realism Calibration & Pencil Portrait Refinement (`TASK-112`):**
  * Transformed MediaPipe procedural sketch engine output from vector avatar/diagram into a convincing, high-fidelity procedural graphite pencil portrait:
    * Eliminated cartoon over-outlining:
      * Nose bridge: Replaced harsh dual bridge lines with a softened, shadow-side guide (`confidence: 0.50`), allowing nasal volume to be defined organically by tonal shading.
      * Nostril cavities: Synthesized dark aperture cavities (`confidence: 0.96`) anchoring the nasal base with authentic 4B depth.
      * Pupil accents: Synthesized dense central circular pupil accents (`confidence: 0.98`) providing ocular focus.
      * Eyelids: Softened lower eyelid confidence (`0.65`) and lower ocular boundary to eliminate unnatural ring enclosures.
      * Lips: Softened lower vermilion boundary (`confidence: 0.60`) while anchoring oral fissure and cupid's bow, preserving lower lip highlight relief.
    * Form-following directional hatching (`packages/structural-analysis/src/tonal/shading-generator.ts`):
      * Cheek planes: Curved 3-point strokes wrapping malar convex volume.
      * Jawline shadow: 20°–30° mandibular shelf strokes following bone structure.
      * Subnasal & mental crease: Horizontal, subtly bowed shading lines modeling facial cleft depressions.
      * Orbital hollow: Downward-curved concentric orbital rim strokes.
      * Selective cross-hatching: Strictly restricted to `deep_shadow` in deep crevices (`eye_socket`, `under_nose`, `under_lip`, `jaw_shadow`, `neck_shadow`), eliminating muddy or crosshatched cheeks.
    * Multi-tier hair reconstruction (`packages/structural-analysis/src/reconstruction/hair-reconstructor.ts`):
      * 24 hair paths synthesized using seeded deterministic PRNG (zero `Math.random()`):
      * Tier 1: 6 primary cranial flow streamlines defining overall volumetric hairstyle.
      * Tier 2: 12 secondary directional wavy strands with organic sinusoidal deviation.
      * Tier 3: 6 delicate accent flyaways breaking vector uniformity.
    * Calibrated 5-tier graphite pencil scale (`packages/style-engine/src/presets/realistic-pencil.ts`):
      * Tier 1 (4B lead): Pupils, nostril cavities, deep oral fissure (widthMultiplier 1.25, opacityMultiplier 1.15).
      * Tier 2 (2B lead): Upper eyelid, brow body, upper lip line, jawline (widthMultiplier 1.05, opacityMultiplier 0.88).
      * Tier 3 (HB lead): Alar creases, lower eyelid relief, ear contour (widthMultiplier 0.85, opacityMultiplier 0.80).
      * Tier 4 (H lead): Malar and jaw form hatching, secondary hair strands (widthMultiplier 0.55, opacityMultiplier 0.50).
      * Tier 5 (2H lead): Accent flyaways, crevice cross-hatching (widthMultiplier 0.45, opacityMultiplier 0.38).
    * Web UI enhancements (`apps/web/src/App.tsx`):
      * View Layout selector: `Side-by-Side` (`[ ORIGINAL PHOTO ]` vs `[ GENERATED SKETCH ]`), `Sketch Only`, and `Overlay`.
      * Engineering Quality Diagnostic Card displaying real-time checks for anatomical anchors, nose/lip modeling, form-following hatching, multi-tier hair flow, and graphite value scale.
      * Auto-initialization and pre-warming of MediaPipe runtime delegate on page load, eliminating runtime unavailable errors.
    * Benchmark & verification artifacts:
      * Generated `tests/benchmarks/output/bm-01-comparison.html` with self-contained base64 photo and SVG sketch.
      * Generated `tests/benchmarks/output/bm-01-realism-diagnostics.json` containing complete calibration metadata.
      * Verified across all 12 benchmark categories (`BM-01` to `BM-12`).
      * Verified 22 test suites (320+ unit tests pass, 0 failures), 0 typecheck errors.
      * Interactive verification completed via browser subagent on `http://localhost:3000/`.




* **Photographic Tonal Reconstruction & High-Fidelity Graphite Portrait Engine (`TASK-113`):**
  * Transformed the conceptual model from "outlines with minimal hatching" to **graphite value accumulation** where visual form emerges primarily from photographic luminance and tonal value fields, with contours acting as selective structural reinforcement:
    * Platform-Independent `TonalField` Abstraction (`packages/shared-types/src/reconstruction.ts`):
      * Defined `TonalField` capturing continuous 2D spatial luminance $L(x,y)$ and perceptual graphite density $D(x,y)$ arrays, bounding box, min/max/mean, classification, and semantic association.
    * Continuous 2D Spatial Sampling Engine (`packages/structural-analysis/src/tonal/tonal-analyzer.ts`):
      * Implemented `sampleTonalField` with bilinear interpolation and normalized sampling across 15+ facial planes plus volumetric hair mass and clothing mass.
      * Implemented `sampleFacialLuminanceStats` with robust percentiles ($p_{10}, p_{15}, p_{35}, p_{65}, p_{85}, p_{90}$) and dynamic range normalization.
    * Non-Linear Graphite Density Response Curve (`packages/structural-analysis/src/tonal/tonal-analyzer.ts`):
      * Implemented smooth non-linear perceptual response: clean paper highlights ($D \approx 0.0$ for $u \ge 0.85$), subtle midtone transitions ($D \approx 0.20–0.55$), and rich graphite deposition ($D \approx 0.60–1.00$) in shadows and deep crevices.
    * Multi-Scale Form-Following Graphite Mark Generator (`packages/structural-analysis/src/tonal/shading-generator.ts`):
      * Scale A: Broad form & mass marks (hair mass, clothing mass).
      * Scale B: Medium form strokes (cheek planes, mandibular shelf, temples, forehead).
      * Scale C: Fine anatomical hatching (eye sockets, nasal sidewalls, lips, chin).
      * Scale D: Micro accents & crevice cross-hatching (deep crevices, under-nose, socket hollows).
      * 100% deterministic seeded sinusoidal PRNG with ZERO `Math.random()`.
    * Volumetric Hair Mass & Clothing Tonal Mass (`packages/structural-analysis/src/tonal/shading-generator.ts`):
      * Hair and clothing now visually exist as rich graphite masses even if individual strands are completely disabled.
    * Contour-Off Acceptance Test (`apps/web/src/App.tsx`):
      * Added `Tonal Portrait (Contour-Off)` diagnostic view: all contour outlines, fine anatomy, and hair strands are turned off, and the viewer clearly perceives the head, face, eyes, nose, mouth, cheeks, jaw, and hair through value alone.
    * Image-Level & 12 Semantic Region Diagnostics Engine (`packages/structural-analysis/src/tonal/tonal-diagnostics.ts`):
      * Computes global and regional mean, variance, RMS contrast, and value correlation across the 12 specified zones (`forehead`, `left_eye_socket`, `right_eye_socket`, `left_cheek`, `right_cheek`, `nose`, `mouth`, `chin`, `jaw`, `neck`, `hair`, `clothing`) plus 10-bin luminance distribution histograms.
    * Web UI Diagnostics Ribbon & Card (`apps/web/src/App.tsx`):
      * Implemented 9 interactive view modes: `Source`, `Tonal Field L(x,y)`, `Graphite Density D(x,y)`, `Graphite Marks`, `Contours Only`, `Hair Mass`, `Hair Flow`, `Tonal Portrait (Contour-Off)`, and `Final Artwork`.
      * Added real-time telemetry card with 12 semantic zone comparisons and dual-colored 10-bin histogram.
    * Artifact Generation (`scratch/generate-task113-artifacts.ts`):
      * Generated all 10 required artifacts for BM-01: `bm-01-source`, `bm-01-mediapipe`, `bm-01-tonal-field`, `bm-01-graphite-density`, `bm-01-graphite-marks`, `bm-01-hair-mass`, `bm-01-contours-only`, `bm-01-tonal-only`, `bm-01-final-generated-only`, `bm-01-side-by-side`.
    * Testing & Verification:
      * Added `tests/structural-analysis/tonal-field.test.ts` with 7 comprehensive unit tests.
      * All 23 monorepo test suites pass (100% pass rate).
      * Full monorepo typecheck (0 errors across 8 workspaces) and production build pass.

* **Segmentation-Anchored Structural Reconstruction & Spatial Ownership (`TASK-114`):**
  * Established **Segmentation as the Authoritative Outer Structural Anchor** while preserving MediaPipe Face for inner facial anatomy, MediaPipe Pose for body geometry constrained by segmentation, and TASK-113 for photographic tonal reconstruction:
    * Clean Segmentation & Small Side Artifact Filtering (`packages/structural-analysis/src/silhouette/clean-segmentation.ts`):
      * Two-pass connected component labeling with union-find disjoint-set forest.
      * Deterministic rejection of disconnected micro-components below `minAreaFraction = 0.02` (2% of subject area) and `minAbsolutePixels = 80`.
      * Morphological closing (fill pinholes) and opening (smooth boundaries).
    * Authoritative Subject Silhouette Extraction (`packages/structural-analysis/src/silhouette/authoritative-silhouette.ts`):
      * 8-directional Moore-neighborhood boundary contour tracing with clockwise winding.
      * 3-point Gaussian kernel smoothing across silhouette vertices.
      * Adaptive Ramer-Douglas-Peucker (RDP) simplification preserving natural cranial and shoulder shape.
      * Semantic regional boundary extraction (hair outer boundary, clothing outer boundary).
    * Semantic Spatial Ownership Regions (`packages/structural-analysis/src/silhouette/spatial-ownership.ts`):
      * High-performance pixel-mask sampling with tolerance margin ($O(1)$ lookup).
      * Segment-polygon intersection bisection clipping.
    * Structural Model & Fusion Engine (`packages/structural-analysis/src/silhouette/structural-model.ts`):
      * Formalized `SubjectStructure` and `StructuralModel` fusing segmentation outer silhouette, inner face anatomy, and body geometry.
      * Anchored MediaPipe Pose to subject segmentation mask, filtering skeletal connections that extend into empty background.
    * Hard Stroke Validation Gate & Segmentation-Aware Clipping (`packages/stroke-engine/src/candidates/spatial-validator.ts`):
      * Intercepts candidate strokes before ordering, scheduling, and rendering.
      * Enforces multi-factor ownership: strokes outside subject boundary or outside assigned semantic region are rejected (`outside_subject`, `wrong_semantic_region`, `invalid_subject_id`).
      * Trims crossing strokes at the silhouette boundary via bisection clipping.
    * Elimination of Unwanted Waves & Stray Diagonal Lines:
      * Constrained hair flow streamlines and strands within authoritative hair boundaries (`isPointInOrNearPoly`).
      * Constrained tonal shading to valid density regions ($D(x,y) > 0$), preventing broad clothing/hair marks from leaking into background.
    * Multi-Person Isolation (`BM-11`):
      * Enforced independent subject IDs, independent authoritative silhouettes, and isolated spatial ownership masks for all co-present subjects.
    * 9 Visual Debug Layers & Rejection Telemetry in Web UI (`apps/web/src/App.tsx`):
      * Exposed 9 layers: `Source`, `Raw Segmentation`, `Clean Segmentation`, `Authoritative Silhouette`, `Pose`, `Face Landmarks`, `Structural Fusion`, `Final Geometry`, `Final Artwork`.
      * Added real-time telemetry card displaying valid vs rejected counts, boundary-clipped counts, and detailed rejection reasons.
    * Benchmarking & Verification:
      * Added `tests/structural-analysis/segmentation-anchored-reconstruction.test.ts` with 7 unit tests (100% pass).
      * Generated all 11 required BM-01 artifacts (`bm-01-raw-segmentation`, `bm-01-clean-segmentation`, `bm-01-authoritative-silhouette`, `bm-01-pose-structure`, `bm-01-face-structure`, `bm-01-structural-fusion`, `bm-01-valid-strokes`, `bm-01-rejected-strokes`, `bm-01-final-structure`, `bm-01-final-generated-only`, `bm-01-side-by-side`).
      * Verified across all 12 benchmarks (`BM-01` to `BM-12`).
      * Monorepo: 24 test suites pass (0 failures), 0 typecheck errors across all 8 workspaces, production build succeeds.

### Fixed
* **Pose Estimation Failures on BM-02 & BM-06 (`BUG-002`):**
  * Fixed `BM-02` true side profile misclassification: shoulder/chest geometry was pulling the search envelope downwards (row 687) and leftwards (x=268), artificially diluting profile asymmetry. Head coordinate isolation correctly restores `left_profile` classification ($A_{silh} = 0.34$, $offset = -0.32$, confidence 0.62).
  * Fixed `BM-06` extreme chiaroscuro misclassification: shadowed right facial half previously lost skin-chrominance pixels (2.7% coverage), triggering a false `left_profile`. Geometric edge symmetry ($energyRatioLeft = 0.535$, $energyOffset = +0.043$) and silhouette symmetry ($A_{silh} = 0.52$) correctly recognize illumination asymmetry and preserve `frontal` classification with 0.78 confidence.
* **Session Interruption Recovery (`BUG-001`):**
  * Identified root cause of prior session halt (upstream SSE connection drop).
  * Executed `npm install` across workspace tree, linking internal packages.
  * Verified end-to-end `typecheck` (0 errors) and Vite production build.
  * Verified client runtime rendering in browser without console errors.
