# TESTING.md

## Testing Strategy & Verification Guidelines

> **The Core Rule of Testing:**
> *"A feature is not COMPLETE simply because it compiles, the page opens, or the code looks correct. It must behave correctly under intended and invalid inputs."*

---

## 1. Multi-Level Testing Pyramid

```
                ┌─────────────────────────┐
                │   Visual & Quality      │  Benchmark evaluation on 12 standard images
                │      Evaluation         │
                ├─────────────────────────┤
                │     Browser E2E         │  Playwright automated user journeys
                │     Verification        │  (Upload → Progressive Draw → Replay → Download)
                ├─────────────────────────┤
                │    Integration Tests    │  Package cross-talk: Image → Structural → Strokes
                ├─────────────────────────┤
                │       Unit Tests        │  Vector math, curve simplification, algorithms
                └─────────────────────────┘
```

---

## 2. Testing Levels & Responsibilities

### 2.1 Unit Tests (Vitest)
* **Scope:** Individual algorithmic modules in isolation.
* **Coverage Targets:**
  * Math & geometry utilities (Bézier curves, distance functions, bounding boxes).
  * Polyline simplification (Ramer-Douglas-Peucker algorithm).
  * Color space conversions, brightness/contrast calculations.
  * Stroke ordering and sorting algorithms.
* **Execution:** Fast, headless, runs in CI on every push/commit.

### 2.2 Integration Tests
* **Scope:** Pipeline stage boundaries and schema conformance.
* **Coverage Targets:**
  * Image buffer → `SubjectModel` schema validation.
  * `SubjectModel` → `StrokeModel` generation consistency.
  * Verification that stroke counts conform to quality profile budgets (`FAST`, `BALANCED`, `HIGH`).
  * Verify that cache keys invalidate only on source image changes, not style changes.

### 2.3 Visual Regression & Canvas Rendering Tests
* **Scope:** Canvas rendering accuracy and rendering consistency.
* **Coverage Targets:**
  * Canvas draw output snapshots for deterministic stroke inputs.
  * Style renderer verification (verifying that Neon produces glows, Blueprint produces grids, etc.).
  * OffscreenCanvas headless rendering.

### 2.4 Browser E2E Tests (Playwright)
* **Scope:** Complete browser user journey.
* **Flows Tested:**
  1. Open home page → drop photo.
  2. Canvas initializes, loading indicator displays during analysis.
  3. Progressive drawing loop begins and renders smoothly.
  4. User clicks "Replay" → canvas clears and redraws without re-triggering analysis.
  5. User switches style → canvas updates immediately.
  6. User clicks "Save / Download" → PNG file is generated and triggered.
  7. Invalid file upload (e.g., text file, corrupt image) triggers human-friendly error toast, zero crash.

### 2.5 Performance & Memory Tests
* **Scope:** Memory leaks and frame stability.
* **Checks:**
  * Continuous memory allocation during progressive drawing (zero runaway allocations).
  * Frame rate stability (measuring dropped frames during 60 FPS animation).
  * Garbage collection impact after multiple image generations.

---

## 3. Definition of Done (DoD) Checklist

Before marking any task as `COMPLETE` in `docs/TASK_TRACKER.md`:
* [ ] Feature functions correctly on intended inputs.
* [ ] Invalid, corrupt, and extreme inputs are explicitly handled without crashes.
* [ ] No console errors or unhandled promise rejections.
* [ ] Unit/integration tests added and passing.
* [ ] Visual quality meets the standard bar (scored against benchmark criteria).
* [ ] Performance & memory footprints measured against targets in `docs/BENCHMARKS.md`.
* [ ] Existing functionality remains intact (zero regressions).
* [ ] Documentation updated (`docs/CURRENT_STATE.md`, `docs/TASK_TRACKER.md`, `docs/CHANGELOG.md`).

---

## 4. Key Test & Benchmark Commands

| Command | Target | Scope |
| :--- | :--- | :--- |
| `npm test` | Monorepo root | Runs all unit and integration test suites across all packages |
| `npm run test:dataset` | `tests/images/` | Validates standard 12-image benchmark dataset integrity |
| `npm run test:geometry` | `tests/stroke-engine/geometry.test.ts` | 20 unit tests for TASK-104 vector geometry |
| `npm run benchmark:geometry` | `tests/benchmarks/geometry-benchmark.ts` | 12-category vector extraction & RDP benchmark |
| `npm run test:strokes` | `tests/stroke-engine/stroke-candidate.test.ts` | 18 unit tests for TASK-105 stroke candidate generation |
| `npm run benchmark:strokes` | `tests/benchmarks/stroke-candidate-benchmark.ts` | 12-category stroke candidate benchmark |
| `npm run test:ordering` | `tests/stroke-engine/stroke-ordering.test.ts` | 17 unit tests for TASK-106 deterministic stroke ordering |
| `npm run benchmark:ordering` | `tests/benchmarks/stroke-ordering-benchmark.ts` | 12-category stroke ordering & composition benchmark |
| `npm run test:timeline` | `tests/stroke-engine/stroke-timeline.test.ts` | 17 unit tests for TASK-107 progressive stroke timeline |
| `npm run benchmark:timeline` | `tests/benchmarks/stroke-timeline-benchmark.ts` | 12-category stroke timeline & animation scheduling benchmark |
| `npm run typecheck` | Monorepo root | TypeScript typecheck across all 8 workspaces |
| `npm run build` | Monorepo root | Production build of web application and libraries |

