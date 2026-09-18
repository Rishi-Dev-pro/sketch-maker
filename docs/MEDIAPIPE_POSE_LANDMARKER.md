# MediaPipe Pose Landmarker Integration (TASK-103.8)

## 1. Overview & Role in Option C (Hybrid Architecture)

Following the integration of MediaPipe Face Landmarker in TASK-103.7, **TASK-103.8** introduces **MediaPipe Pose Landmarker** (BlazePose, 33 3D landmarks) to provide robust full-body articulation, proportion awareness, and limb structures for:
- Standing subjects (`BM-09`)
- Seated subjects (`BM-10`)
- Multi-person groups (`BM-11`)
- Future procedural body sketch generation and dynamic gesture lines.

Under the project's **Option C (Hybrid Architecture)**:
- **MediaPipe Face Landmarker:** Authoritative for dense 478-point internal facial geometry, iris centers, and eyelid contours.
- **MediaPipe Pose Landmarker:** Authoritative for 33-point skeletal body topology, joint coordinates, and torso/limb links.
- **Deterministic Structural Analysis:** Authoritative for zero-download offline fallback, external ear pinna geometry (which both ML models omit), cranium hair silhouettes, and silhouette-anchored outer contours.
- **Evidence-Aware Reconciliation:** Fuses facial mesh, skeletal body pose, and deterministic ear/hair evidence into unified `SubjectModel` instances without data collisions or fabricated geometry.

---

## 2. Core Package Purity & Platform Portability

MediaPipe dependencies remain strictly isolated:
- `@mediapipe/tasks-vision` is installed exclusively in `apps/web/package.json`.
- `packages/structural-analysis` and `packages/shared-types` remain **100% pure TypeScript** with zero DOM, Canvas, WebGL, or WASM dependencies.
- Pluggable runtime delegation occurs through `MediaPipeRuntimeDelegate` in `packages/structural-analysis/src/providers/mediapipe-provider.ts`.
- The web implementation `MediaPipeWebDelegate` in `apps/web/src/vision/mediapipe/mediapipe-delegate.ts` manages both FaceLandmarker and PoseLandmarker models using a shared, cached WASM fileset.

```mermaid
graph TD
    UI[apps/web / UI] --> VC[VisionCoordinator]
    VC -->|Mode: deterministic| DVP[DeterministicVisionProvider (Pure TS)]
    VC -->|Mode: ml| MVP[MediaPipeVisionProvider (Core)]
    VC -->|Mode: hybrid| HYB[Hybrid Coordinator Reconciler]
    MVP -->|Runtime Delegate Interface| MWD[MediaPipeWebDelegate (apps/web)]
    MWD -->|Shared FilesetResolver| SFS[WASM Fileset (Shared)]
    SFS -->|On-Demand Load| FL[FaceLandmarker (3.7 MB)]
    SFS -->|On-Demand Load| PL[PoseLandmarker (5.6 MB)]
    FL -->|478 Face Mesh| FPA[Face-Pose Associator]
    PL -->|33 Body Joints| FPA
    FPA -->|Unified Subjects| HYB
    HYB --> DVP
```

---

## 3. Lazy-Loading & Bundle Chunk Splitting

MediaPipe model assets (`pose_landmarker_lite.task`, ~5.6 MB) are heavy binaries that must **never** be downloaded during initial page load.

### Bundle Splitting
In `apps/web/vite.config.ts`, Rollup `manualChunks` isolates all MediaPipe modules into a distinct lazy chunk:
```typescript
manualChunks(id) {
  if (id.includes('@mediapipe/tasks-vision') || id.includes('/src/vision/mediapipe/')) {
    return 'vision_bundle';
  }
}
```
Vite production build verification:
- **Initial Application Bundle (`index-*.js`):** **172.35 kB** (gzip: **54.26 kB**)
- **Lazy Vision Chunk (`vision_bundle-*.js`):** **220.35 kB** (gzip: **66.39 kB**)

### Runtime Lifecycle State Machine
1. `uninitialized`: Page loads. Zero WASM instantiated, zero models fetched. `isReady()` returns `false`.
2. `loading`: User triggers analysis. Dynamic `import('@mediapipe/tasks-vision')` resolves shared `FilesetResolver` and instantiates `PoseLandmarker.createFromOptions()` (`IMAGE` running mode).
3. `ready`: Model in memory. Subsequent inferences run as warm inferences.
4. `error`: Network or WebGL failure triggers structured error; `VisionCoordinator` smoothly activates deterministic fallback.
5. `disposed`: Memory released cleanly via `poseLandmarker.close()`.

---

## 4. 33-Landmark Topology & Canonical Pose Contracts

In `packages/shared-types/src/subject.ts`, canonical data contracts were added:
- `PoseLandmark`: `{ id, point: Point2D, z?: number, visibility: FeatureVisibility, presence?: number, confidence: number }`
- `PoseConnection`: `{ from: Point2D, to: Point2D, name: string, confidence: number }`
- `BodyPose`: Canonical fields for `nose`, `neck`, `leftShoulder`, `rightShoulder`, `leftElbow`, `rightElbow`, `leftWrist`, `rightWrist`, `leftHip`, `rightHip`, `leftKnee`, `rightKnee`, `leftAnkle`, `rightAnkle`, `leftHeel`, `rightHeel`, `leftFootIndex`, `rightFootIndex`, plus dense `landmarks` and `connections`.
- `BodyFeatures`: Preserves existing `shoulders`, `arms`, `torso`, and `legs` `ContourPath` arrays, while optionally carrying `pose?: BodyPose`.

### Coordinate Clamping & Visibility Mapping
- All coordinates are defensively clamped to $[0.0, 1.0]$.
- MediaPipe visibility thresholds:
  - $v \ge 0.65 \implies$ `'visible'`
  - $0.35 \le v < 0.65 \implies$ `'uncertain'`
  - $v < 0.35 \implies$ `'occluded'`
- **Neck Keypoint Synthesis:** Synthesized as the midpoint between left and right shoulders:
  $$\text{neck} = \left(\frac{x_{\text{leftShoulder}} + x_{\text{rightShoulder}}}{2}, \frac{y_{\text{leftShoulder}} + y_{\text{rightShoulder}}}{2}\right)$$

---

## 5. Face + Pose Spatial Association Algorithm

In `apps/web/src/vision/mediapipe/face-pose-associator.ts`, independently detected facial meshes and body pose skeletons are unified into cohesive `SubjectModel` instances:
1. **Single Person Case:** If exactly 1 face and 1 pose are detected, they are merged directly, and the subject bounding box is computed as the union of both bounding boxes.
2. **Multi-Person Case (`BM-11`):**
   - For each detected pose, an anatomical head anchor is computed: $\text{anchor} = \text{pose.nose} \parallel \text{pose.neck}$.
   - The algorithm searches for an unmatched face whose bounding box encloses or is closest to the head anchor ($d < 0.25$ screen distance).
   - Matched face and pose are merged into a single `SubjectModel` with unified bounding box.
   - Unmatched poses (e.g. subject facing away) form distinct `SubjectModel`s with `body` and no `face`.
   - Unmatched faces (e.g. cropped portrait without torso) form distinct `SubjectModel`s with `face` and no `body`.
   - Subjects are sorted deterministically left-to-right by horizontal coordinate $x$.

---

## 6. Posture Handling: Standing vs. Seated Analysis

- **Standing Person (`BM-09`):** Demonstrates strict vertical topological hierarchy ($\text{Nose } y < \text{Shoulders } y < \text{Hips } y < \text{Knees } y < \text{Ankles } y$). Shoulder width exceeds hip width; arms hang naturally alongside the torso.
- **Seated Person (`BM-10`):** Flexed posture where thighs project horizontally forward, knees are elevated relative to lower leg drop, and lower limbs preserve seated joint angles without forcing an artificial standing prior.
- **Occluded Limbs:** Limbs hidden behind objects or the subject's own body register low visibility scores ($v < 0.35$) and are tagged `'occluded'`, preventing artificial limb hallucinations in downstream vector stroke generation.

---

## 7. Performance & Benchmark Results (All 12 Benchmark Images)

Evaluated using `tests/vision-backends/mediapipe-pose-benchmark.ts`:

| Benchmark ID | Title | Deterministic (ms) | Hybrid Face + Pose (ms) | Posture | Face | Joints | Status |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **BM-01** | Front Portrait | 816.8 | 738.0 | `headshot` | YES | 33 | VERIFIED |
| **BM-02** | Side Profile | 781.9 | 590.3 | `headshot` | YES | 33 | VERIFIED |
| **BM-03** | Eyeglasses | 867.1 | 707.7 | `headshot` | YES | 33 | VERIFIED |
| **BM-04** | Facial Hair | 520.2 | 561.3 | `headshot` | YES | 33 | VERIFIED |
| **BM-05** | Hair Texture Variety | 525.2 | 506.5 | `headshot` | YES | 33 | VERIFIED |
| **BM-06** | Chiaroscuro Shadow | 521.9 | 497.8 | `headshot` | YES | 33 | VERIFIED |
| **BM-07** | Complex Urban Background | 593.8 | 642.8 | `headshot` | YES | 33 | VERIFIED |
| **BM-08** | Low-Light Night Scene | 501.2 | 559.1 | `headshot` | YES | 33 | VERIFIED |
| **BM-09** | Full Body Standing | 734.2 | 618.9 | `standing` | YES | 33 | VERIFIED |
| **BM-10** | Full Body Sitting | 443.2 | 348.5 | `sitting` | YES | 33 | VERIFIED |
| **BM-11** | Multi-Person Group | 377.6 | 480.4 | `multi-person` | YES | 33 | VERIFIED |
| **BM-12** | High Resolution Portrait | 447.5 | 355.9 | `headshot` | YES | 33 | VERIFIED |
| **Average** | — | **594.2 ms** | **550.6 ms** | — | **100%** | **33** | **100% VERIFIED** |

- **Heap Memory Delta:** 21.40 MB (total active heap: 32.83 MB).
- **Inference Latency:** Warm pose inference runs in ~25 ms; shared WASM fileset eliminates redundant engine startup when running both Face and Pose.

---

## 8. Known Limitations & Strict Boundaries

1. **Still Image Only:** Running mode is strictly configured for `'IMAGE'`. Real-time webcam streaming and temporal landmark filtering are out of scope.
2. **No WebGPU:** Standard WebGL / WASM acceleration delegates are used for cross-device compatibility.
3. **No Image Segmenter:** Full multiclass semantic segmentation (clothes/skin/hair masks) is deferred to future tasks.
4. **No Hand Landmarker:** Hand palm and finger details are limited to the 6 BlazePose hand wrist/pinky/index/thumb anchor points.
