# CURRENT_STATE.md

## Project State Snapshot

* **Current Date / Time:** 2026-09-17
* **Current Phase:** Phase 1 — Feasibility Prototype (Headless Photo → Strokes Pipeline)
* **Current Version:** v0.3.5-alpha (Eyebrow Landmark Detection - Step 2B Complete)
* **Current Milestone:** M1 — Feasibility Prototype (Headless Pipeline)
* **Status:** IN_PROGRESS (Phase 1 Underway: TASK-103 Step 2B Complete)

---

## 1. Where Exactly Are We Right Now?
Phase 1 pipeline is advancing through structural analysis:
1. **`packages/image-processing` (TASK-101):** Fully implemented, verified with 10 unit tests, and benchmarked across all 12 benchmark categories (68.7ms average latency; 24MP downsampling in 240.3ms).
2. **`packages/structural-analysis` Segmentation (TASK-102):** Implemented multi-cue perceptual saliency & gradient-barrier segmentation with zero external model dependencies (`ADR-008`). Evaluated across all 12 benchmark categories with an average latency of **239.7 ms** (combined pipeline latency: **308.4 ms**, well below the 1500 ms SLA target). Peak heap RAM remained bounded at **~24.5 MB**.
3. **TASK-103 Step 1 & Step 1.1 (Face Region Isolation & Pose Robustness Correction):** Implemented `estimateFaceRegion` and `estimateAllFaceRegions` (`packages/structural-analysis/src/face-region.ts`) with a multi-cue geometric evidence model. Decoupled facial geometry from appearance chrominance; isolated head coordinate frame from torso/chest contamination (`BM-02` true profile: `left_profile`, conf 0.62); decoupled illumination shadow from profile yaw (`BM-06` chiaroscuro: `frontal`, conf 0.78). Average latency: 14.45 ms.
4. **TASK-103 Step 2A (Eye & Eyelid Landmark Detection):** Implemented `detectEyeLandmarks` (`packages/structural-analysis/src/eyes.ts`) with multi-cue ocular search (luminance valleys, lateral sclera-iris contrast, horizontal Sobel edge energy, upper/lower eyelid margin tracing, and evidence-dependent iris/pupil resolution). Strictly enforces pose-driven visibility: profile occluded eyes (`BM-02`) are marked `'occluded'` with confidence 0 and 0 points without hallucinating coordinates. Average extraction latency: **1.17 ms**. Visual inspection report: `tests/artifacts/eye-report.html`.
5. **TASK-103 Step 2B (Eyebrow Landmark Detection & Quality Audit):** Implemented `detectEyebrows` (`packages/structural-analysis/src/eyebrows.ts`) using supraorbital ridge dynamic programming, directional edge gradients, and valley contrast. Enforces strict eyelid/glasses separation constraints. Profile hidden eyebrows are strictly marked `'occluded'` with confidence 0 and 0 points (`BM-02`). Average extraction latency: **3.06 ms - 3.62 ms**. Visual inspection report: `tests/artifacts/eyebrow-report.html`. Quality audit confirmed eyebrow paths track true anatomical supraorbital arches (consistently 12%-17% of face height above detected upper eyelids) without hijacking spectacle rims (`BM-03`), forehead hairlines (`BM-05`), or chiaroscuro shadows (`BM-06`).
6. **Automated Verification:** 71/71 automated checks pass (12 dataset integrity + 10 preprocessing + 10 segmentation + 14 face region + 13 eyes + 12 eyebrows), all 8 monorepo workspaces typecheck cleanly (0 errors), and client production build passes in 704ms.
7. **Next Step:** Ready for Step 2C of TASK-103 (Nose landmark detection) pending user review. Do not start Step 2C automatically.

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
* [x] **Web App Foundation Verification:** `apps/web` builds cleanly with Vite, typechecks with 0 errors, and renders verified in browser.

---

## 3. Currently Being Worked On
* **TASK-103 (In Progress - Step 2B Audited & Complete):** Eyebrow landmark detection and focused quality audit complete and verified. Awaiting user sign-off before proceeding to Step 2C (Nose landmark detection).


---

## 4. What Is Partially Implemented
* Headless package stubs (`stroke-engine`, `style-engine`, `animation-engine`, `export-engine`): Package manifests and version constants exist; algorithmic implementations begin in subsequent Phase 1 tasks.

---

## 5. What Is Blocked
* None. Subject segmentation pipeline is verified and unblocks landmark & structural contour extraction.

---

## 6. Known Bugs & Anomalies
* None. All 20 unit tests (10 preprocessing + 10 segmentation) and 12 benchmark image evaluations pass cleanly.

---

## 7. Known Technical Limitations
* Environment is Windows powershell; commands must account for PowerShell syntax.

---

## 8. Immediate Next Tasks

### Immediate Next Task (Task ID: `TASK-103`):
* `TASK-103`: Initial facial landmark & structural contour extraction (`packages/structural-analysis/landmarks.ts`). Detect facial feature geometry (eyes, eyebrows, nose, mouth, jawline, ears) within the segmented foreground mask.

### Next Few Planned Tasks (Phase 1):
1. `TASK-104`: Polyline extraction & curve simplification (`packages/stroke-engine/simplification.ts`).
2. `TASK-105`: Semantic importance weighting & stroke sorting (`packages/stroke-engine/ordering.ts`).
3. `TASK-106`: Headless canvas draw runner & progressive animation test (`tests/rendering/prototype_runner.html`).

---

## 9. Current Technical Risks & Mitigations

| Risk | Impact | Mitigation Strategy |
| :--- | :--- | :--- |
| **Edge Detection Noise:** Basic edge filters produce excessive clutter in hair and background. | High | Use semantic segmentation and landmark-guided importance weighting. Suppress background contours by default. |
| **Browser Execution Latency:** Complex ML models or heavy pixel processing freezing the UI thread. | High | Offload image processing to Web Workers; leverage lightweight models or optimized WebAssembly; enforce strict image downscaling before analysis. |
| **Coupling Engine to Web DOM:** Relying on browser Canvas/DOM inside core packages, breaking future React Native portability. | Critical | Keep `packages/structural-analysis`, `packages/stroke-engine`, and `packages/animation-engine` 100% pure TypeScript with headless data representations. |
| **Overengineering Scope:** Attempting full Vercel UI, gallery, social sharing, and complex styling before the core vectorization looks aesthetically compelling. | High | Enforce Phase 1 Feasibility Prototype: validate visual stroke quality on a fixed benchmark set before locking UI. |
