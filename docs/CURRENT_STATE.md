# CURRENT_STATE.md

## Project State Snapshot

* **Current Date / Time:** 2026-09-17
* **Current Phase:** Phase 1 — Feasibility Prototype (Headless Photo → Strokes Pipeline)
* **Current Version:** v0.2.0-alpha (Image Preprocessing & Normalization Engine)
* **Current Milestone:** M1 — Feasibility Prototype (Headless Pipeline)
* **Status:** IN_PROGRESS (Phase 1 Underway: TASK-101 Complete)

---

## 1. Where Exactly Are We Right Now?
Phase 1 implementation has commenced:
1. **`packages/image-processing` (TASK-101)** is fully implemented in pure TypeScript with zero runtime dependencies.
2. Implemented area-weighted box downsampling with zero aliasing, Rec. 709 perceptual photometric luminance extraction, statistical distribution accumulation, percentile-bounded contrast normalization ($p_1 \to p_{99}$), and edge-preserving bilateral filtering.
3. Automated test suite (`npm run test:preprocess`) passes 10/10 comprehensive unit tests covering dimension math, energy conservation, photometric coefficients, contrast expansion, and deterministic execution.
4. Benchmark suite (`npm run benchmark:image-processing`) validated across all 12 benchmark dataset categories (`BM-01` to `BM-12`). Average balanced profile latency is **68.7 ms** (well below 300ms SLA). 24MP high-resolution downsampling executes in **240.3 ms** with peak heap usage strictly constrained to **18.6 MB** (far below 150MB SLA ceiling).
5. The monorepo builds cleanly and typechecks with 0 errors.

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
* [x] **Web App Foundation Verification:** `apps/web` builds cleanly with Vite, typechecks with 0 errors, and renders verified in browser.

---

## 3. Currently Being Worked On
* **TASK-102:** Initial subject segmentation / background separation (`packages/structural-analysis/segmentation.ts`).

---

## 4. What Is Partially Implemented
* Headless package stubs (`structural-analysis`, `stroke-engine`, `style-engine`, `animation-engine`, `export-engine`): Package manifests and version constants exist; algorithmic implementations begin in subsequent Phase 1 tasks.

---

## 5. What Is Blocked
* None. Image preprocessing pipeline is verified and unblocks structural analysis.

---

## 6. Known Bugs & Anomalies
* None. All 10 unit tests and 12 benchmark image evaluations pass cleanly.

---

## 7. Known Technical Limitations
* Environment is Windows powershell; commands must account for PowerShell syntax.

---

## 8. Immediate Next Tasks

### Immediate Next Task (Task ID: `TASK-102`):
* `TASK-102`: Initial subject segmentation / background separation (`packages/structural-analysis/segmentation.ts`). Implement local browser-compatible foreground extraction using luminance and color gradients to isolate subject silhouettes from background clutter.

### Next Few Planned Tasks (Phase 1):
1. `TASK-103`: Initial facial landmark & structural contour extraction (`packages/structural-analysis/landmarks.ts`).
2. `TASK-104`: Polyline extraction & curve simplification (`packages/stroke-engine/simplification.ts`).
3. `TASK-105`: Semantic importance weighting & stroke sorting (`packages/stroke-engine/ordering.ts`).
4. `TASK-106`: Headless canvas draw runner & progressive animation test (`tests/rendering/prototype_runner.html`).

---

## 9. Current Technical Risks & Mitigations

| Risk | Impact | Mitigation Strategy |
| :--- | :--- | :--- |
| **Edge Detection Noise:** Basic edge filters produce excessive clutter in hair and background. | High | Use semantic segmentation and landmark-guided importance weighting. Suppress background contours by default. |
| **Browser Execution Latency:** Complex ML models or heavy pixel processing freezing the UI thread. | High | Offload image processing to Web Workers; leverage lightweight models or optimized WebAssembly; enforce strict image downscaling before analysis. |
| **Coupling Engine to Web DOM:** Relying on browser Canvas/DOM inside core packages, breaking future React Native portability. | Critical | Keep `packages/structural-analysis`, `packages/stroke-engine`, and `packages/animation-engine` 100% pure TypeScript with headless data representations. |
| **Overengineering Scope:** Attempting full Vercel UI, gallery, social sharing, and complex styling before the core vectorization looks aesthetically compelling. | High | Enforce Phase 1 Feasibility Prototype: validate visual stroke quality on a fixed benchmark set before locking UI. |
