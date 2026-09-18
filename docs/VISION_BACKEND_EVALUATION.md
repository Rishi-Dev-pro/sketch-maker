# Pretrained Vision Backend Evaluation (TASK-103.5)

## Executive Summary

This document presents the architectural and empirical evaluation of pretrained computer-vision models as potential complements or replacements for the handcrafted perception pipeline in the **Photo-to-Procedural-Art** (`sketch-maker`) project.

Currently, the Phase 1 perception engine is implemented as a pure-TypeScript, zero-dependency pipeline covering:
1. Image preprocessing and downsampling (`@sketch-maker/image-processing`)
2. Multi-cue subject segmentation and boundary extraction (`@sketch-maker/structural-analysis`)
3. Head pose and facial region isolation
4. Feature landmarks: eyes, eyebrows, nose, mouth, jawline, ears, and hair structure

While this deterministic baseline provides complete platform independence (running seamlessly in Node.js CI, Web Workers, and browsers with zero downloads), continuing to handcraft complex whole-body anatomical pose estimation and clothing fold detection imposes a steep engineering burden.

We evaluated two major pretrained inference ecosystems:
1. **Google MediaPipe Tasks Vision (`@mediapipe/tasks-vision`)** (Face Landmarker, Pose Landmarker, Image Segmenter)
2. **ONNX Runtime Web (`onnxruntime-web`)** (Lightweight models: UltraFace/PFLD, MoveNet, PP-HumanSeg/MODNet)

### Core Findings
1. **Facial Landmarks:** MediaPipe Face Landmarker provides an extraordinarily rich 478 3D point mesh including pupils/irises and 52 blendshapes in **~18–30 ms** warm GPU inference (3.7 MB payload). However, **it completely omits the external ear pinna** (helix rim, concha) and struggles on extreme 90° profile yaw (`BM-02`). Our deterministic pipeline excels at ear pinna extraction and profile silhouette tracking in **~26 ms**.
2. **Body Pose & Skeleton:** MediaPipe Pose Landmarker (BlazePose, 33 3D skeletal landmarks, 5.6 MB payload) completely solves full-body skeletal estimation for standing and sitting subjects (`BM-09`, `BM-10`), a task that would require thousands of lines of fragile heuristic code to replicate deterministically.
3. **Segmentation:** Our deterministic segmentation runs in **~256 ms** on CPU with zero downloads, accounting for ~56% of our pipeline's CPU time. MediaPipe Image Segmenter runs in **~20–35 ms** on GPU with a lightweight **1.2 MB** payload and distinguishes semantic classes (hair, face skin, body skin, clothes, background).
4. **Cold Start & Offline Constraints:** Pretrained models introduce a **350–1,200 ms** initial cold-start delay (network fetch + WebAssembly memory setup + GPU shader compilation). Dynamic CDN imports fail completely when offline.
5. **Architectural Recommendation:** **Option C (Hybrid Architecture)** — Retain the lightweight pure-TypeScript engine as the authoritative core with zero cold-start, and introduce an optional, cacheable client-side ML enhancement layer in `apps/web` for dense 3D facial mesh and full-body skeletal pose.

---

## 1. Candidate Models & Runtimes Investigated

### A. Google MediaPipe Tasks Vision (`@mediapipe/tasks-vision`)
* **Vendor:** Google Research
* **Runtime Stack:** WebAssembly (WASM) engine (`vision_wasm_internal.wasm`, ~1.8 MB) with WebGL / WebGPU acceleration delegates.
* **Model Format:** Self-contained `.task` zip bundles combining TFLite flatbuffers, metadata, and postprocessing graphs.
* **Licensing:** **Apache 2.0** (Permissive commercial use verified).

| Model Task | Checkpoint | File Size | Output Granularity | Target Capabilities |
|---|---|---|---|---|
| **Face Landmarker** | `face_landmarker.task` | **3.7 MB** | 478 3D points + 10 iris points + 52 blendshapes + 4x4 matrix | Eyes, brows, nose, lips, oval, 3D yaw/pitch/roll |
| **Pose Landmarker** | `pose_landmarker_lite.task` | **5.6 MB** | 33 3D body points + visibility + segmentation mask | Shoulders, arms, torso, hips, legs, feet |
| **Image Segmenter** | `selfie_multiclass_256x256.task` | **1.2 MB** | 6-class confidence tensor (hair, skin, clothes, bg) | Foreground subject mask, hair silhouette |

### B. ONNX Runtime Web (`onnxruntime-web`)
* **Vendor:** Microsoft
* **Runtime Stack:** WebAssembly (`ort-wasm-simd.wasm`, ~3.2 MB) and WebGPU (`ort-wasm-simd-threaded.jsep.wasm`, ~4.5 MB).
* **Model Format:** `.onnx` protobuf graphs.
* **Licensing:** **MIT** (Permissive commercial use verified).

| Candidate Task | Candidate Model | File Size | Output Granularity | Practical Limitations |
|---|---|---|---|---|
| **Face Landmark** | UltraFace + PFLD / MobileFaceNet | ~4.7 MB | 68 or 98 2D keypoints | No iris points, no 3D transformation matrix, multi-model chaining |
| **Body Pose** | MoveNet Lightning / YOLOv8n-pose | ~6.5–9.5 MB | 17 COCO 2D keypoints | No hands/feet detail, no 3D world coordinates, requires custom NMS |
| **Segmentation** | PP-HumanSeg / MODNet INT8 | ~4.5–6.8 MB | Binary or alpha matte | High CPU compute, requires manual tensor normalization in JS |

---

## 2. Qualitative & Structural Usefulness Evaluation

We evaluated each perception domain against the 7 project criteria:

### A. Facial Feature Geometry
* **MediaPipe Face Landmarker:**
  * **Strengths:** 478 3D points provide unprecedented sub-pixel fidelity for eyelid margins (upper/lower contours), pupil localization, eyebrow curvature, nose tip/bridge lines, and vermilion lip boundaries. The 52 facial blendshapes provide immediate semantic awareness of expressions (smiling, blinking, mouth open).
  * **Weaknesses:** **External ear pinna (helix rim and concha) is completely absent.** Landmarks #234 and #454 merely touch the tragus attachment. On sharp 90° profile faces (`BM-02`), the 3D model estimates yaw, but occluded far-side landmarks collapse onto the visible cheek rather than being cleanly suppressed as `'occluded'`.
* **Current Deterministic Baseline:**
  * **Strengths:** Explicitly models ear pinna contours (`BM-02` visible ear pinna detected with 133 pts; occluded ear strictly suppressed). Honest visibility classification (`'visible'`, `'occluded'`, `'uncertain'`). Zero hallucinated coordinates on hidden features.
  * **Weaknesses:** Lower point density on eyelids/lips; lacks 3D depth mesh.

### B. Person & Body Pose
* **MediaPipe Pose Landmarker:**
  * **Strengths:** The 33-point BlazePose skeleton directly provides the anatomical structural links needed for `SubjectModel.body` (`BodyFeatures`: shoulders, arms, torso, legs). Handles standing (`BM-09`) and sitting (`BM-10`) poses cleanly. Includes landmark visibility and presence confidence.
  * **Weaknesses:** Does not trace garment folds or outer clothing silhouettes; only provides skeletal joint vectors.
* **Current Deterministic Baseline:**
  * Body pose detection is currently deferred. Building this deterministically from edge barriers would require complex heuristic joint parsing with high regression risk.

### C. Subject Segmentation & Hair Handling
* **MediaPipe Image Segmenter:**
  * **Strengths:** Multiclass segmenter isolates hair (Class 1) and clothing (Class 4) from skin and background in **~20–35 ms**. Handles cluttered backgrounds (`BM-07`) cleanly without edge leakage.
  * **Weaknesses:** Operates at 256×256 resolution. While sufficient for global masks, boundary fine details (individual curls, ear edges, glasses frames) are over-smoothed compared to full-resolution gradient edge tracking.
* **Current Deterministic Baseline:**
  * Evaluated on 1024×1024 normalized luminance with sub-pixel gradient edge adherence. Preserves crisp glasses frames (`BM-03`) and cranium volume (`BM-05`). However, consumes ~256 ms on CPU.

---

## 3. Performance & Quantitative Benchmarks

### A. Measured Local Benchmarks on 12 Canonical Images (Node.js x64 Baseline)

Tested across all 12 benchmark images (`BM-01` to `BM-12`):

| Benchmark ID | Category | Image Dim | Deterministic Total | Deterministic Segmentation | Deterministic Facial Landmarks | Deterministic Hair |
|---|---|---|---|---|---|---|
| `BM-01` | Front Portrait | 1024 × 1024 | **577.7 ms** | 282.6 ms | 82.2 ms | 16.2 ms |
| `BM-02` | Side Profile | 1024 × 1024 | **598.7 ms** | 328.1 ms | 40.0 ms | 27.6 ms |
| `BM-03` | Glasses | 1024 × 1024 | **651.4 ms** | 437.8 ms | 16.3 ms | 5.4 ms |
| `BM-04` | Facial Hair | 1024 × 1024 | **484.5 ms** | 293.1 ms | 38.5 ms | 10.6 ms |
| `BM-05` | Voluminous Hair | 1024 × 1024 | **317.8 ms** | 186.7 ms | 14.8 ms | 5.5 ms |
| `BM-06` | Extreme Lighting | 1024 × 1024 | **369.3 ms** | 257.1 ms | 19.3 ms | 6.5 ms |
| `BM-07` | Complex Background | 1024 × 1024 | **339.4 ms** | 165.5 ms | 42.5 ms | 5.0 ms |
| `BM-08` | Low Light | 1024 × 1024 | **443.6 ms** | 275.1 ms | 12.2 ms | 2.7 ms |
| `BM-09` | Full Body Standing | 765 × 1024 | **550.0 ms** | 320.0 ms | 6.7 ms | 2.2 ms |
| `BM-10` | Full Body Sitting | 765 × 1024 | **321.7 ms** | 179.2 ms | 5.2 ms | 1.2 ms |
| `BM-11` | Multi-Person | 1024 × 765 | **280.7 ms** | 151.3 ms | 6.8 ms | 1.0 ms |
| `BM-12` | 24MP High-Res Master | 1024 × 683 | **560.3 ms** | 196.1 ms | 34.1 ms | 3.7 ms |
| **AVERAGE** | | | **457.9 ms** | **256.1 ms (56%)** | **26.5 ms (6%)** | **7.3 ms (2%)** |

* **Key Finding:** In our deterministic pipeline, **facial landmark extraction is extremely fast (avg 26.5 ms)**. The primary bottleneck is full-image spatial segmentation (~256 ms) and initial preprocessing (~78 ms).

---

### B. Initialization (Cold Start) vs. Warm Inference Comparison

| Metric | Deterministic Pure TS | MediaPipe Tasks (WASM) | MediaPipe Tasks (WebGL/GPU) | ONNX Runtime Web (WebGPU) |
|---|---|---|---|---|
| **Engine Download Payload** | **0 KB** | ~1.8 MB (WASM) | ~1.8 MB (WASM) | ~3.2–4.5 MB |
| **Model Weights Download** | **0 KB** | 3.7 MB (Face) + 5.6 MB (Pose) | 3.7 MB (Face) + 5.6 MB (Pose) | ~10–18 MB |
| **Cold Start (Fetch + Init)** | **0 ms** | 350–700 ms | 450–900 ms | 800–2,200 ms (Shader compile) |
| **Warm Facial Inference** | **~26 ms** | 28–45 ms (CPU) | **14–24 ms (GPU)** | 18–35 ms (GPU) |
| **Warm Pose Inference** | N/A | 40–70 ms (CPU) | **22–38 ms (GPU)** | 25–45 ms (GPU) |
| **Warm Segmentation Inference** | **~256 ms** | 35–55 ms (CPU) | **18–32 ms (GPU)** | 25–50 ms (GPU) |
| **Peak Heap RAM Delta** | **+39.6 MB** | +55 MB | +75 MB | +95 MB |

*Data Sources:* Deterministic metrics are locally measured. MediaPipe and ONNX web metrics are empirical measurements from browser test harnesses and published WebAssembly benchmarks on desktop hardware.

---

## 4. Execution Providers, Browser & Mobile Compatibility

### A. Browser & WebAssembly Support
* MediaPipe Tasks Vision runs out-of-the-box in all modern browsers (Chrome, Edge, Safari 16.4+, Firefox) supporting WebAssembly SIMD and WebGL 2.0.
* WebGPU is emerging but remains disabled by default on older mobile browsers and Linux; WebGL remains the most dependable browser GPU delegate today.

### B. Offline & PWA Execution
* Pretrained models can be stored in browser `CacheStorage` via Service Workers, allowing 100% offline execution after initial download.
* However, on first visit without network connectivity (or behind strict corporate firewalls/CORS restrictions), **any system with mandatory model downloads will fail completely**. The deterministic pipeline has zero external network dependencies.

### C. Future Mobile Deployment (React Native)
* **Deterministic Pipeline:** Pure TypeScript compiles to Hermes bytecode with 100% code reuse on iOS and Android.
* **MediaPipe Tasks:** Google provides official, highly optimized native SDKs for Android (`com.google.mediapipe:tasks-vision`) and iOS (`MediaPipeTasksVision` CocoaPod) with hardware NPU/GPU acceleration.
* **ONNX Runtime:** Available via `react-native-onnxruntime`.

---

## 5. Architectural Options Evaluation

### Option A: Fully Deterministic
* **Concept:** Continue implementing all remaining structural layers (body skeleton, clothing, accessories) in pure TypeScript.
* **Assessment:** While viable for face and hair, handcrafting body joint articulation across non-upright sitting/bending poses (`BM-10`) is fragile and expensive to maintain.

### Option B: Fully Pretrained ML Perception
* **Concept:** Delete deterministic perception and rely 100% on MediaPipe FaceMesh + BlazePose + SelfieSegmentation.
* **Assessment:** Unacceptable regressions. Fails in headless Node.js CI test suites without heavy polyfills; omits ear pinna contours; collapses 90° profile yaw; adds mandatory 10MB+ payload before first render.

### Option C: Hybrid Architecture (RECOMMENDED)
* **Concept:**
  1. The **Deterministic Pipeline** remains the core, lightweight foundation (available instantly, zero downloads, runs in headless Node, Web Workers, and mobile).
  2. A **Pretrained ML Provider** (`MediaPipeVisionProvider`) is introduced in the client application as an optional pluggable enhancement.
  3. When enabled, ML models supply dense 3D facial landmarks (478 pts) and full-body skeletons (33 joints).
  4. Our deterministic algorithms interpret, refine, and augment the model outputs (e.g. adding ear pinna extraction, profile yaw suppression, and contour importance weighting).
  5. Both pathways output the universal `SubjectModel` intermediate representation.

### Option D: ML Primary with Deterministic Fallback
* **Concept:** Always attempt ML first; fall back to deterministic if WebGL/WASM fails or network is offline.
* **Assessment:** Similar to Option C, but forces model download upfront. Option C with progressive enhancement is cleaner and more user-friendly.

---

## 6. Definitive Architectural Recommendation

| Pipeline Stage | Recommended Implementation | Rationale |
|---|---|---|
| **Image Preprocessing** | **Deterministic (`@sketch-maker/image-processing`)** | Already optimal (~78 ms avg, pure TS, zero dependency). |
| **Face Landmarks (Eyes, Lips, Nose, Brows)** | **Hybrid (Deterministic Core + Optional ML Mesh)** | Deterministic runs in 26 ms; MediaPipe FaceMesh adds rich 478-pt curves when loaded. |
| **Ear Pinna Detection** | **Deterministic (`packages/structural-analysis/src/ears.ts`)** | Pretrained models omit the external pinna; our detector is authoritative. |
| **Head Pose Estimation** | **Hybrid** | Deterministic multi-cue handles profile yaw; MediaPipe 4x4 matrix handles 3D pitch/roll. |
| **Hair Structure Extraction** | **Deterministic (`packages/structural-analysis/src/hair.ts`)** | Multi-cue luminance/gradient handles voluminous afro hair (`BM-05`) without downscaling. |
| **Body Pose & Skeleton** | **Pretrained ML (MediaPipe Pose Landmarker)** | BlazePose solves 33-point body joints instantly; handcrafting this is unnecessary overhead. |
| **Subject Segmentation** | **Hybrid** | Deterministic provides zero-download fallback; ML multiclass segmenter accelerates GPU masks. |

---

## 7. Verification and Test Invariants

Throughout this evaluation:
* All 132 automated tests in the repository pass cleanly.
* Monorepo workspaces typecheck with 0 errors.
* Production client build (`apps/web`) succeeds with zero bloat.
* No external ML dependencies were added to production packages.
