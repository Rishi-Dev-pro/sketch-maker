# TASK_TRACKER.md

## Master Task Tracker

> **Rules:**
> 1. Statuses: `NOT_STARTED`, `PLANNED`, `IN_PROGRESS`, `BLOCKED`, `NEEDS_DEBUG`, `NEEDS_TESTING`, `COMPLETE`, `DEFERRED`.
> 2. Never mark a task `COMPLETE` merely because code was written. It must be tested, verified, and documented.

---

## Phase 0: Product & Technical Foundation

| Task ID | Description | Status | Priority | Dependencies | Relevant Files | Notes | Testing Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **TASK-000** | Read & analyze complete 13-page project planning document | **COMPLETE** | P0 | None | Project PDF | All vision, architectural rules, and phases extracted | Verified against PDF OCR |
| **TASK-001** | Create persistent project knowledge system (`docs/*`) | **COMPLETE** | P0 | TASK-000 | `docs/*` | 11 core documents created | Verified completeness |
| **TASK-002** | Present initial audit & receive user sign-off to begin scaffolding | **COMPLETE** | P0 | TASK-001 | `docs/CURRENT_STATE.md` | Direction aligned, proceed instruction provided | Not applicable |
| **TASK-003** | Initialize git repository and `.gitignore` | **COMPLETE** | P0 | TASK-002 | `.gitignore`, `.git/` | Initialized and committed (`058e8fc`) | Verified clean git status |
| **TASK-004** | Monorepo scaffolding & package workspace structure | **COMPLETE** | P1 | TASK-003 | `package.json`, `packages/*`, `apps/*` | npm workspaces configured, packages linked | Verified `npm run build` |
| **TASK-005** | Define core data contracts in `packages/shared-types` | **COMPLETE** | P1 | TASK-004 | `packages/shared-types/src/*` | `SubjectModel`, `Stroke`, `StyleConfig`, etc. | Verified `npm run typecheck` (0 errors) |
| **TASK-006** | Curate initial benchmark image dataset | **IN_PROGRESS** | P1 | TASK-005 | `tests/images/*` | 12 standard evaluation categories | Pending verification |

---

## Phase 1: Feasibility Prototype (Headless Photo → Strokes Pipeline)

| Task ID | Description | Status | Priority | Dependencies | Relevant Files | Notes | Testing Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **TASK-101** | Image preprocessing & normalization module | `NOT_STARTED` | P1 | TASK-005 | `packages/image-processing/*` | Resize, grayscale, contrast enhancement | Not tested |
| **TASK-102** | Initial subject segmentation / background separation | `NOT_STARTED` | P1 | TASK-101 | `packages/structural-analysis/segmentation.ts` | Local browser-compatible foreground extraction | Not tested |
| **TASK-103** | Initial facial landmark & structural contour extraction | `NOT_STARTED` | P1 | TASK-102 | `packages/structural-analysis/landmarks.ts` | Face geometry & boundary detection | Not tested |
| **TASK-104** | Polyline extraction & curve simplification (Ramer-Douglas-Peucker) | `NOT_STARTED` | P1 | TASK-103 | `packages/stroke-engine/simplification.ts` | Convert raw contours to clean Bézier/polylines | Not tested |
| **TASK-105** | Semantic importance weighting & stroke sorting | `NOT_STARTED` | P1 | TASK-104 | `packages/stroke-engine/ordering.ts` | Eyes > Nose > Mouth > Silhouette > Clothing | Not tested |
| **TASK-106** | Headless canvas draw runner & progressive animation test | `NOT_STARTED` | P1 | TASK-105 | `tests/rendering/prototype_runner.html` | Verify progressive reveal quality | Visual verification required |

---

## Phase 2: Structural Analysis Engine

| Task ID | Description | Status | Priority | Dependencies | Relevant Files | Notes | Testing Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **TASK-201** | Robust `SubjectModel` generator package | `NOT_STARTED` | P1 | TASK-106 | `packages/structural-analysis/*` | Formalize structural tree | Unit tests |
| **TASK-202** | Background suppression strategies (Remove, Blur, Outline) | `NOT_STARTED` | P2 | TASK-201 | `packages/structural-analysis/background.ts` | Eliminate background clutter | Benchmark verification |
| **TASK-203** | Confidence mapping and edge noise filtering | `NOT_STARTED` | P2 | TASK-201 | `packages/structural-analysis/filter.ts` | Suppress low-confidence micro-edges | Benchmark verification |

---

## Phase 3: Web Rendering Prototype

| Task ID | Description | Status | Priority | Dependencies | Relevant Files | Notes | Testing Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **TASK-301** | Canvas 2D progressive stroke animation renderer | `NOT_STARTED` | P1 | TASK-106 | `packages/animation-engine/*` | 60 FPS requestAnimationFrame loop | FPS benchmarks |
| **TASK-302** | Minimal web playground UI (`apps/web`) | `NOT_STARTED` | P1 | TASK-301 | `apps/web/*` | Photo dropzone + live rendering viewport | Browser verification |

---

## Phase 4: Web MVP (Vercel Product)

| Task ID | Description | Status | Priority | Dependencies | Relevant Files | Notes | Testing Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **TASK-401** | Production Next.js UI implementation | `NOT_STARTED` | P1 | TASK-302 | `apps/web/src/*` | Sleek, dark mode, responsive layout | Browser tests |
| **TASK-402** | Replay & basic PNG download controls | `NOT_STARTED` | P1 | TASK-401 | `apps/web/src/components/*` | Instant replay without re-analyzing | Functional tests |
| **TASK-403** | Production build & Vercel deployment validation | `NOT_STARTED` | P0 | TASK-402 | `vercel.json`, build scripts | Verify zero SSR/CSR hydration bugs | Live URL validation |

---

## Phases 5+: Deferred Future Features

| Task ID | Description | Status | Priority | Dependencies | Relevant Files | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **TASK-501** | Precision benchmarking & quality optimization | `DEFERRED` | P1 | Phase 4 | `docs/BENCHMARKS.md` | Post-MVP precision sprint |
| **TASK-601** | Multi-style rendering system (Cinematic, Sketch, Neon, etc.) | `DEFERRED` | P1 | Phase 5 | `packages/style-engine/*` | Cached stroke re-rendering |
| **TASK-701** | User customization controls (color, density, thickness) | `DEFERRED` | P2 | TASK-601 | `apps/web/*` | Interactive controls |
| **TASK-801** | High-res PNG & MP4/WebM video export | `DEFERRED` | P2 | TASK-701 | `packages/export-engine/*` | Client-side video encoding |
| **TASK-901** | Web Workers & OffscreenCanvas performance acceleration | `DEFERRED` | P2 | TASK-801 | `packages/*` | 60 FPS lock across low-end devices |
| **TASK-1001**| PWA installable web app support | `DEFERRED` | P3 | Phase 9 | `apps/web/public/manifest.json` | Local storage & service worker |
| **TASK-1101**| React Native mobile client scaffolding | `DEFERRED` | P3 | Phase 9 | `apps/mobile/*` | Cross-platform core reuse |
