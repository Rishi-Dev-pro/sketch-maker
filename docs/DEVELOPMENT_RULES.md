# DEVELOPMENT_RULES.md

## Permanent Engineering Rules & Principles

Every engineering agent working on this repository must adhere strictly to these rules. Never bypass them for speed or convenience.

---

### Rule 1: Understand Before Modifying
* Never edit code blindly or make optimistic guesses.
* Understand the data flow, type contracts, and downstream dependents before altering any module or function.

### Rule 2: Inspect Relevant Code Before Changing It
* Always read the exact implementation lines of any function, module, or type definition you intend to modify.
* Do not rely on assumptions about what an API does.

### Rule 3: Do Not Rewrite Working Systems Unnecessarily
* If an existing algorithm, utility, or component works correctly and fulfills requirements, enhance or wrap it rather than rewriting it from scratch.
* Avoid "not invented here" churn.

### Rule 4: Prefer Small, Controlled Changes
* Break tasks down into verifiable increments.
* Make atomic commits/edits that are easy to reason about, test, and revert if needed.

### Rule 5: Preserve Existing Functionality
* Regression prevention is critical.
* An improvement in one style or pipeline stage must not break existing styles, renderers, or image dimensions.

### Rule 6: Do Not Introduce Dependencies Without Justification
* Zero gratuitous npm packages.
* Every third-party library introduced must be justified based on: bundle size, browser/mobile portability, maintenance status, license, and offline viability.
* Record every dependency decision in `docs/DECISIONS.md`.

### Rule 7: Do Not Duplicate Logic
* Common vector math, color manipulation, curve interpolation, bounding-box utilities, and canvas helpers belong in shared utility modules or shared packages.
* Reuse existing abstractions.

### Rule 8: Keep Modules Focused (Single Responsibility)
* Keep each module and package small, cohesive, and clearly bounded.
* A segmentation module must not know how strokes are rendered.
* A stroke generator must not be coupled to HTML5 canvas DOM APIs.

### Rule 9: Strict Architectural Decoupling (Core vs. UI)
* Core image processing, structural analysis, stroke synthesis, and animation timelines must remain 100% headless and free of React / DOM dependencies.
* UI components (React/Next.js) are strictly consumers of engine outputs.
* This is a hard requirement for enabling future React Native reuse.

### Rule 10: No Mobile Coupling in Web Code
* Do not write web code that assumes browser-only APIs (like `document`, `window`, or direct DOM nodes) inside packages designated for shared or mobile use.
* Web-specific adaptations belong in `apps/web` or an explicit platform adapter layer.

### Rule 11: Benchmark Before & After Performance Changes
* Never optimize based on intuition alone.
* Measure processing latency, rendering frame rates, memory footprints, and stroke counts.
* Distinguish between *"feels faster"* and *"measured faster"*. Record measurements in `docs/BENCHMARKS.md`.

### Rule 12: No Fake Completion
* Never mark a task as `COMPLETE` or say "Done" merely because code was written or compiled.
* A task is `COMPLETE` only when it has been implemented, tested against actual input, verified visually or programmatically, and documented in `docs/CURRENT_STATE.md` and `docs/TASK_TRACKER.md`.
* Use explicit intermediate statuses: `NOT_STARTED`, `PLANNED`, `IN_PROGRESS`, `BLOCKED`, `NEEDS_DEBUG`, `NEEDS_TESTING`, `PARTIALLY COMPLETE`, `EXPERIMENTAL`, `DEFERRED`.

### Rule 13: Do Not Hide Errors
* Never catch errors with empty handlers or silent fallbacks that swallow failure details.
* Report explicit, meaningful error messages with context so bugs can be traced to their root cause immediately.

### Rule 14: Handle Invalid Input Explicitly
* All entry points must guard against corrupt files, non-image inputs, unsupported dimensions, zero-stroke results, and invalid configuration parameters.
* Provide graceful user degradation, not unhandled runtime exceptions.

### Rule 15: Keep Documentation Synchronized with Implementation
* At the end of every meaningful change or session, update `docs/CURRENT_STATE.md`, `docs/TASK_TRACKER.md`, and `docs/CHANGELOG.md`.
* If architectural contracts or schemas changed, update `docs/ARCHITECTURE.md`.

### Rule 16: Record Technical Decisions in DECISIONS.md
* Important technical trade-offs (e.g., Canvas 2D vs. WebGL, image processing library choices, vector simplification algorithms, color space selections) must be recorded in `docs/DECISIONS.md`.
* Settled decisions must not be reopened without new evidence or changing requirements.

### Rule 17: Never Delete Functionality Without Explicit Approval
* Never comment out or remove existing features, tests, or pipelines to make a new test pass or to simplify an immediate task.

### Rule 18: Refactoring Discipline
* Before undertaking any large refactor, clearly document:
  1. The specific problem being solved
  2. Affected systems and dependent files
  3. Potential regression risks
  4. Verification & rollback strategy

---

## AI Session Context & Discovery Rules

1. **Memory Invalidation Rule:** Never assume previous chat context is complete or persistent. The repository files in `docs/` are the single source of truth.
2. **Start-of-Task Protocol:** Before touching any code, an AI agent must read:
   1. `docs/PROJECT_CONTEXT.md`
   2. `docs/CURRENT_STATE.md`
   3. `docs/TASK_TRACKER.md`
   4. Relevant sections of `docs/ARCHITECTURE.md`
   5. Recent entries in `docs/CHANGELOG.md` and `docs/DEBUG_LOG.md`
3. **No Unnecessary Global Scans:** Do not recursively scan the entire repository for localized tasks. Read documentation first, then inspect only the specific files required.
