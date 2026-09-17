# DEBUG_LOG.md

## Persistent Bug & Debugging Log

> **Protocol:** When an error occurs:
> `ERROR` → `REPRODUCE` → `IDENTIFY ROOT CAUSE` → `TRACE DEPENDENCIES` → `DESIGN FIX` → `IMPLEMENT FIX` → `TEST FIX` → `CHECK REGRESSION` → `DOCUMENT RESULT`

---

## Log Entries

### BUG-001: Premature Session Interruption during Scaffolding
* **Date:** 2026-09-16
* **Status:** VERIFIED
* **Symptom:** AI development session stopped abruptly immediately following the creation of `apps/web/src/main.tsx`. `node_modules` were uninstalled, monorepo packages were unlinked, and `CURRENT_STATE.md` / `TASK_TRACKER.md` were left in an un-updated state.
* **Reproduction Steps:**
  1. Inspect `transcript.jsonl` from session `a7a9c9f0-46c9-4d36-81c4-6fa0185476e9`.
  2. Observe step 137 (`apps/web/src/main.tsx` created) followed by step 139: `wsarecv: A connection attempt failed... dial tcp: lookup daily-cloudcode-pa.googleapis.com: no such host`.
* **Root Cause:** Upstream API network connection failure during SSE streaming abruptly killed the agent loop before it could execute `npm install`, run verification builds, or update documentation.
* **Affected Files:**
  * Root `package.json`
  * `apps/web/`
  * `packages/*`
  * `docs/CURRENT_STATE.md`
  * `docs/TASK_TRACKER.md`
* **Fix Applied:**
  1. Recovered exact filesystem state and confirmed untracked monorepo files.
  2. Executed `npm install` to resolve and link workspace packages (`@sketch-maker/shared-types` etc.).
  3. Ran `npm run typecheck` across all workspace packages (passed with zero errors).
  4. Ran `npm run build` on `@sketch-maker/web` (production Vite build passed).
  5. Verified live browser runtime rendering via browser subagent on `http://localhost:3000/`.
* **Verification:** `npm run typecheck` and `npm run build` exit code 0; dev server confirmed operational.
* **Regression Risk:** Zero. Scaffolding preserved without destructive changes.

---

### BUG-002: Pose Classification Failures on BM-02 (Body Contamination) & BM-06 (Chiaroscuro Lighting)
* **Date:** 2026-09-17
* **Status:** VERIFIED
* **Symptom:**
  1. `BM-02` (True side profile) was misclassified as `three_quarter_left` with low confidence (0.35) and `visibleSide: both`.
  2. `BM-06` (Extreme frontal chiaroscuro) was misclassified as `left_profile` with `visibleSide: left_only` because skin chrominance was absent on the shadowed facial half.
* **Reproduction Steps:**
  1. Execute `npx tsx tests/structural-analysis/pose-inspector.ts` against the benchmark dataset under Step 1 baseline.
  2. Inspect pose output for `BM-02` and `BM-06`.
* **Root Cause:**
  1. `BM-02` failure: Head boundary detection allowed the search envelope to expand down into the chest/collar/shoulder region (row 687). The subject's shirt contour pulled $headMinX$ from the true facial profile (x=334) leftward to x=268, shifting $headCenterX$ and artificially diluting the true profile asymmetry ratio.
  2. `BM-06` failure: The baseline pose estimator relied solely on skin-chrominance pixel centroid. Under chiaroscuro illumination, skin chrominance disappeared on the shadowed right half (skin coverage was only 2.7%), leaving an apparent unilateral skin mass on the left cheek. The algorithm falsely equated `skin visibility asymmetry` with `geometric profile yaw`, ignoring the fact that the head silhouette was 100% symmetric ($A_{silh} = 0.52$) and high-frequency structural gradient edges (eyelids, nasal bridge, mouth fissure) were equally present across both facial sides ($energyRatioLeft = 0.535$, $energyOffset = +0.043$).
* **Affected Files:**
  * `packages/structural-analysis/src/face-region.ts`
  * `packages/structural-analysis/src/types.ts`
  * `tests/structural-analysis/face-region.test.ts`
  * `tests/structural-analysis/pose-inspector.ts`
* **Fix Applied (TASK-103 Step 1.1):**
  1. **Torso/Chest Isolation:** Enforced an anatomical head height ceiling ($H_{head} \le 1.25 \times W_{cranium}$) and shoulder expansion trigger to isolate the true head coordinate frame strictly above collar level.
  2. **Decoupling Skin Visibility from Face Geometry:** Introduced a high-frequency structural edge energy centroid ($y \in [0.18, 0.78]$ of head) that tracks anatomical contours invariant to shadows.
  3. **Multi-Cue Evidence Model:** Replaced single-threshold classification with a multi-evidence voting system combining (a) head silhouette boundary asymmetry, (b) face centroid lateral offset, (c) structural feature energy lateral concentration, and (d) appearance consistency. 90° profile requires multiple independent geometric cues to agree and forbids profile classification if reliable skin is centered. Chiaroscuro is formally recognized as illumination asymmetry on a geometrically symmetric head, preserving `frontal` classification for `BM-06`.
* **Verification:**
  1. `BM-02` correctly classifies as `left_profile` (confidence 0.62, $A_{silh} = 0.34$, $offset = -0.32$, $visibleSide = left\_only$).
  2. `BM-06` correctly classifies as `frontal` (confidence 0.78, $A_{silh} = 0.52$, $offset = 0.04$, $visibleSide = both$).
  3. All 14 unit and regression tests in `tests/structural-analysis/face-region.test.ts` pass.
  4. All 12 benchmark images in `pose-inspector.ts` execute cleanly with average latency of 14.45 ms (budget < 150 ms).
* **Regression Risk:** Zero. All unit tests, typechecks across 8 workspaces, and production builds pass.

---
```markdown
### BUG-XXX: [Short Descriptive Title]
* **Date:** YYYY-MM-DD
* **Status:** [INVESTIGATING | ROOT_CAUSE_IDENTIFIED | FIX_IN_PROGRESS | VERIFIED | CLOSED]
* **Symptom:** What went wrong? What was the observed error message or visual defect?
* **Reproduction Steps:**
  1. Step 1
  2. Step 2
* **Root Cause:** Deep explanation of why the failure occurred.
* **Affected Files:**
  * `path/to/file1.ts`
  * `path/to/file2.ts`
* **Fix Applied:** Description of code change.
* **Verification:** How was the fix verified? (Automated test command or visual confirmation).
* **Regression Risk:** Could this fix negatively impact other styles, image ratios, or performance?
```
