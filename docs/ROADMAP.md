# ROADMAP.md

## Master Product & Engineering Roadmap

This roadmap translates the product vision from the technical specification into sequential development phases and version milestones. Development strictly adheres to the principle: **Prove visual quality and precision first, build the web product second, optimize and scale third, then build the native/offline application.**

---

## 1. Version Milestones

| Version | Primary Objective | Key Deliverables | Status |
| :--- | :--- | :--- | :--- |
| **v0.0** | **Project Foundation & Context** | Persistent docs, architectural blueprints, repo scaffold, development rules | **IN_PROGRESS** |
| **v0.1** | **Technical Feasibility Prototype** | Headless pipeline: Photo → Segmentation → Contours → Strokes → Animation | PLANNED |
| **v0.2** | **Core Structural Engine** | Reusable `SubjectModel`, landmark extraction, adaptive density weighting | PLANNED |
| **v0.3** | **Web Drawing Prototype** | Minimal browser UI: drag-and-drop photo, live progressive canvas rendering | PLANNED |
| **v0.5** | **Precision Validation** | Benchmark test suite (12 image categories), background suppression, noise tuning | PLANNED |
| **v1.0** | **WEB MVP** | Production-ready Vercel deployment: upload, preview, generate, replay, download PNG | PLANNED |
| **v1.1** | **Precision Improvements** | Enhanced facial recognizability, hairline fidelity, clothing line simplification | PLANNED |
| **v1.2** | **Multiple Styles** | Multi-renderer engine (Cinematic Line Art, Sketch, Binary, Neon, Blueprint) | PLANNED |
| **v1.3** | **Customization** | User controls: line color, background color, stroke thickness, density, speed, glow | PLANNED |
| **v1.4** | **Export & Sharing** | High-res PNG export, MP4/WebM progressive video export, social dimension presets | PLANNED |
| **v1.5** | **Web Scalability & Performance** | OffscreenCanvas, Web Workers, structural caching, adaptive quality profiles | PLANNED |
| **v2.0** | **PWA (Progressive Web App)** | Offline app shell, installable web experience, local device storage | DEFERRED |
| **v2.5** | **Advanced Structural Analysis** | Multi-subject, complex poses, pets/animals, architectural subjects | DEFERRED |
| **v3.0** | **React Native Mobile App** | Native mobile client consuming the core headless engine | DEFERRED |
| **v3.5** | **Offline-First Mobile** | 100% on-device model execution without internet connection | DEFERRED |
| **v4.0** | **Mobile Optimization** | Battery impact optimization, GPU-accelerated mobile rendering, device profiling | DEFERRED |
| **v5.0+** | **Unified Creative Ecosystem** | Custom shader graph, AI style assistance, community style sharing | DEFERRED |

---

## 2. Detailed Development Phases

### Phase 0: Product & Technical Foundation (CURRENT)
* **Goal:** Define requirements, user journey, architecture, benchmark dataset, quality criteria, performance metrics, and documentation system.
* **Exit Criteria:** Documentation structure fully created and approved by primary user; repository ready for scaffolding.

### Phase 1: Feasibility Prototype (v0.1)
* **Goal:** Verify algorithmic feasibility of the complete pipeline without UI overhead.
* **Pipeline:** Photo → Preprocessing → Subject Mask → Structural Contours → Ordered Strokes → Progressive Canvas Draw.
* **Test Dataset:** Diverse portraits (front, profile, glasses, varied skin tones, hair textures, low light).
* **Exit Criteria:** At least one input photo produces recognizable, artistically satisfying progressive stroke output.

### Phase 2: Structural Analysis Engine (v0.2)
* **Goal:** Build the independent `structural-analysis` package.
* **Key Components:**
  * Foreground segmentation (subject vs. background).
  * Face landmark detection (eyes, brows, nose, mouth, jawline, ears).
  * Silhouette and major body boundary extraction.
  * Universal `SubjectModel` data output with confidence scores.
* **Exit Criteria:** Generates a structured, validated `SubjectModel` JSON representation for any valid input photo.

### Phase 3: Web Rendering Prototype (v0.3)
* **Goal:** Build a minimal browser canvas prototype to visualize the progressive drawing pipeline in real-time.
* **Key Components:**
  * File upload / drop zone.
  * Real-time 60fps HTML5 Canvas 2D progressive stroke animation.
  * Stroke ordering engine (Silhouette → Major Contours → Facial Landmarks → Fine Accents).
* **Exit Criteria:** Interactive web preview displaying smooth, non-blocking stroke drawing.

### Phase 4: Web MVP (v1.0)
* **Goal:** Ship the first public production web application on Vercel.
* **Features:** Upload photo → preview → generate artwork → watch progressive drawing → replay → download PNG.
* **Scope Protection:** Exclude accounts, databases, payments, social feeds, or complex style catalogs.
* **Exit Criteria:** Deployed on Vercel; zero runtime crashes on standard test images; mobile-responsive UI.

### Phase 5: Web Precision Iteration (v1.1)
* **Goal:** Drastically elevate the visual recognizability and cleanliness of generated artwork.
* **Key Improvements:**
  * Eliminate noisy texture lines and wrinkles.
  * Sharpen facial geometry (prevent distorted eyes/mouth).
  * Background suppression modes (remove, blur, outline).
* **Exit Criteria:** Scores ≥ 8/10 on the benchmark quality evaluation matrix.

### Phase 6: Style Engine (v1.2)
* **Goal:** Implement the multi-renderer architecture over the cached `StrokeModel`.
* **Styles:**
  * **Cinematic Line Art:** Elegant, weighted curves with tapered endpoints.
  * **Pencil Sketch:** Cross-hatching, organic jitter, textured pencil simulation.
  * **Binary / Matrix:** Digital, quantized strokes with geometric precision.
  * **Neon / Cyber:** Glowing emissive curves with dark background bloom.
  * **Blueprint:** Architectural cyan lines on grid background.
* **Exit Criteria:** Switching styles takes < 100ms without re-running structural analysis.

### Phase 7: Customization (v1.3)
* **Goal:** Expose intuitive visual controls to the user.
* **Controls:** Line color, background color, line thickness, stroke density, animation speed, glow radius, detail level.
* **Exit Criteria:** Real-time updates with instantaneous slider feedback.

### Phase 8: Export & Sharing (v1.4)
* **Goal:** Deliver exportable artifacts for social media and physical printing.
* **Outputs:** High-res PNG (2x/4x supersampling), progressive animation MP4/WebM video, social crop presets (1:1, 9:16).
* **Exit Criteria:** Video generation runs reliably in-browser without crashing memory.

### Phase 9: Web Performance & Scalability (v1.5)
* **Goal:** Optimize client performance across diverse hardware.
* **Optimizations:** Web Workers for background analysis, OffscreenCanvas, adaptive stroke budgets (`FAST`, `BALANCED`, `HIGH`, `ULTRA`), memory pooling.
* **Exit Criteria:** Processing time < 3s on standard laptops; rendering strictly maintains 60 FPS.

### Phases 10 - 12: PWA, Mobile & Offline First (v2.0 - v4.0)
* **Goal:** Port the proven engine to React Native with full offline capability.
* **Scope:** Deferred until Web MVP has achieved product-market fit and visual excellence.
