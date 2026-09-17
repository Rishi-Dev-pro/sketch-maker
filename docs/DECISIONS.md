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


