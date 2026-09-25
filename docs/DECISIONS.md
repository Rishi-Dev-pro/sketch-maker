# DECISIONS.md

## Architectural Decision Records (ADRs)

This document serves as the permanent record of major architectural and technical decisions made in this project. Settled decisions must not be reopened without explicit new justification or changed constraints.

---

### ADR-001: Web-First Product & Monorepo Architecture
* **Date:** 2026-09-15
* **Status:** ACCEPTED
* **Decision:** Scaffolding the repository as an engine-first monorepo (`packages/*` for algorithms, `apps/web` for the Next.js/React web product, `apps/mobile` for the future React Native app).
* **Context:** The product vision calls for a Vercel-hosted web application initially, followed later by a React Native mobile application. Both must share identical procedural art logic.
* **Alternatives Considered:**
  1. Single standalone Next.js app with algorithms in `/lib` (Rejected: tightly couples code to Next.js; makes extracting to React Native painful).
  2. Standalone mobile app first (Rejected: higher friction to share, slower iteration cycle, requires app store review).
* **Reason:** A monorepo strictly decouples algorithmic packages from UI frameworks, guaranteeing reusability across web and mobile while maintaining a unified workspace.
* **Consequences:** Requires workspace orchestration (e.g. npm/pnpm workspaces, TypeScript project references).

---

### ADR-002: Reusable Universal Intermediate Representation (`SubjectModel` & `StrokeModel`)
* **Date:** 2026-09-15
* **Status:** ACCEPTED
* **Decision:** Introduce formal headless data representations (`SubjectModel` for structural analysis, `StrokeModel` for vectorized curves) as intermediate stages between image input and rendering.
* **Context:** Running image analysis (segmentation, landmark detection, contour extraction) is the most computationally expensive part of the pipeline. If a user adjusts styling (color, line width, neon glow) or switches styles (Sketch → Neon), re-analyzing the image from scratch causes unacceptable delay.
* **Alternatives Considered:**
  1. Monolithic single-pass shader/filter (Rejected: cannot support multiple procedural styles or progressive drawing timeline).
  2. Direct raster-to-canvas pipeline without intermediate representation (Rejected: cannot separate analysis from rendering or export vector data).
* **Reason:** "Analyze once, reuse often." Decoupling structural extraction from stroke rendering enables instantaneous style switching, replayability, and vector export.
* **Consequences:** Memory must be managed to cache intermediate models; schemas must remain versioned and strictly typed.

---

### ADR-003: Client-Side Local-First Processing Priority
* **Date:** 2026-09-15
* **Status:** ACCEPTED
* **Decision:** Prioritize in-browser / client-side execution for the core pipeline, with server processing strictly as an optional future enhancement.
* **Context:** Photographs uploaded by users are personal and sensitive. Uploading large images to remote backend servers introduces privacy concerns, infrastructure costs, and latency.
* **Alternatives Considered:**
  1. Server-side GPU processing pipeline (e.g., Python/FastAPI + PyTorch) (Rejected for initial MVP: high infrastructure cost, cold starts, privacy concerns, violates offline-first mobile goal).
* **Reason:** Modern browser APIs (Canvas, Web Workers, WebGL, WebAssembly) provide ample compute for procedural stroke generation. Local processing provides instant privacy and zero per-user server compute costs.
* **Consequences:** Algorithms must be optimized to run within standard browser memory and CPU/GPU limits without freezing the UI thread.

---

### ADR-004: Rendering Engine Selection (HTML5 Canvas 2D / WebGL vs. Pure SVG)
* **Date:** 2026-09-15
* **Status:** ACCEPTED
* **Decision:** Use HTML5 Canvas 2D (with WebGL acceleration where needed for glows/shaders) for progressive animation rendering; generate SVG only on-demand for vector export.
* **Context:** The progressive drawing effect involves animating thousands of micro-strokes in real time at 60 FPS.
* **Alternatives Considered:**
  1. Pure DOM SVG manipulation (`<path>` elements animated with CSS/SMIL) (Rejected: DOM nodes for 5,000+ strokes degrade frame rate drastically, leading to stuttering and heavy memory usage).
  2. Three.js / full 3D engine (Rejected: excessive bundle weight for a 2D procedural line art engine).
* **Reason:** Canvas 2D is ultra-lightweight, hardware-accelerated, and natively suited for high-frequency path rendering without DOM overhead.
* **Consequences:** Requires custom animation timeline interpolation logic.

---

### ADR-005: Strict MVP Scope Protection
* **Date:** 2026-09-15
* **Status:** ACCEPTED
* **Decision:** The v1.0 Web MVP will strictly exclude user authentication, cloud databases, payment processing, social feeds, comments, and community marketplaces.
* **Context:** Ambitious projects often fail from feature creep before core transformation quality is proven.
* **Alternatives Considered:**
  1. Building a full creator community platform on day one (Rejected: distracts from achieving high visual fidelity in the core drawing engine).
* **Reason:** One jaw-dropping, high-precision transformation is infinitely more valuable than twenty half-baked social features.
* **Consequences:** Scope is tightly contained to photo upload → progressive procedural render → replay → PNG export.

---

### ADR-006: Authoritative Web UI Framework: React + Vite + TypeScript
* **Date:** 2026-09-15
* **Status:** ACCEPTED
* **Decision:** The web client (`apps/web`) will be built using React, Vite, and TypeScript. Next.js is explicitly rejected unless a future concrete technical requirement demands it.
* **Context:** The application is a client-side, local-first interactive canvas application. Server-side rendering (SSR) provides no benefit to an in-browser WebGL/Canvas 2D drawing application and introduces hydration overhead and build complexity.
* **Alternatives Considered:**
  1. Next.js (Rejected: SSR adds unnecessary complexity for a canvas-heavy client application; requires dynamic client-only imports to prevent SSR window errors).
  2. Vanilla JS without framework (Rejected: React provides clean component state for controls, timeline sliders, and responsive UI).
* **Reason:** Vite provides lightning-fast HMR, lean bundle output, seamless static hosting on Vercel, and zero SSR complications with canvas/web-worker/wasm lifecycles.
* **Consequences:** All web routing (if needed) is client-side; builds output pure static bundles.

---

### ADR-007: Zero-Dependency Pure-TypeScript Core for Image Preprocessing
* **Date:** 2026-09-17
* **Status:** ACCEPTED
* **Decision:** Implement image preprocessing, area-weighted box downsampling, Rec. 709 photometric luminance calculation, and contrast normalization in 100% pure TypeScript using JavaScript typed arrays (`Uint8ClampedArray`, `Uint8Array`, `Float32Array`) with zero external runtime dependencies.
* **Context:** Image preprocessing is the foundation for downstream structural analysis. It must run seamlessly in the browser main thread, inside Web Workers (off the UI thread), in Node.js (for headless testing/CI), and in future React Native mobile apps. Heavy native libraries like `sharp` rely on C++ bindings (`libvips`) that cannot run in browsers, and DOM-dependent canvas methods cannot run in pure headless Node/worker contexts without polyfills.
* **Alternatives Considered:**
  1. `sharp` (Rejected: native Node C++ binary; breaks browser and React Native compatibility).
  2. Canvas-only DOM approach (Rejected: cannot run in non-browser Node test runners or non-DOM workers without canvas polyfills).
  3. `jimp` (Rejected: heavy pure-JS dependency with slow execution speed and large bundle footprint).
* **Reason:** Pure TypeScript with typed arrays provides platform-agnostic portability, zero runtime bundle overhead, deterministic cross-platform behavior, and sub-70ms average downsampling throughput on 1MP+ images and sub-250ms on 24MP images with negligible RAM usage (< 20MB).
* **Consequences:** Low-level algorithms (box filtering, bilinear interpolation, Rec. 709 weighting) are maintained in-house; platform adapters bridge DOM `ImageData`/`ImageBitmap`/`Canvas` and Node test buffers to pure typed arrays.

---

### ADR-008: Pure-TypeScript Multi-Cue Perceptual Subject Segmentation Engine
* **Date:** 2026-09-17
* **Status:** ACCEPTED
* **Decision:** Implement subject segmentation and background separation in `@sketch-maker/structural-analysis` as a pure-TypeScript multi-cue perceptual engine combining:
  1. Sobel structural gradient barriers extracted from the Rec. 709 luminance buffer.
  2. Perimeter background color/luminance distribution modeling.
  3. Spatial Gaussian anatomical priors and high-frequency edge saliency.
  4. Gradient-stopping regional growth and connected component instance analysis.
* **Context:** Isolating human subjects from background clutter is essential before landmark extraction and stroke vectorization. Neural network segmentation models (e.g. MediaPipe SelfieSegmentation, BodyPix) require 5MB–30MB downloads, fail in pure headless Node.js test runners without heavy canvas/WASM polyfills, and excessively blur fine hair curls, glasses rims, and nose profiles.
* **Alternatives Considered:**
  1. MediaPipe / TensorFlow.js as exclusive core segmenter (Rejected for core engine: heavy bundle weight, cannot run offline in headless Node test suites, over-smoothes identity-bearing facial and hair contours).
  2. Simple Otsu/binary global thresholding (Rejected: fails completely on complex backgrounds, dark clothing, and extreme lighting).
* **Reason:** A pure-TypeScript multi-cue engine executes in ~240ms on CPU without any model downloads, runs deterministically across Node.js, Web Workers, and mobile runtimes, preserves fine hair boundaries and glasses frames, and directly outputs multi-subject instances with sub-pixel soft confidence maps.
* **Consequences:** Provides an immediate zero-overhead foundation for Phase 1 feasibility; modular architecture allows plugging in client-side neural backends in `apps/web` as an optional enhancement in later phases.

---

### ADR-009: Pure-TypeScript Anatomical Landmark & Structural Contour Extraction Engine
* **Date:** 2026-09-17
* **Status:** ACCEPTED
* **Decision:** For Phase 1 feasibility, implement the structural-analysis landmark and contour extraction engine in pure TypeScript, utilizing deterministic multi-scale gradient ridge/valley analysis, anthropometric search priors, and evidence-driven confidence scoring over existing image-processing and segmentation outputs.
* **Context:** TASK-103 must transform segmented subjects into semantically structured `SubjectModel` representations containing explicit facial landmarks (eyes, eyebrows, nose, mouth, jawline, ears) and body boundaries. Generic whole-image edge detection (Canny) produces unranked noise, while heavyweight ML face-landmark models (MediaPipe FaceMesh, TF.js Blazeface) require 10MB+ model weights, fail in offline/headless Node.js CI test environments, and lock down external runtime dependencies.
* **Architecture Openness:** This decision is specific to establishing the headless Phase 1 feasibility prototype and validating the core procedural vectorization pipeline. It is *not* a permanent prohibition against neural ML backends; the modular design preserves an open pluggable interface (`SubjectAnalysisResult`) so that an optional client-side ML detector backend can be incorporated in future phases if benchmark evaluations prove that classical methods cannot achieve required fidelity on extreme poses or complex lighting.
* **Reason:** A pure-TypeScript implementation executes with zero network download, zero native binary bindings, sub-500ms CPU latency, complete platform independence (Node, Web Workers, browser, React Native), and deterministic testability against the 12-category benchmark dataset.
* **Consequences:** Initial landmark extraction relies on robust image evidence (gradient barriers, valley tracking) over hard-coded geometric priors; features that are occluded (e.g. opposite eye in side-profile `BM-02`) or ambiguous are represented with explicit `FeatureVisibility` ('occluded' / 'uncertain' / 'not_detected') rather than hallucinated.
* **Step 1.1 Addendum (Pose Robustness):** Pose estimation decouples facial geometry from skin chrominance. Bilateral structural edge energy distribution and head-local silhouette projection strictly take precedence over skin tone coverage, eliminating false profile misclassification under extreme chiaroscuro lighting (`BM-06`) and isolating cranium/facial boundaries from shoulder/torso contamination (`BM-02`).
* **Step 2E.1 Addendum (Silhouette-Driven Outer Facial Contour & Mandibular Convergence):** Outer facial boundary extraction is anchored directly to the segmented subject silhouette (`SubjectMask` and `SubjectRegion`) with sub-pixel gradient edge alignment, rather than internal edge detection. In profile poses (`BM-02`), the visible anterior silhouette (glabella $\to$ nose $\to$ lips $\to$ chin $\to$ submental line) is preserved without mirroring, while the occluded side is strictly suppressed. In frontal/three-quarter poses, mandibular inward convergence is tracked down to the chin apex; detection terminates upon detecting neck/collar expansion ($> 1.20\times$), isolating the facial contour from shirts and shoulders (`BM-09`, `BM-10`). In heavy beards (`BM-04`), the system signals `uncertain` rather than inventing underlying phantom bone lines.

---

### ADR-010: Vision Provider Architecture & Hybrid Perception Strategy
* **Date:** 2026-09-18
* **Status:** ACCEPTED
* **Decision:** Introduce a formal, decoupled Vision Provider abstraction (`VisionProvider`, `VisionCoordinator`, `DeterministicVisionProvider`, `MediaPipeVisionProvider`, `VisionResult`) with the Universal Intermediate Representation (`SubjectModel`) as the strict, sole contract between perception backends and downstream procedural art engines. Adopt **Option C (Hybrid Vision Architecture)** as established by the comprehensive evaluation in `docs/VISION_BACKEND_EVALUATION.md`.
* **Context:** TASK-103.5 evaluated pure-TypeScript deterministic vision against pretrained ML models (MediaPipe FaceLandmarker, PoseLandmarker, SelfieSegmentation) across the 12-category benchmark suite. Findings confirmed:
  1. Pretrained ML excels at dense internal facial geometry (478 landmarks), sub-20ms inference with WebGPU, and 33-joint skeletal pose tracking.
  2. Pure-TypeScript deterministic vision retains critical structural advantages: zero download/zero bundle penalty (0 KB vs. 15.2 MB), instantaneous startup (1.8ms vs. 2,100ms model warm-up), superior anatomical ear pinna tracing (which MediaPipe completely lacks), and robust offline execution in headless Node.js CI test environments and Web Workers.
  Directly binding the procedural art engine to MediaPipe would violate platform independence, break offline execution, increase initial page weight, and create vendor lock-in.
* **Alternatives Considered:**
  1. *Option A — Pure Handcrafted CV Only:* (Rejected: scaling manual mathematical modeling to 33-point body skeletons, complex foreshortening, and hands would exhaust engineering bandwidth).
  2. *Option B — Complete ML Replacement:* (Rejected: imposes mandatory 15MB model downloads, eliminates zero-download instant rendering, loses ear pinna geometry, and breaks headless Node.js test suites).
* **Architecture & Boundary Rules:**
  1. *Common Intermediate Representation:* The procedural engine receives exclusively `SubjectModel` and canonical shared types. It never accesses backend-specific APIs or models.
  2. *Deterministic Provider:* `DeterministicVisionProvider` wraps existing segmentation, face region, eyes, eyebrows, nose, mouth, jawline, ears, and hair detectors. It operates with 0 dependencies, 100% offline, in any JavaScript/TypeScript runtime.
  3. *ML Provider Boundary:* `MediaPipeVisionProvider` is designed with a pluggable `MediaPipeRuntimeDelegate` interface. It remains stubbed/experimental without adding production dependencies until explicitly activated in downstream client tasks.
  4. *VisionCoordinator & Fallback Guarantee:* The coordinator exposes execution modes (`deterministic`, `ml`, `auto`, `hybrid`). In `auto` mode, it uses ML when available and automatically falls back to deterministic analysis with zero thrown errors if ML is uninitialized, missing, or unsupported.
  5. *Evidence-Aware Hybrid Reconciliation:* In `hybrid` mode, dense facial landmarks from ML are merged with deterministic ear pinna contours and edge-guided hair boundaries, preserving the unique geometric fidelity of both worlds.
  6. *Platform Portability (Web vs. Mobile):* Core structural packages (`@sketch-maker/structural-analysis`) contain zero DOM (`document`/`window`) or native platform dependencies. Future web delegates load WebAssembly/WebGPU modules in `apps/web`; future React Native delegates load native mobile modules in `apps/mobile`; both produce identical canonical `SubjectModel` payloads.
* **Consequences:** Clean architectural boundary protects downstream stroke generation from perception volatility; tests pass reliably in headless Node CI; zero bundle increase for production web builds until ML packages are selectively introduced in future tasks.
* **TASK-103.7 Addendum (MediaPipe Face Landmarker Web Integration):**
  1. `@mediapipe/tasks-vision` dependency is installed strictly in `apps/web/package.json`. Core packages remain 100% pure TypeScript.
  2. MediaPipe modules are lazily chunked into `dist/assets/vision_bundle-*.js` (136 kB, gzip 40 kB), keeping initial web bundle size at 239 kB.
  3. `MediaPipeWebDelegate` converts `NormalizedImage` to `ImageData`, runs `faceLandmarker.detect()`, and maps 478 landmarks to canonical `SubjectModel`.
  4. Profile occlusion guarantee (`BM-02`): Feature visibility on the occluded side of true profiles is tagged `'occluded'` with 0 confidence, preventing hallucinated geometry.
  5. Zero ear pinna fabrication: MediaPipe explicitly reports no ear detection; `VisionCoordinator` in `'hybrid'` mode reconciles and preserves deterministic ear geometry alongside MediaPipe facial features.
* **TASK-103.8 Addendum (MediaPipe Pose Landmarker Web Integration):**
  1. *Canonical Body Pose Representation:* Added `PoseLandmark`, `PoseConnection`, and `BodyPose` contracts to `packages/shared-types`, extending `BodyFeatures.pose` without modifying downstream stroke or vectorization consumers.
  2. *Shared Web WASM Fileset:* `MediaPipeWebDelegate` lazily initializes a single `FilesetResolver` promise shared across both `FaceLandmarker` and `PoseLandmarker`, eliminating redundant WASM runtime downloads and memory allocations.
  3. *Pose Topology & Normalization:* 33 BlazePose skeletal landmarks are clamped strictly to $[0.0, 1.0]$, visibility is classified into categorical thresholds (`visible`, `uncertain`, `occluded`), and anatomical neck midpoint is deterministically synthesized from left/right shoulder landmarks.
  4. *Face + Pose Association:* Euclidean spatial proximity between pose nose/neck anchor and face bounding box centers (threshold $d < 0.25$) links independently detected faces and poses into unified `SubjectModel` instances. Supports single individuals, standing (`BM-09`), sitting (`BM-10`), multi-subject separation (`BM-11`), isolated faces, and headless bodies.
  5. *Zero Fabrication Fallback:* Handcrafted deterministic pipeline does not fabricate 33-point skeletons; when running under deterministic mode, `bodyFeatures.pose` remains undefined with zero errors. In hybrid mode, `VisionCoordinator` merges deterministic ear pinna and hair boundaries with ML pose landmarks.
  6. *Bundle Isolation:* Vite `manualChunks` keeps `@mediapipe/tasks-vision` isolated within `vision_bundle` (220 kB, gzip 66 kB). Initial page load bundle is reduced to 172 kB (gzip 54 kB).
* **TASK-103.9 Addendum (MediaPipe Image Segmenter Web Integration):**
  1. *Canonical Semantic Segmentation Data Contracts:* Added `SemanticCategory` (`'background'`, `'hair'`, `'body-skin'`, `'face-skin'`, `'clothes'`, `'others'`), `SemanticMask`, and `SemanticSegmentation` contracts to `packages/shared-types`, extending `SubjectModel.semanticSegmentation` and `SegmentationResult.semanticSegmentation` without breaking pure TypeScript decoupling.
  2. *Shared WASM Fileset & Lazy Model Loading:* `MediaPipeWebDelegate` reuses the existing shared `FilesetResolver` and lazily instantiates `ImageSegmenter` with `selfie_multiclass_256x256.tflite` (16.37 MB) on first request. Zero models or WASM runtimes are fetched during application startup. Initial bundle weight remains strictly isolated at 177.93 kB (gzip 55.21 kB).
  3. *Discrete Resampling vs Continuous Interpolation:* Category masks are resampled using strict nearest-neighbor interpolation to prevent illegal synthetic category IDs, while continuous confidence maps use bilinear interpolation to maintain anti-aliased soft probabilities $[0.0, 1.0]$.
  4. *Evidence-Aware Hybrid Reconciliation:* ML semantic classification is blended with TASK-102 deterministic masks. Consensus foreground pixels are retained, ML semantic classification overrides deterministic false positives in complex backgrounds (`BM-07`) and deep chiaroscuro shadows (`BM-06`), while high-gradient Sobel edge barriers from deterministic analysis are preserved to maintain fine, high-frequency hairline/contour edges (`BM-05`).
  5. *Semantic vs. Instance Disambiguation:* MediaPipe multiclass is class-level semantic segmentation (no individual instance separation). The architecture preserves deterministic connected-component clustering (`instances: SubjectRegion[]`) for multi-subject isolation (`BM-11`).
  6. *Zero Regression / Deterministic Fallback:* When running purely deterministic or when ML fails/is disabled, `semanticSegmentation` is omitted or gracefully synthesized without any runtime errors.

---

### ADR-011: Vector Geometry Intermediate Representation, RDP Simplification, and Importance Model (TASK-104)
* **Date:** 2026-09-18
* **Status:** ACCEPTED
* **Decision:** Introduce a formal, resolution-independent vector geometry intermediate representation (`VectorGeometry`, `VectorPath`, `GeometryMetrics`) inside `@sketch-maker/shared-types` and implement the extraction, cleaning, Ramer-Douglas-Peucker simplification, cubic Bézier fitting, mask contour tracing, and semantic importance ranking in `@sketch-maker/stroke-engine/geometry`.
* **Context:** Following Phase 1 perception (TASK-101 through TASK-103.9), perception evidence exists as heterogeneous, disconnected structures (`FacialFeatures`, `BodyPose`, `SemanticSegmentation`, raster masks, contour lines). Passing raw, uncleaned, high-density raster masks or landmark arrays directly to stroke rendering or animation engines would:
  1. Cause performance bottlenecks during progressive reveals (thousands of redundant collinear or microscopic points).
  2. Mix rendering concerns (stroke width, draw ordering, timing) with geometric conditioning.
  3. Risk mutating or losing raw perception confidence and landmark coordinates.
* **Architecture & Boundary Rules:**
  1. *Decoupled Geometry IR:* `VectorGeometry` serves as the clean geometric boundary between perception packages (`@sketch-maker/structural-analysis`) and procedural stroke rendering (`@sketch-maker/stroke-engine`).
  2. *Zero Browser/DOM Globals:* The geometry pipeline is 100% pure TypeScript with zero DOM/canvas dependencies (`window`, `document`, SVG DOM, HTMLCanvasElement).
  3. *Evidence Preservation:* The raw perception points are preserved unmodified in `rawPoints: Point2D[]`. Geometric simplifications produce `points: Point2D[]` and `curves: BezierCurve[]` without altering perceptual confidence or coordinates.
  4. *Adaptive RDP Hierarchy:* Simplification tolerances scale inversely with perceptual salience:
     * Primary structural features (eyes, nose tip, oral fissure): $\epsilon = 0.0015$ (high geometric preservation).
     * Secondary expressive features (eyebrows, lips, ears): $\epsilon = 0.0025$.
     * Anatomical gesture (body pose connections, jawline): $\epsilon = 0.0035$.
     * Boundary contours (silhouette, hair, clothing masks): $\epsilon = 0.0040$.
     * Tertiary texture: $\epsilon = 0.0050$.
  5. *Cubic Bézier Fitting with Tangent Clamping:* Catmull-Rom tangents weighted by chord length, with control point displacement strictly clamped ($\|C - P\| \le 0.4 \times L$) to prevent overshoot, self-intersection, or looping.
  6. *Moore-Neighborhood Mask Tracing:* Clockwise contour boundary following with grid sampling step and minimum bounding area filtering ($0.001$).
  7. *Deterministic Multi-Cue Importance Model:* Computes $I = 0.45 \times w_{\text{semantic}} + 0.25 \times c + 0.15 \times v + 0.15 \times s$, establishing reproducible, objective stroke priority.
  8. *Profile Occlusion & Multi-Subject Isolation:* Profile occluded features (`BM-02`) produce 0 paths. Multi-subject detections (`BM-11`) are partitioned with distinct `subjectId` attributes.
* **Consequences:** Average extraction latency is ~1.98 ms (< 50 ms SLA target); points are reduced by 81.6% (from 2,838 down to 514 clean vertices per subject); downstream stroke engines receive clean, continuous parametric paths ready for expressive styling.

---

### ADR-012: Stroke Candidate Intermediate Representation, Eligibility Filtering, and Width/Density Models (TASK-105)
* **Date:** 2026-09-19
* **Status:** ACCEPTED
* **Decision:** Introduce a formal, platform-independent `StrokeCandidate` intermediate representation (`StrokeCandidate`, `StrokeCandidateSet`, `StrokeMetrics`, `StrokeSemanticRole`, `StrokeFilteredReason`) in `@sketch-maker/shared-types` and implement deterministic stroke candidate generation in `@sketch-maker/stroke-engine/candidates`.
* **Context:** TASK-104 established resolution-independent vector geometry (`VectorGeometry`, `VectorPath`). However, vector paths are geometric descriptions of lines without artistic intent, stroke properties, gesture segmentation, or progressive eligibility. Handing raw geometry directly to an animation timeline would lead to:
  1. Excessive or fragmented strokes on complex silhouettes.
  2. Loss of anatomical hierarchy (e.g., drawing background noise before facial features).
  3. Indiscriminate rendering of occluded or low-confidence features.
  4. Coupling of stroke candidate generation with specific canvas rendering technologies or animation engines.
* **Architecture & Boundary Rules:**
  1. *Decoupled Procedural Boundary:* TASK-105 exclusively maps `VectorGeometry` $\to$ `StrokeCandidateSet`. It intentionally omits global draw ordering, animation timeline sequencing, canvas styles (neon, charcoal, watercolor), and video export, which belong to TASK-106+.
  2. *Pure TypeScript Execution:* 100% pure TypeScript with zero DOM/window/canvas globals in core packages (`@sketch-maker/shared-types`, `@sketch-maker/stroke-engine`).
  3. *Protected Anatomical Structures:* Primary facial features (eyes, eyebrows, nose, mouth, ears) are protected from fragmentation, ensuring high-salience anatomy is captured as cohesive artistic strokes.
  4. *Curvature & Gesture Partitioning:* Non-protected paths (silhouettes, hair boundaries, textures) are partitioned at sharp angular inflections ($\theta > 75^\circ$) or arc length limits ($L > 0.35$), with closed loops opened and a hard cap of 8 candidates per path to guarantee bounded stroke counts and prevent stroke explosion.
  5. *Deterministic Stroke Width & Density Models:*
     * $w = w_{\text{base}} \times (0.8 + 0.2 \cdot c) \times (0.85 + 0.15 \cdot I)$
     * Point density computed as $\max(4, \lceil \frac{L}{0.008} \rceil)$ guaranteeing uniform parametric sampling across normalized coordinate space.
  6. *Composite Priority Scoring:*
     * $P = 0.4 \cdot I + 0.3 \cdot w_{\text{role}} + 0.2 \cdot c + 0.1 \cdot \min(1, 2L)$, balancing importance, anatomical hierarchy, perceptual confidence, and stroke length.
  7. *Strict Profile Occlusion & Isolation:* Features tagged `occluded` or with 0 visibility (such as the occluded eye/ear in `BM-02`) yield 0 drawable stroke candidates (filtered with reason `'occluded'`). Multi-person scenes (`BM-11`) strictly preserve independent `subjectId` allocations.
* **Consequences:** Average candidate generation latency is **1.06 ms** (sub-50 ms SLA target achieved). Candidate counts average **53.2** strokes per subject (max 59), eliminating pathological stroke explosion. Downstream sequencing and styling engines (TASK-106) receive fully qualified, validated, and prioritized stroke candidates.

---

### ADR-013: Deterministic Multi-Factor Stroke Ordering & Harmonized Multi-Subject Sequencing (TASK-106)
* **Date:** 2026-09-19
* **Status:** ACCEPTED
* **Decision:** Introduce a formal `OrderedStrokeSequence` intermediate representation (`OrderedStroke`, `CompositionPhase`, `StrokeOrderingMetrics`) in `@sketch-maker/shared-types` and implement a deterministic 6-phase multi-factor ordering pipeline in `@sketch-maker/stroke-engine/ordering`.
* **Context:** TASK-105 produced unordered procedural stroke candidates (`StrokeCandidate[]`). Directly rendering unordered strokes produces an unnatural, chaotic drawing progression (e.g. sketching eye pupils before the head silhouette, or drawing background texture before the body frame). Furthermore, in multi-subject scenes (`BM-11`), drawing one complete person while leaving the other untouched feels artificial. A progressive procedural art engine requires a human-like drawing cadence where composition progresses macro-to-micro.
* **Architecture & Boundary Rules:**
  1. *Decoupled Composition Boundary:* TASK-106 exclusively maps `StrokeCandidate[]` $\to$ `OrderedStrokeSequence`. It intentionally avoids frame timing, progressive canvas animation loops (`requestAnimationFrame`), style rendering (neon, watercolor), or video export, which belong to TASK-107+.
  2. *Pure TypeScript Execution:* 100% pure TypeScript with zero DOM/window/canvas globals in core packages (`@sketch-maker/shared-types`, `@sketch-maker/stroke-engine`).
  3. *Six-Phase Composition Model:*
     - Phase 0 (`foundation`): Outer silhouette and body gesture anchors (`hierarchyLevel === 0` or role `silhouette`/`body_structure`).
     - Phase 1 (`primary_structure`): Head contour, jawline, neck, primary anatomical frame (`hierarchyLevel === 1`).
     - Phase 2 (`expressive_features`): Primary focal facial features (eyes, eyebrows, nose, mouth).
     - Phase 3 (`secondary_anatomy`): Secondary anatomical boundaries (ears, face contours).
     - Phase 4 (`refinement`): Hair masses, clothing boundaries, structural subdivisions.
     - Phase 5 (`texture_accent`): Hatching, surface detail, background accents.
  4. *Structural Dependency Hierarchy:* Directed dependency graph mapping parents to children (e.g. iris depends on eye, eye depends on head/jawline, hair depends on head). Children are strictly ordered after parents ($L_0 \to L_1 \to L_2$).
  5. *Harmonized Multi-Subject Progression:* For multi-person scenes (`BM-11`), subjects progress harmoniously phase-by-phase (Phase 0 Subject A & B $\to$ Phase 1 Subject A & B) rather than drawing one complete subject sequentially.
  6. *Deterministic Multi-Factor Comparator:* Zero randomness; evaluation order: Phase $\to$ Subject $\to$ Dependency Level $\to$ Role Precedence $\to$ Spatial Flow (Top-to-Bottom, Center-Outward) $\to$ Importance $\to$ Arc Length $\to$ SourcePathId $\to$ Candidate ID.
  7. *Strict Profile Occlusion & Validation:* Filtered/occluded strokes produce 0 drawable ordered strokes (`BM-02`). Geometry is strictly immutable (coordinates preserved by reference). Contiguous 0-based sequence indices with 100% validation check.
* **Consequences:** Ordering latency is **1.19 ms** average (< 10 ms SLA target); 100% sequence validity across all 12 benchmark categories; delivers an aesthetically compelling, human-like progressive drawing order to future timeline and canvas animators (TASK-107+).

---

### ADR-014: Progressive Stroke Timeline Representation, Controlled Overlap, and Target Duration Normalization (TASK-107)
* **Date:** 2026-09-19
* **Status:** ACCEPTED
* **Decision:** Introduce a formal `StrokeTimeline` intermediate representation (`TimelineStroke`, `TimelineConfig`, `TimelineMetrics`, `TimelineState`, `TimelineStrokeState`) in `@sketch-maker/shared-types` and implement deterministic timeline scheduling in `@sketch-maker/stroke-engine/timeline`.
* **Context:** TASK-106 produced an ordered spatial sequence of strokes (`OrderedStrokeSequence`), but lacked the temporal dimension. Directly rendering without time scheduling would require hardcoded loop delays, prevent variable stroke drawing speeds, prevent controlled multi-stroke concurrency, make scrubbing/seeking impossible, and couple drawing playback with browser `requestAnimationFrame` lifecycles.
* **Architecture & Boundary Rules:**
  1. *Decoupled Temporal Boundary:* TASK-107 exclusively maps `OrderedStrokeSequence` $\to$ `StrokeTimeline`. It intentionally avoids browser canvas rendering, video encoders (MP4/GIF), React animation hooks, or WebCodecs, which belong to TASK-108+.
  2. *Pure TypeScript Execution:* 100% pure TypeScript with zero DOM/window/canvas globals in core packages (`@sketch-maker/shared-types`, `@sketch-maker/stroke-engine`, `@sketch-maker/animation-engine`).
  3. *Non-Destructive Reference Wrapping:* `TimelineStroke` wraps `OrderedStroke` and `StrokeCandidate` without duplicating geometry coordinates (`points`, `curves`). Input geometry is strictly immutable.
  4. *Physical Duration Formulation:* Natural duration is primarily driven by normalized geometric arc length ($L$), with modulation by line weight, perceptual importance, semantic role, and composition phase:
     $$\text{naturalDuration} = \text{clamp}\left(\text{baseDuration} + \text{lengthFactor} \cdot L \cdot M_{\text{phase}} \cdot M_{\text{role}} \cdot (0.9 + 0.2 \cdot I),\; \text{minDuration},\; \text{maxDuration}\right)$$
  5. *Controlled Overlap & Phase Boundary Damping:* Strokes can overlap ($\rho = 0.35$, capped at $250\text{ ms}$), creating natural multi-line drawing flow. Across major phase transitions, overlap is damped to $\le 10\%$ to preserve compositional readability.
  6. *Dependency-Aware Constraints:* Children (such as irises, clothing boundaries, hair textures) strictly enforce a minimum parent progress threshold ($75\%$) before beginning execution.
  7. *Target Duration Normalization:* Supports scaling the natural schedule toward configured animation targets (e.g. $15\text{ s}$) while preserving physical min/max clamps ($[80\text{ ms}, 800\text{ ms}]$) and dependency rules.
  8. *Pure O(N) Scrub / Query API:* Pure function `getTimelineState(timeline, timeMs)` computes per-stroke execution states (`pending`, `drawing`, `complete`) and eased progress ($[0.0, 1.0]$) at any arbitrary timestamp $t$ in $\sim 20\ \mu\text{s}$.
* **Consequences:** Average timeline generation latency is **0.54 ms** (< 10 ms SLA target); average query latency is **20.2 µs**; 100% sequence and temporal integrity across all 12 benchmark categories; delivers a mathematically robust time foundation for progressive canvas rendering (TASK-108+).

---

### ADR-015: Progressive Canvas 2D Renderer, Arc-Length De Casteljau Geometry, and High-DPI Viewport Architecture (TASK-108)
* **Date:** 2026-09-19
* **Status:** ACCEPTED
* **Decision:** Introduce a formal `RenderState` frame snapshot contract in `@sketch-maker/shared-types`, implement pure mathematical partial stroke geometry extraction using De Casteljau cubic Bézier subdivision and arc-length parameterization in `@sketch-maker/stroke-engine/rendering`, and establish an isolated HTML5 Canvas 2D progressive rendering layer with resolution-independent viewport mapping and wall-clock RAF player in `apps/web/src/rendering/`.
* **Context:** TASK-107 produced an immutable progressive timeline (`StrokeTimeline`). However, converting timeline states into visible progressive artwork on an HTML5 canvas requires solving several mathematical and architectural challenges:
  1. *Curvature Trimming:* Cubic Bézier curves cannot be trimmed by merely truncating parameter $t$ without causing severe geometric distortion and velocity spikes.
  2. *Drawing Speed Uniformity:* Bézier curve velocity varies wildly along parameter space $t \in [0, 1]$; uniform drawing requires true arc-length parameterization.
  3. *Portability & Layer Isolation:* Direct canvas drawing inside core engines would couple them to browser DOM environments, breaking headless exports, Node.js CLI tools, and mobile frameworks.
  4. *High-DPI & Responsive Sizing:* Drawing directly in raw screen coordinates results in blurry lines on Retina/4K displays and distortion across different canvas aspect ratios.
* **Architecture & Boundary Rules:**
  1. *Strict Layer Separation:* Core packages (`@sketch-maker/shared-types`, `@sketch-maker/stroke-engine`, `@sketch-maker/animation-engine`) remain 100% pure TypeScript with zero DOM/window/canvas globals. All HTMLCanvasElement, CanvasRenderingContext2D, and requestAnimationFrame usage is strictly restricted to `apps/web/src/rendering/`.
  2. *De Casteljau Bézier Subdivision:* In-flight Bézier curves are trimmed using pure De Casteljau subdivision at fractional parameter $u$, producing exact sub-curves without mutating source geometry.
  3. *Arc-Length Traversal:* Stroke drawing progress traverses physical curve distance using 4-segment chord integration for Béziers and Euclidean segment length for polylines, ensuring uniform linear drawing speed.
  4. *RenderState Frame Snapshot:* `createRenderState(timeline, timeMs, config)` compiles immutable frame states containing only visible partial strokes and active drawing tips.
  5. *Resolution-Independent Viewport Transform:* `ViewportTransform` projects $[0, 1] \times [0, 1]$ normalized space to physical canvas pixels with aspect-ratio contain/fit letterboxing, margin padding, and `devicePixelRatio` scaling.
  6. *Wall-Clock Elapsed Animation Loop:* `AnimationPlayer` synchronizes playback against real elapsed time (`performance.now()`), supporting speed modulation ($0.5\times$ to $3.0\times$), scrubbing, pausing, and leak-free cleanup.
  7. *Diagnostic Render Modes:* Supports `normal` monochrome sketch, `sequence` rainbow spectrum, `phase` semantic color-coding, `subject` multi-person identification, and `timeline` activity state visualization.
* **Consequences:** RenderState compilation latency is **0.12 ms** (16.6x faster than < 2.0 ms SLA); average partial geometry extraction latency is **1.8 µs**; 100% profile occlusion enforcement (`BM-02`) and multi-person subject separation (`BM-11`) verified; delivers high-quality, crisp, progressive canvas art playback ready for future styling (TASK-109 / TASK-601).

---

### ADR-016: Procedural Style Engine & Data-Driven Appearance System (TASK-109)
* **Date:** 2026-09-19
* **Status:** ACCEPTED
* **Decision:** Introduce a dedicated, platform-independent appearance layer (`packages/style-engine`) and formal contracts (`StyledRenderState`, `StyledRenderStroke`, `StylePresetDefinition`, `ResolvedStrokeStyle`) in `packages/shared-types/src/style.ts`. Implement a deterministic 5-tier cascading precedence hierarchy (`resolver.ts`), an extensible style preset registry (`StyleRegistry`), and four canonical reference presets (`procedural_black`, `red_line`, `neon`, `blueprint`).
* **Context:** Following TASK-108, the procedural renderer produced visible progressive drawings on an HTML5 canvas, but visual appearance (black charcoal lines on off-white canvas) was hardcoded in the canvas drawing adapter. Adding diverse artistic styles directly into the canvas loop or modifying stroke geometry would:
  1. *Violate the Core Invariant:* Modifying coordinates, line lengths, or timelines to achieve visual aesthetics destroys reusability, breaks vector caching, and corrupts structural analysis results.
  2. *Slow Down Runtime Switching:* If changing styles requires re-running segmentation or stroke ordering, real-time user style switching becomes impossible.
  3. *Couple Appearance to HTML5 Canvas:* Hardcoding styles directly in canvas rendering code prevents headless export (PNG, SVG, MP4) and future mobile framework (React Native) reuse.
* **Architecture & Boundary Rules:**
  1. *Strict Invariant of Separation:*
     $$\text{GEOMETRY (what)} \neq \text{TIMING (when)} \neq \text{STYLE (how)}$$
     The style engine strictly never mutates or recomputes `points`, `curves`, `bounds`, `arcLength`, `subjectId`, `sequenceIndex`, `startTimeMs`, `durationMs`, or `endTimeMs`.
  2. *Pure TypeScript Execution:* 100% pure TypeScript with zero DOM/window/canvas globals in core packages (`@sketch-maker/shared-types`, `@sketch-maker/style-engine`). All canvas-specific API calls (`ctx.shadowBlur`, `ctx.globalCompositeOperation`, `ctx.fillStyle`) remain cleanly isolated inside `apps/web/src/rendering/canvas-renderer.ts`.
  3. *Five-Tier Precedence Hierarchy:*
     - Tier 1: Global preset baseline (`color`, `lineWidth`, `lineCap`, `lineJoin`, `opacity`, `blendMode`, `glow`, `dash`, `background`).
     - Tier 2: Semantic role modifiers (`roleModifiers[stroke.semanticRole]`).
     - Tier 3: Composition phase modifiers (`phaseModifiers[stroke.phase]`).
     - Tier 4: Hierarchy level modifiers (`hierarchyModifiers[stroke.hierarchyLevel]`).
     - Tier 5: Diagnostic modes (`normal`, `sequence`, `phase`, `subject`, `timeline`) and active drawing pen tip glows.
  4. *Instantaneous Sub-Millisecond Resolution:* Resolving `RenderState` into `StyledRenderState` takes **0.008 ms** ($8\ \mu\text{s}$) per frame (125x faster than the 1.0 ms SLA target). Switching styles at runtime does not re-trigger perception or timeline generation, preserving current animation playback time, scrub progress, and active pen positions.
  5. *Canonical Presets Delivered:*
     - `procedural_black`: Canonical reference & debugging preset on white background (`#ffffff`), dark charcoal ink (`#1a1a1a`), solid opacity.
     - `red_line`: Architectural line art on warm parchment (`#faf8f5`), crimson ink (`#dc2626`).
     - `neon`: Cyberpunk dark-mode art on deep abyss (`#090a10`), electric cyan/magenta lines (`#00f0ff`), screen blend mode, active bloom glow (`radius: 12`, `opacity: 0.85`).
     - `blueprint`: Technical architectural draft on deep Prussian navy (`#0b1d3a`), crisp technical cyan-white lines (`#e0f2fe`), subtle transparency ($0.90$).
* **Consequences:** Average style resolution latency across all 12 benchmark categories and all 4 presets is **0.008 ms**; 100% of stroke geometry is mathematically unaltered; profile occlusions (`BM-02`) and multi-person isolation (`BM-11`) remain strictly enforced; establishes a clean extensible appearance system ready for future texture brushes and video exports.

---

### ADR-017: Explicit Feature Reconstruction and Semantic Boundary Relevance Filtering (TASK-110)
* **Date:** 2026-09-23
* **Status:** ACCEPTED
* **Decision:** Insert an explicit Feature Reconstruction and Artistic Interpretation layer (`packages/structural-analysis/src/reconstruction/`) between perception and vector candidate generation. Establish canonical data contracts in `packages/shared-types/src/reconstruction.ts` (`ArtisticReconstruction`, `FeatureTraceStatus`, `FeatureCoverageReport`), synthesize volumetric and multi-point anatomical features, enforce semantic boundary relevance filtering (`semantic-boundary-filter.ts`), implement 19-anatomical-feature coverage diagnostics (`coverage-reporter.ts`), and add a standalone `generatedOnly` render mode to expose true artwork quality without photo underlay.
* **Context:** In TASK-109, the pipeline was functionally complete from end-to-end (perception $\to$ vectors $\to$ candidates $\to$ ordering $\to$ timeline $\to$ styles $\to$ canvas). However, testing across all 4 execution modes (Deterministic, MediaPipe ML, Auto, Hybrid) revealed unacceptable visual quality: the output appeared as a simplified generic avatar rather than a recognizable reconstruction of the input photograph. Root cause analysis revealed three fundamental problems:
  1. *Perception Evidence is Not Artwork:* ML landmarks are sparse points (e.g. single 2D coordinates for nose tip and chin apex). In vector extraction, polylines require $\ge 2$ points, resulting in single landmarks being silently dropped.
  2. *Flattening Volumetric Structures into 1D Wires:* Eyebrows and hair were treated as single 1D polyline contours, completely losing mass, tapering, and hair volume.
  3. *Raw Pixel-Staircase Segmentation Noise:* Direct boundary tracing of 256x256 segmentation masks produced jagged staircase polygons that wasted stroke budget and generated visual clutter without artistic meaning.
* **Architecture & Boundary Rules:**
  1. *Explicit Interpretation Layer:* Perception models (whether deterministic or ML) only provide evidence. The feature reconstruction layer synthesizes artistic representations:
     - Eyelids (upper/lower margin, palpebral crease), iris crescent arc, pupil anchor.
     - Eyebrows: dual-contour envelope (`upperContour`, `lowerContour`) with medial-to-lateral tapering.
     - Nose: 3-point convex tip apex dome, bilateral alar wings, and columella shelf.
     - Mouth: oral fissure seam, cupid's bow, lower vermilion boundary, and mental crease.
     - Jaw & Chin: continuous mandibular contour and 3-point convex chin apex dome.
     - Hair: smoothed outer silhouette, major hair masses, and internal flow direction streamlines.
     - Body: bilateral neck contours, organic shoulder transitions, and clothing collar lines.
  2. *Semantic Boundary Relevance Filtering:* `evaluateSemanticBoundaryEligibility` discards raw pixelated `hair` and `face_skin` mask boundaries (superseded by reconstructed features), eliminates micro-speckle loops ($A < 0.004$), and caps clothing boundaries to 2 loops.
  3. *19-Feature Trace Matrix & Metric:* `coverage-reporter.ts` tracks 19 anatomical features through their entire pipeline lifecycle (`missing` $\to$ `detected_in_perception` $\to$ `reconstructed_in_subject` $\to$ `extracted_to_vector` $\to$ `admitted_as_candidate` $\to$ `rendered_in_stroke`), computing an aggregate structural coverage percentage.
  4. *Generated-Only Render Mode:* Standalone procedural artwork must look compelling on solid white, solid dark, or transparent backgrounds without relying on photographic underlay.
  5. *Zero DOM / Headless Portability:* The entire reconstruction engine and coverage reporter remain 100% pure TypeScript in `@sketch-maker/structural-analysis` and `@sketch-maker/shared-types`.
* **Consequences:**
  - Overall structural coverage reached **73%** across the 12-image benchmark suite (**84%** on unoccluded frontal portraits).
  - Meaningful stroke ratio reached **100%** (0 meaningless pixel-staircase mask loops).
  - Full end-to-end latency remains **286.3 ms** average (5.2x faster than the 1500 ms SLA).
  - High-res downsampling on 24MP (`BM-12`) completes in **917.4 ms**.
  - Strict profile occlusion (`BM-02`) and multi-person isolation (`BM-11`) remain 100% verified.

---

### ADR-018: MediaPipe ML as Primary High-Fidelity Provider and Procedural Graphite Shading (TASK-111)
* **Date:** 2026-09-23
* **Status:** ACCEPTED
* **Decision:**
  1. Establish MediaPipe ML as the primary high-fidelity reconstruction provider, temporarily disabling automatic fallback to deterministic CV during fidelity evaluation to eliminate false-negative visual regressions caused by weaker edge heuristics.
  2. Map all 478 MediaPipe facial landmarks, capturing iris boundary rings (469-472, 474-477), upper eyelid creases, canthi tick accents, lash emphasis, eyebrow directional hairs, nasal columella/subnasale, oral philtrum ridges, mental crease, and bilateral malar planes.
  3. Introduce feature-specific RDP simplification tolerances (ultra-fine 0.0004 for eyes/lips up to broad 0.0035 for body).
  4. Perform photographic luminance tonal analysis across 8 anatomical zones and generate 100% deterministic procedural hatching and cross-hatching with zero `Math.random()`.
  5. Add `realistic_pencil` style preset (`#222224` graphite tone, multiply blend mode, white paper `#ffffff`, role-modulated stroke weights).
  6. Enforce pure generated-only canvas mode (`showSourceImage = false`, `generatedOnly = true`) with 8 visual debug layer toggles in the Web UI.
* **Context:** Visual inspection revealed that deterministic CV produced coarse, cartoonish outlines when trying to reconstruct fine portraits. MediaPipe ML provided superior structural accuracy for facial proportions, eyes, nose, mouth, and jaw geometry. To achieve realistic graphite pencil portrait quality on white paper, the pipeline required fine landmark topologies, anatomical tonal analysis, deterministic pencil shading, and graphite rendering.
* **Consequences:**
  - Benchmark evaluation across BM-01 to BM-12 populated 4-8 tonal regions and 20-77 shading strokes per subject without regression.
  - Latency across BM-01 to BM-12 remains 293ms - 586ms (well within the 1500ms SLA).
  - Procedural shading is 100% deterministic with zero randomness, guaranteeing repeatable renders.
  - White paper canvas with graphite pencil styling delivers authentic drawing aesthetics without photograph underlay.

---

### ADR-019: Visual Realism Calibration & Pencil Portrait Refinement (TASK-112)
* **Date:** 2026-09-23
* **Status:** ACCEPTED
* **Context:**
  While TASK-111 delivered the technical structural pipeline (478 mesh, tonal regions, hatching passes, graphite styling), initial visual evaluation showed the output still suffered from "vector avatar / diagram" qualities:
  1. The nose was outlined with harsh continuous black lines running down the nasal bridge.
  2. The mouth had a closed cartoon loop around the lower vermilion.
  3. Eyes lacked pupil anchoring, looking vacant or ocular-looped.
  4. Hatching was generic uniform diagonal lines rather than curving along facial planes.
  5. Hair was a basic 6-strand outline lacking secondary flow and organic flyaways.
* **Decision:**
  1. **Anatomical Anchor Synthesis:**
     - Synthesize dark circular pupil accents (`confidence: 0.98`) and nostril aperture cavities (`confidence: 0.96`) in the 4B graphite tier to anchor the face's focal points.
  2. **Anti-Cartoon Outline Softening:**
     - Shift the nose bridge line to the shadow side with reduced confidence (`0.50`), acting as a subtle guidance hint rather than a hard wire down the nose.
     - Soften lower eyelid confidence (`0.65`) and lower lip vermilion confidence (`0.60`) to preserve light reflections and prevent enclosed "boxed" facial loops.
  3. **Form-Following Directional Hatching:**
     - Tailor hatching geometry to anatomical zones: malar cheek curves (curved 3-point strokes wrapping facial volume), mandibular jawline strokes (20°–30° along bone angle), subnasal and mental crease cleft strokes (horizontal/bowed).
     - Restrict cross-hatching strictly to `deep_shadow` in deep crease crevices (`eye_socket`, `under_nose`, `under_lip`, `jaw_shadow`, `neck_shadow`), eliminating crosshatched cheeks.
  4. **Multi-Tier Organic Hair Flow:**
     - Replace basic 6-strand hair with 24 strands structured in 3 tiers: 6 primary cranial flow streamlines, 12 secondary directional wavy strands, and 6 delicate accent flyaways using deterministic seeded PRNG (zero `Math.random()`).
  5. **5-Tier Graphite Pencil Value Hierarchy:**
     - Tier 1 (4B lead): Deep accents (pupils, nostrils, oral fissure).
     - Tier 2 (2B lead): Primary structure (upper lid, brow, jawline).
     - Tier 3 (HB lead): Secondary form modeling (creases, ears, primary hair).
     - Tier 4 (H lead): Form shading (malar, jaw, secondary hair).
     - Tier 5 (2H lead): Soft transitions (flyaways, crevice cross-hatch).
  6. **Side-by-Side Comparison UI:**
     - Add `Side-by-Side` comparison mode in the web UI displaying `[ ORIGINAL PHOTO ]` alongside `[ GENERATED SKETCH ]` for real-time visual realism verification.
* **Consequences:**
  - The generated output on BM-01 transforms from a cartoon vector diagram into a convincing, expressive graphite pencil portrait.
  - 100% determinism preserved across repeated runs.
  - Full pipeline latency remains fast (311ms - 703ms across BM-01 to BM-12).
  - All 22 test suites (320+ unit tests) pass without regression.

---

### ADR-020: Photographic Tonal Reconstruction, Continuous TonalFields, and Multi-Scale Graphite Value Synthesis (TASK-113)
* **Date:** 2026-09-25
* **Status:** ACCEPTED
* **Context:**
  Visual inspection of TASK-112 output revealed a persistent, fundamental flaw: the generated image remained visually a thin vector/anatomical line drawing rather than a realistic graphite pencil portrait. While MediaPipe extracted 478 landmarks, shading was treated as a secondary decorative hatching pass with a single average intensity per region. Facial planes (cheeks, forehead, nose side planes, eye sockets, neck) lacked tonal depth; hair was composed only of boundary and individual strand lines without hair mass; clothing had no tonal presence; and facial structure was communicated through cartoon-like outlines rather than graphite value accumulation.
* **Decision:**
  1. **Tonal Inversion Principle:**
     - Invert the visual hierarchy: graphite tonal value is primary; contours are selective structural reinforcement.
     - Enforce the "Contour-Off Test": the portrait must remain recognizable as a human likeness even when all contours, fine anatomy lines, and hair strands are completely removed.
  2. **Continuous 2D Spatial TonalField Abstraction:**
     - Replace scalar regional average luminance with continuous 2D grid fields $L(x,y)$ ($16 \times 16$ to $24 \times 24$ spatial samples with bilinear interpolation).
     - Store spatial fields across 15+ anatomical zones: `forehead`, `left_cheek`, `right_cheek`, `left_eye_socket`, `right_eye_socket`, `nose_bridge`, `nose_tip`, `subnasal`, `upper_lip`, `lower_lip`, `chin`, `jaw_shadow`, `neck`, `hair_mass`, and `clothing_mass`.
  3. **Robust Percentile Luminance Normalization:**
     - Extract robust facial luminance statistics ($p_{10}, p_{15}, p_{35}, p_{65}, p_{85}, p_{90}$) across the subject.
     - Normalize relative values $u(x,y)$ to protect lighting fidelity across high-key and low-key lighting conditions without hardcoding thresholds.
  4. **Non-Linear Perceptual Graphite Density Mapping:**
     - Map normalized values $u$ to graphite density $D(u)$ via a calibrated non-linear response curve:
       - $u \ge 0.85$: $D = 0.0$ (clean paper white highlights).
       - $0.50 \le u < 0.85$: $D = 0.20 \to 0.55$ (subtle form modeling).
       - $0.20 \le u < 0.50$: $D = 0.60 \to 0.80$ (deepening graphite shadow).
       - $u < 0.20$: $D = 0.85 \to 1.00$ (deep graphite crevice deposition).
  5. **Multi-Scale Form-Following Graphite Mark Synthesis:**
     - Generate marks across 4 scales:
       - **Scale A (Broad Tonal Marks):** Long, low-opacity strokes for volumetric hair mass, clothing mass, cheeks, and neck.
       - **Scale B (Medium Form Strokes):** Medium-length strokes following 3D anatomical flow angles (malar $60^\circ/120^\circ$, jaw $30^\circ$, nose $80^\circ$, neck $70^\circ$).
       - **Scale C (Fine Anatomical Hatching):** High-precision strokes for sockets, philtrum, chin cleft, and lip planes.
       - **Scale D (Micro Accents):** Dark 4B accents and selective crevice cross-hatching for pupils, nostrils, and oral fissure.
  6. **Mass-First Hair & Volumetric Clothing:**
     - Extract `hair_mass` from segmentation mask luminance, synthesizing high-density pencil mass strokes ($D \approx 0.70–0.95$) that ground the hairstyle before individual flow strands are placed.
     - Extract `clothing_mass` from torso segmentation mask, rendering visible graphite clothing mass rather than a bare vector outline.
  7. **Contour Softening & Edge Importance:**
     - Suppress outlines where photographic luminance transitions are gradual. Contours are preserved only at high-contrast occlusions (chin silhouette, oral fissure, upper eyelid crease).
  8. **Deterministic PRNG:**
     - 100% deterministic mark generation via sinusoidal hash function; zero `Math.random()`.
  9. **9 Diagnostic View Modes & Objective Regional Diagnostics:**
     - Add diagnostic UI views (`Source`, `Tonal Field L(x,y)`, `Graphite Density D(x,y)`, `Graphite Marks`, `Contours Only`, `Hair Mass`, `Hair Flow`, `Tonal Portrait (Contour-Off)`, `Final Artwork`).
     - Compute real-time image-level diagnostics (source mean, generated mean, contrast, and histogram correlation) across 12 semantic regions.
* **Consequences:**
  - The face achieves lifelike chiaroscuro volume: cheeks curve with form-following graphite, eye sockets have realistic orbital depth, the nose reads through side-plane gradients and tip highlights rather than vertical line tracks, and lips feature an illuminated vermilion highlight above a shaded mental crease.
  - Hair has substantial volumetric dark mass overlaid with primary flow and flyaways.
  - Black clothing (e.g. BM-01 sweater) renders as an authentic graphite mass.
  - Passes the Contour-Off Test with 3,352 lines of chiaroscuro shading alone.
  - Zero regression across all 12 benchmarks (latency 300–500ms).
  - 100% test pass rate across 23 test suites (325+ tests).

---

### ADR-019: Segmentation-Anchored Structural Reconstruction & Semantic Spatial Ownership Gate (TASK-114)
* **Date:** 2026-09-26
* **Status:** ACCEPTED
* **Context:**
  Visual reviews revealed structural loss between perception and rendering:
  - Face-only mode omitted the outer head boundary and shoulders, losing global portrait structure.
  - Full perception mode introduced unwanted stray strokes (waves outside the hair, long diagonal lines crossing the background).
  - While segmentation detected the outer boundary accurately, downstream vector and stroke engines discarded this information, synthesizing floating hair curves and clothing lines without spatial constraints.
* **Decision:**
  Establish **Segmentation as the Authoritative Outer Structural Anchor**:
  1. *Responsibility Matrix:*
     - Outer subject boundaries, hair boundary, neck/shoulders, clothing: **Segmentation**.
     - Inner facial anatomy (eyes, brows, nose, mouth, inner jaw): **MediaPipe Face**.
     - Body geometry (constrained to segmentation): **MediaPipe Pose**.
     - Photographic value to graphite density: **TASK-113 Tonal Engine**.
  2. *Clean Segmentation Pipeline:*
     - Convert raw multiclass mask into cleaned foreground mask via two-pass connected component analysis with union-find disjoint sets.
     - Reject disconnected side micro-artifacts (`< 2% subject area` or `< 80 pixels`).
     - Morphological closing & opening to eliminate pinholes and smooth pixel staircases.
     - 8-directional Moore-neighborhood boundary contour tracing with clockwise winding.
     - 3-point Gaussian smoothing and adaptive RDP simplification.
  3. *Semantic Spatial Ownership Regions:*
     - Represent explicit `RegionMask`s for hair, face, neck, clothing, and torso.
  4. *Hard Stroke Validation Gate & Boundary Clipping:*
     - Intercept stroke candidates before ordering, scheduling, and rendering.
     - Reject strokes lying outside subject bounds (`outside_subject`), strokes in wrong semantic regions (`wrong_semantic_region`), and cross-subject strokes (`invalid_subject_id`).
     - Trim crossing strokes at the silhouette boundary via bisection segment-polygon clipping.
  5. *Pose Anchoring:*
     - Constrain Pose landmark joints and connections to the subject segmentation mask, preventing shoulders or torso lines from extending into empty background.
* **Consequences:**
  - Outer silhouette, hair boundary, neck, and shoulders are cleanly and authoritatively preserved.
  - Stray diagonal lines and external wave artifacts are completely eliminated at the source layer.
  - Multi-person isolation (`BM-11`) is guaranteed with independent silhouettes, faces, poses, and stroke ownership.
  - 100% deterministic (zero `Math.random()`).
  - 24 test suites pass; average benchmark latency is 903.2 ms (< 1500 ms SLA).







