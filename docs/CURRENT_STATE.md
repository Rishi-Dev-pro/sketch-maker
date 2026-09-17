# CURRENT_STATE.md

## Project State Snapshot

* **Current Date / Time:** 2026-09-17
* **Current Phase:** Phase 1 — Feasibility Prototype (Headless Photo → Strokes Pipeline)
* **Current Version:** v0.3.0-alpha (Subject Segmentation & Saliency Analysis Engine)
* **Current Milestone:** M1 — Feasibility Prototype (Headless Pipeline)
* **Status:** IN_PROGRESS (Phase 1 Underway: TASK-101 & TASK-102 Complete)

---

## 1. Where Exactly Are We Right Now?
Phase 1 pipeline is advancing through structural analysis:
1. **`packages/image-processing` (TASK-101):** Fully implemented, verified with 10 unit tests, and benchmarked across all 12 benchmark categories (68.7ms average latency; 24MP downsampling in 240.3ms).
2. **`packages/structural-analysis` Segmentation (TASK-102):** Implemented multi-cue perceptual saliency & gradient-barrier segmentation with zero external model dependencies (`ADR-008`). Evaluated across all 12 benchmark categories with an average latency of **239.7 ms** (combined pipeline latency: **308.4 ms**, well below the 1500 ms SLA target). Peak heap RAM remained bounded at **~24.5 MB**.
3. **Automated Verification:** 10/10 segmentation unit tests passing (`tests/structural-analysis/segmentation.test.ts`), visual inspection HTML report generated (`tests/artifacts/segmentation-report.html`), all monorepo workspaces typecheck cleanly (0 errors), and client production build passes.
4. **Next Step:** Ready to advance to **TASK-103** (Initial facial landmark & structural contour extraction in `packages/structural-analysis/landmarks.ts`).

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
* [x] **Web App Foundation Verification:** `apps/web` builds cleanly with Vite, typechecks with 0 errors, and renders verified in browser.

---

## 3. Currently Being Worked On
* Milestone transition: TASK-102 complete. Preparing to begin **TASK-103** (`packages/structural-analysis/landmarks.ts`).

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
