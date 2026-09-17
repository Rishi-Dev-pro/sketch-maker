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
  * Added 10 automated unit tests (`tests/structural-analysis/face-region.test.ts`) covering bounding box containment, coordinate normalization, symmetry scoring, profile vs frontal detection, multi-person isolation, and high-resolution scaling invariance.
  * Added visual inspection benchmark suite (`tests/structural-analysis/pose-inspector.ts`) evaluating all 12 benchmark categories with an average latency of 15.13 ms (sub-16ms CPU time).

### Fixed
* **Session Interruption Recovery (`BUG-001`):**
  * Identified root cause of prior session halt (upstream SSE connection drop).
  * Executed `npm install` across workspace tree, linking internal packages.
  * Verified end-to-end `typecheck` (0 errors) and Vite production build.
  * Verified client runtime rendering in browser without console errors.
