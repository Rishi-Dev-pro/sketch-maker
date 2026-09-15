# PROJECT_CONTEXT.md

## Project Identity
* **Project Name:** Photo-to-Procedural-Art (Working Repository: `sketch-maker`)
* **Project Type:** Creative procedural art generation engine & web/mobile platform
* **Primary Deployment (Initial):** Web Application on Vercel
* **Future Deployment:** React Native (iOS & Android) with local offline execution

---

## Executive Summary & Purpose
Photo-to-Procedural-Art is not a generic raster filter or simple edge-detection shader. It is a reusable, high-precision **photo-to-structure-to-strokes** procedural art generation engine. 

The application transforms a user's photographic input into recognizable, artistically stylized vector artwork that appears to be constructed progressively stroke-by-stroke over time. The defining user experience is both the final high-resolution aesthetic artwork and the hypnotic, cinematic progressive drawing process (timelapse reveal).

---

## Core Product Vision & User Experience

### 1. The Core Transformation Journey
```
USER PHOTO
    ↓
IMAGE PREPROCESSING (Grayscale, Normalization, Downscale/Upscale)
    ↓
SUBJECT DETECTION / SEGMENTATION (Subject Mask vs Background)
    ↓
STRUCTURAL ANALYSIS (Face Landmarks, Body Skeleton, Silhouette Boundaries)
    ↓
FEATURE EXTRACTION (Salient Edge Flow, Vector Fields, High-Frequency Details)
    ↓
CONTOUR / VECTOR GENERATION (Parametric Curves, Polyline Extraction)
    ↓
IMPORTANCE WEIGHTING (Eyes, Mouth, Silhouette > Clothing > Texture > Background)
    ↓
STROKE GENERATION (Adaptive Density, Curve Simplification)
    ↓
STROKE ORDERING (Intentional Hierarchy: Canvas → Silhouette → Structure → Fine Details → Highlights)
    ↓
STYLE ENGINE (Cinematic Line Art, Sketch, Binary, Neon, Blueprint, Terminal, Red Line)
    ↓
TIMELINE / ANIMATION (Procedural Draw-in, Particle/Stroke Interpolation)
    ↓
RENDERING (HTML5 Canvas / WebGL Progressive Draw)
    ↓
ARTWORK + TIMELAPSE (Replay, High-Res PNG, MP4/WebM Animation Export)
    ↓
DOWNLOAD / SHARE
```

### 2. Primary Product Priorities (Strict Hierarchy)
1. **Web Application:** Instant access, zero installation, link-based sharing, rapid iteration, deployable on Vercel.
2. **Core Processing Engine:** Independent, headless, reusable algorithmic engine decoupled from any UI framework.
3. **Perceptual Precision:** Artwork must preserve recognizable subject identity and structure rather than noisy pixel textures.
4. **Performance & Scalability:** Responsive runtime across heterogeneous devices; device-aware execution profiles.
5. **Styles & Customization:** Modularity allowing multiple artistic renderers and real-time visual tweaks over a single cached structural analysis.
6. **React Native Mobile App:** Native packaging once the web engine and algorithmic quality are proven.
7. **Offline Generation:** On-device, local-first processing without server dependency or data harvesting.

---

## Core Philosophies & Architectural Principles

### 1. The Golden Rule of Architecture
> *"The application is the experience; the engine is the product."*
> 
> Core processing modules (`image-processing`, `structural-analysis`, `stroke-engine`, `style-engine`, `animation-engine`, `export-engine`) must remain strictly decoupled from UI components (React, Next.js, React Native). The web app is simply the first client of the engine.

### 2. Precision Philosophy: Perceptual Structural Accuracy
Basic edge detectors (Sobel, Canny, Laplacian) fail on human portraits because they treat all pixel gradients equally—producing clutter in textured backgrounds and hair while losing delicate facial lines.
* **Structural Priority:**
  1. Primary Subject Silhouette & Pose
  2. Major Facial Geometry (Eyes, Eyebrows, Nose, Mouth, Jawline)
  3. Hair Boundary & Major Flow Contours
  4. Body & Clothing Structural Outlines
  5. Secondary Textures & Fine Accents
  6. Background (Optional: Keep, Suppress, Blur, or Outline)
* **Adaptive Stroke Density:** Allocation of strokes is proportional to semantic importance, not pixel contrast.

### 3. Scalability & Portability Philosophy
* **Analyze Once, Reuse Often (Caching Strategy):** Structural analysis and vectorization are the most computationally intensive operations. Once a photo is analyzed into a `SubjectModel` and base `StrokeModel`, the user can switch styles (e.g., from Sketch to Neon to Blueprint) or adjust rendering parameters (line width, color, speed, glow) instantaneously without re-analyzing the original photo.
* **Device Scalability Profiles:**
  * `FAST`: Lower processing resolution, restricted stroke budget (mobile / low-power devices).
  * `BALANCED`: Moderate resolution, balanced stroke count (standard laptops / modern phones).
  * `HIGH`: High resolution, rich detail density (desktop workstations).
  * `ULTRA`: Maximum practical resolution and curve subdivision for fine print export.

### 4. Performance Philosophy
* Avoid premature optimization, but never guess—measure.
* Perceptual quality per millisecond is the key benchmark.
* Heavy numeric processing must run off the main UI thread (Web Workers / OffscreenCanvas) or be compiled efficiently (WebAssembly when justified).

### 5. Privacy & Local-First Philosophy
* User photographs are inherently sensitive personal data.
* The preferred architectural model is **local-first client execution**: the photo never leaves the user's browser unless an optional server-side fallback is explicitly requested.
* Future mobile builds must operate 100% offline.

---

## Long-Term Evolution
Beyond initial single-person portraits, the universal intermediate representation is designed to expand progressively to:
* Full-body human subjects and multi-person group portraits.
* Animals and pets.
* Architecture, vehicles, and industrial objects.
* Landscapes and stylized generative scenery.
* Advanced community styles, custom shaders, and interactive camera-to-procedural-art streams.
