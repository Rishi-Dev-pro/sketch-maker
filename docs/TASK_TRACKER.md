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
| **TASK-006** | Curate initial benchmark image dataset | **COMPLETE** | P1 | TASK-005 | `tests/images/*`, `tests/images/dataset.json`, `tests/images/validate.js` | 12 standard evaluation categories, checksummed manifest, automated validator | Verified `npm run test:dataset` (12/12 pass) |

---

## Phase 1: Feasibility Prototype (Headless Photo → Strokes Pipeline)

| Task ID | Description | Status | Priority | Dependencies | Relevant Files | Notes | Testing Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **TASK-101** | Image preprocessing & normalization module | **COMPLETE** | P1 | TASK-005, TASK-006 | `packages/image-processing/*`, `tests/image-processing/*` | Pure TS, Rec. 709 luminance, area-weighted downscaling, contrast stretch | Verified 10 unit tests + 12 benchmark images pass (68.7ms avg) |
| **TASK-102** | Initial subject segmentation / background separation | **COMPLETE** | P1 | TASK-101 | `packages/structural-analysis/*`, `tests/structural-analysis/*` | Multi-cue perceptual saliency & gradient-barrier segmentation | Verified 10 unit tests + 12 benchmark images pass (239.7ms avg) |
| **TASK-103** | Initial facial landmark & structural contour extraction | `COMPLETE` | P1 | TASK-102 | `packages/structural-analysis/*`, `packages/shared-types/*` | Step 1 & 1.1 Complete (Face region & pose); Step 2A (Eyes); Step 2B (Eyebrows); Step 2C (Nose); Step 2D (Mouth); Step 2E.1 (Jawline/Chin); Step 2E.2 (Ears); Step 2F (Hair) | Verified 148 total unit & regression tests + 12 benchmark images pass (0 errors) |
| **TASK-103.5** | Pretrained vision backend comparative evaluation | **COMPLETE** | P1 | TASK-103 | `docs/VISION_BACKEND_EVALUATION.md`, `tests/vision-backends/*`, `tests/artifacts/vision-backend-evaluation.html` | Evaluated MediaPipe Tasks Vision vs. ONNX Runtime Web vs. deterministic baseline | Benchmark runner + interactive HTML report + architectural recommendation (Option C: Hybrid) |
| **TASK-103.6** | Vision provider architecture & hybrid perception abstraction | **COMPLETE** | P1 | TASK-103.5 | `packages/structural-analysis/src/providers/*`, `tests/structural-analysis/vision-provider.test.ts` | Decoupled provider abstraction, VisionCoordinator, DeterministicVisionProvider, MediaPipeVisionProvider stub, evidence-aware hybrid merge, zero-ML fallback guarantee | Verified 14/14 unit tests pass, full monorepo test suite passes, typecheck passes, build passes |
| **TASK-103.7** | MediaPipe Face Landmarker integration | **COMPLETE** | P1 | TASK-103.6 | `apps/web/src/vision/mediapipe/*`, `docs/MEDIAPIPE_FACE_LANDMARKER.md`, `tests/structural-analysis/mediapipe-landmark-mapper.test.ts` | Lazy-loaded Vite chunk, 478-landmark mapping, profile occlusion enforcement (BM-02), zero ear fabrication, hybrid reconciliation | Verified 7/7 mapper tests pass, 162+ monorepo tests pass, production bundle split verified, interactive web inspector verified |
| **TASK-103.8** | MediaPipe Pose Landmarker integration | **COMPLETE** | P1 | TASK-103.7 | `apps/web/src/vision/mediapipe/*`, `docs/MEDIAPIPE_POSE_LANDMARKER.md`, `tests/structural-analysis/mediapipe-pose-mapper.test.ts` | Canonical BodyPose contract, shared FilesetResolver runtime, 33-joint BlazePose mapping, Face+Pose spatial association (d < 0.25), standing/sitting/multi-subject handling, Vite bundle isolation | Verified 12/12 mapper tests pass, 174+ monorepo tests pass, 0 typecheck errors across 8 workspaces, interactive web inspector verified |
| **TASK-103.9** | MediaPipe Image Segmenter integration | **COMPLETE** | P1 | TASK-103.8 | `apps/web/src/vision/mediapipe/*`, `docs/MEDIAPIPE_IMAGE_SEGMENTER.md`, `tests/structural-analysis/mediapipe-segmenter-mapper.test.ts` | Canonical SemanticSegmentation contract, shared FilesetResolver runtime, 6-class mapping, nearest-neighbor resampling, evidence-aware hybrid reconciliation, Vite bundle isolation | Verified 12/12 mapper/reconciler tests pass, 186+ monorepo tests pass, 0 typecheck errors across 8 workspaces, interactive web inspector verified |
| **TASK-104** | Contour & Vector Generation (Polyline cleaning, adaptive RDP, Bézier fitting, mask tracing, importance model) | **COMPLETE** | P1 | TASK-103.9 | `packages/stroke-engine/src/geometry/*`, `packages/shared-types/src/vector.ts`, `docs/CONTOUR_VECTOR_GENERATION.md` | Canonical VectorGeometry IR, cleaning, clamping, adaptive RDP simplification, Catmull-Rom cubic Bézier fitting, Moore-neighborhood mask tracing, deterministic importance model | Verified 20/20 unit tests pass, 12-category benchmark passes (1.98ms avg latency, 81.6% point reduction, 100% occlusion pass, multi-person isolation), interactive web inspector verified |
| **TASK-105** | Procedural Stroke Candidate Generation | **COMPLETE** | P1 | TASK-104 | `packages/stroke-engine/src/candidates/*`, `packages/shared-types/src/stroke.ts`, `docs/STROKE_CANDIDATE_GENERATION.md` | Platform-independent StrokeCandidate IR, semantic role mapping, curvature gesture partitioning, stroke width/density, priority scoring, anti-explosion caps | Verified 18/18 unit tests pass, 12-category benchmark passes (1.06ms avg latency, 0 explosion, 100% occlusion pass, multi-person isolation), interactive web inspector verified |
| **TASK-106** | Stroke Ordering & Composition | **COMPLETE** | P1 | TASK-105 | `packages/stroke-engine/src/ordering/*`, `packages/shared-types/src/stroke.ts`, `docs/STROKE_ORDERING.md` | Deterministic progressive ordering IR, 6-phase composition model, structural dependency hierarchy, multi-factor deterministic comparator, non-destructive sequence wrapper | Verified 17/17 unit tests pass, 12-category benchmark passes (1.19ms avg latency, 100% sequence validity, 0 index gaps, 0 duplicates, profile occlusion pass, multi-person isolation), interactive web inspector verified |
| **TASK-107** | Progressive Stroke Timeline & Animation Scheduling | **COMPLETE** | P1 | TASK-106 | `packages/shared-types/src/timeline.ts`, `packages/stroke-engine/src/timeline/*`, `packages/animation-engine/*`, `docs/STROKE_TIMELINE.md` | Pure TS timeline engine, non-destructive TimelineStroke wrapper, physical duration model, structural dependency scheduling, overlap control (rho=0.35), target duration normalization, pure O(N) query API | Verified 17/17 unit tests pass, 12-category benchmark passes (0.54ms avg latency, 20.2µs avg query, 100% occlusion pass, multi-person isolation), interactive web inspector verified |
| **TASK-108** | Progressive Canvas 2D Stroke Rendering & Animation Playback | `NOT_STARTED` | P1 | TASK-107 | `packages/animation-engine/*`, `apps/web/*` | RequestAnimationFrame playback loop, dynamic stroke interpolation, active pen/tip visualizer, pause/scrub/play controls | Visual & FPS benchmarks |

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
