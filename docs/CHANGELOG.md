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

### Fixed
* **Session Interruption Recovery (`BUG-001`):**
  * Identified root cause of prior session halt (upstream SSE connection drop).
  * Executed `npm install` across workspace tree, linking internal packages.
  * Verified end-to-end `typecheck` (0 errors) and Vite production build.
  * Verified client runtime rendering in browser without console errors.
