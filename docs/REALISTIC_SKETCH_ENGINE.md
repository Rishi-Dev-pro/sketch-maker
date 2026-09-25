# MediaPipe High-Fidelity Realistic Sketch Engine

## Architecture & Design Specification (TASK-111)

### 1. Overview & Strategic Target

The **MediaPipe High-Fidelity Realistic Sketch Engine** transforms the sketch vectorization pipeline from producing coarse outline avatars into generating authentic, high-fidelity graphite pencil portraits on clean white paper. 

In accordance with TASK-111 directives:
- **MediaPipe ML is the primary high-fidelity reconstruction provider**.
- Fallback to deterministic CV is disabled during fidelity evaluation to eliminate false-negative visual regressions caused by weaker edge heuristics.
- The default canvas mode is **pure generated-only** (`showSourceImage = false`, `generatedOnly = true`).
- The default style is **`realistic_pencil`** (`#222224` graphite tone, multiply blend mode, feature-weighted stroke dynamics).

---

### 2. Anatomical Landmark Topology (478 Points)

The engine leverages the complete 478-point MediaPipe face mesh and iris landmarker geometry:

| Anatomical Region | MediaPipe Landmark Indices | Generated Features & Accents |
|---|---|---|
| **Left Iris Boundary** | `469, 470, 471, 472` | Closed circular iris contour, pupil center accent, iris rim |
| **Right Iris Boundary** | `474, 475, 476, 477` | Closed circular iris contour, pupil center accent, iris rim |
| **Left Eye Fissure & Crease** | `33, 160, 158, 133, 153, 144`; `246, 161, 160, 159, 158, 157, 173` | Canthi tick accents, lash emphasis, upper eyelid supratarsal crease |
| **Right Eye Fissure & Crease** | `362, 385, 387, 263, 373, 380`; `466, 388, 387, 386, 385, 384, 398` | Canthi tick accents, lash emphasis, upper eyelid supratarsal crease |
| **Eyebrow Boundaries & Grains** | Left: `70, 63, 105, 66, 107`; Right: `300, 293, 334, 296, 336` | Upper/lower boundary curves, directional internal eyebrow hairs (head, arch, tail) |
| **Nose Geometry** | `1, 2, 98, 327, 195, 5, 4, 168` | Dorsal bridge, tip dome, columella shelf (`2, 94, 278, 48`), subnasale, nostril rims (`98, 327`) |
| **Mouth & Oral Fissure** | `61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291` | Philtrum column ridges (`0, 37, 267, 164`), cupid's bow, vermilion border, mental crease |
| **Jawline & Malar Planes** | `10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109` | Mandibular jawline curve, chin apex dome, bilateral malar (cheekbone) planes (`117, 118, 123` / `346, 347, 352`) |

---

### 3. Feature-Specific RDP Simplification Tolerances

Universal simplification destroys fine facial features while keeping broad contours jagged. The engine applies an adaptive Ramer-Douglas-Peucker (RDP) tolerance schedule keyed to semantic feature roles:

```typescript
export function getFeatureSpecificTolerance(
  roleOrRegion: SemanticStrokeRole | SemanticRegion | string,
  baseTolerance: number = 0.001
): number {
  switch (roleOrRegion) {
    case 'eyes':
    case 'lash_accent':
    case 'canthi_tick':
    case 'iris_contour':
      return 0.0004; // Ultra-fine preservation for delicate optical curvature

    case 'mouth':
    case 'philtrum':
    case 'cupid_bow':
      return 0.0006; // Ultra-fine preservation for lip vermilion definition

    case 'nose':
    case 'eyebrows':
    case 'nostril_rim':
      return 0.0008; // Fine preservation for nasal dome and brow grain

    case 'hatching':
    case 'cross_hatching':
    case 'shading':
      return 0.0007; // Fine straightness preservation for procedural pencil lines

    case 'hair':
    case 'hair_strand':
    case 'hair_boundary':
      return 0.0018; // Organic volumetric curvature

    case 'face_contour':
    case 'jawline':
    case 'chin':
      return 0.0012; // Structural jaw contour

    case 'clothing':
    case 'body_outline':
    case 'shoulders':
    default:
      return 0.0035; // Broad structural strokes
  }
}
```

---

### 4. Tonal Luminance Analysis & Procedural Graphite Shading

To convey 3D form without photo underlays, the engine analyzes regional photographic luminance (`Float32Array` buffer) within anatomically defined zones:

1. **Zone Sampling**:
   - Left & Right Eye Sockets
   - Nose Side Wall (Bridge Chiaroscuro based on head pose)
   - Subnasal Shelf (Under-nose cast shadow)
   - Under-Lower-Lip Depresison (Mental sulcus shadow)
   - Submandibular Drop Shadow (Jaw onto neck)
   - Left & Right Cheek / Malar Planes

2. **Classification**:
   - `deep_shadow` (luminance < 0.22)
   - `shadow` (0.22 <= luminance < 0.42)
   - `midtone` (0.42 <= luminance < 0.65)
   - `light` (0.65 <= luminance < 0.85)
   - `highlight` (luminance >= 0.85)

3. **100% Deterministic Procedural Shading**:
   - **Zero `Math.random()`**: All stroke offsets, jitter, and density modulations utilize a deterministic sinusoidal pseudorandom hash:
     ```typescript
     function deterministicPRNG(seed: number): number {
       const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
       return x - Math.floor(x);
     }
     ```
   - **Parallel Hatching**: Generated across midtone and shadow regions angled at natural hand-drawn inclinations (35°–45°).
   - **Cross-Hatching**: Generated across `deep_shadow` regions with a secondary counter-angle (115°–125°) to build realistic graphite density.

---

### 5. Realistic Hair Reconstruction

Replaces blob-like hair masks with structured hair masses:
- **Major Volumetric Masses**: Smoothed crest, crown, left flank, and right flank contours.
- **Directional Flow Curves**: Longitudinal streamlines tracking cranial curvature.
- **Strand Groups**: Delicate internal hair clusters emphasizing layering and texture.

---

### 6. The `realistic_pencil` Style Preset

Configured in `@sketch-maker/style-engine`:
- **Canvas**: Clean pure white paper (`#ffffff`).
- **Graphite Ink**: Deep natural graphite `#222224`.
- **Blend Mode**: `multiply` (mimicking graphite deposit absorption into paper fibers).
- **Line Width**: Modulated from 0.4px (hatching, canthi ticks, lashes) to 2.2px (foundation jawline, silhouette).
- **Opacity**: Layered from 0.40 (faint midtone hatching) to 0.95 (primary expressive contours).

---

### 7. Visual Inspection & Debugging Suite

The Web application UI includes an 8-layer toggling toolbar for real-time diagnostic inspection:
1. `[ ] Source Image` (hidden by default)
2. `[ ] MediaPipe Landmarks` (green coordinate dots)
3. `[ ] Reconstructed Features` (blue anatomical paths)
4. `[ ] Contours` (cyan vector contours)
5. `[ ] Tonal Regions` (amber bounding planes with intensity badges)
6. `[ ] Hatching` (magenta procedural shading strokes)
7. `[ ] Hair Flow` (coral volumetric flow lines)
8. `[x] Final Artwork` (active realistic graphite pencil portrait)

---

### 11. Photographic Likeness & Anatomical Calibration (TASK-113)

To ensure the generated pencil sketch matches the real human subject in the photo rather than resembling a caricature or wireframe avatar:

1. **Separation of Perception Evidence vs. Artwork Strokes:**
   - BlazePose joint skeletons and topological sticks (`nose_to_left_eye_inner`, `shoulders`, etc.) are classified as diagnostic telemetry and are **strictly suppressed** from artwork stroke candidates.
   - Malar cheekbone planes are routed exclusively to soft chiaroscuro tonal shading (`cheek_plane`) and never rendered as hard, dark ink outlines across the cheeks.

2. **3-Zone Hair Volumetric Engine:**
   - Hair is partitioned into three distinct anatomical zones:
     - **Crown Mass:** Arched volume above the cranium following the natural hairline.
     - **Left & Right Lateral Flanks:** Free-flowing volumetric streams originating at the temples and cascading around the jaw to shoulder level.
   - Eliminates artificial cross-face lines and hair-cap ellipses, ensuring hair frames the facial structure authentically.
   - Accepts neural semantic segmentation loops (`SemanticMask`) when available to reproduce the subject's exact haircut silhouette.

3. **Eyebrow Flow Decomposition:**
   - MediaPipe's 10-point closed loop is separated into its upper and lower margins to calculate a singular natural midline trajectory (`arch`).
   - Six directional feathering strokes (`hairStrokes`) angle dynamically from the medial head (steep upward grain) to the lateral tail (subtle downward sweep), capturing genuine eyebrow texture without cartoon wireframe boundaries.

4. **Anatomical Body & Neck Convergence:**
   - Necklines follow the natural sternocleidomastoid and trapezius convergence.
   - Shoulder paths follow smooth anatomical curves rather than straight stick lines.
   - Clothing necklines are modeled as smooth crew-neck arcs or traced from neural clothing segmentation contours.

---

### 12. Photo-Exact Likeness & Multi-Modal Reconstruction (TASK-114)

1. **Accurate Eyelid Topology & Creases:**
   - Re-indexed MediaPipe Face Mesh eyelid loops: separated upper eyelid curves (`[33..133]` and `[362..263]`) from lower eyelid margins (`[133..33]` and `[263..362]`).
   - Restored supratarsal eyelid crease trajectories (`[130..190]` and `[359..414]`).
   - Smooth 3-point Gaussian filtering eliminates landmark digitization jitter while preserving delicate almond-shaped eye geometry.

2. **Continuous Oral Fissure Seam:**
   - Standardized oral fissure on the 11-point stomion line `[78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308]`, resolving tangled 20-point loop knots.
   - Commissure corners rendered as subtle soft anchor accents rather than protruding triangular ticks.

3. **Unified Multi-Modal Pipeline Re-Enrichment:**
   - Re-evaluates `enrichSubjectWithReconstruction` after face, pose, and segmentation masks are unified in `mediapipe-delegate.ts`.
   - Replaced property access on `subject.semanticSegmentation.masks` from object indexing to array `.find()`, guaranteeing neural segmentation masks reach the hair and body reconstructors.

4. **Authentic Bob Hairstyle Dynamics:**
   - Seamlessly extracts neural hair segmentation contours to trace the real outer boundary.
   - Downward-flowing directional streamlines cascade down both flanks, curling inward below the jawline to accurately replicate shoulder-length bob hairstyles.
   - Eliminates artificial mathematical skull domes and headband forehead arcs.

5. **Artifact-Free Clothing & Anatomy:**
   - Suppressed closed polygon loops across the lower boundary of the frame, eliminating horizontal chest triangles.
   - Synthesizes smooth, natural downward-sloping shoulder curves and organic crewneck collar arcs.

---

### 13. Photographic Tonal Reconstruction & High-Fidelity Graphite Engine (TASK-113)

TASK-113 completes the transformation of the portrait engine from a line-centric vector sketch to a **procedural graphite value accumulation engine**.

#### 13.1 Continuous 2D Spatial TonalField Abstraction
- Replaces coarse scalar averages with spatial grids $L(x,y)$ sampled via bilinear interpolation over $16 \times 16$ to $24 \times 24$ cells.
- Preserves genuine chiaroscuro gradients across 15+ anatomical zones: `forehead`, `left_cheek`, `right_cheek`, `left_eye_socket`, `right_eye_socket`, `nose_bridge`, `nose_tip`, `subnasal`, `upper_lip`, `lower_lip`, `chin`, `jaw_shadow`, `neck`, `hair_mass`, and `clothing_mass`.

#### 13.2 Relative Percentile Luminance Normalization
- Extracts robust facial percentiles ($p_{10}, p_{15}, p_{35}, p_{65}, p_{85}, p_{90}$) across the subject mask.
- Normalizes local luminance relative to subject lighting distribution:
  $$u(x,y) = \text{clamp}\left(\frac{L(x,y) - p_{15}}{p_{85} - p_{15}}, 0, 1\right)$$
- Protects highlight preservation and shadow contrast across high-key, low-key, and HDR lighting.

#### 13.3 Calibrated Non-Linear Perceptual Graphite Density Curve
- **Pristine Paper White Highlights ($u \ge 0.85$):** $D = 0.0$.
- **Subtle Form Modeling ($0.50 \le u < 0.85$):** $D(u) = 0.20 + 0.35 \times (1 - \frac{u - 0.50}{0.35})^{1.3}$.
- **Firm Graphite Shadows ($0.20 \le u < 0.50$):** $D(u) = 0.55 + 0.25 \times (1 - \frac{u - 0.20}{0.30})^{1.5}$.
- **Deep Crevices & Occlusions ($u < 0.20$):** $D(u) = 0.80 + 0.20 \times (1 - \frac{u}{0.20})^{1.8}$.

#### 13.4 Multi-Scale Form-Following Graphite Marks
- **Scale A (Broad Tonal Marks):** Volumetric hair mass, clothing mass, cheeks, and neck (length 0.04–0.08).
- **Scale B (Medium Form Strokes):** Directional strokes along anatomical surface curvature (malar $60^\circ/120^\circ$, jaw $30^\circ$, nose $80^\circ$, neck $70^\circ$).
- **Scale C (Fine Anatomical Hatching):** Ocular sockets, philtrum columns, chin cleft, and lip planes (length 0.01–0.02).
- **Scale D (Micro Accents):** Dark 4B accents and crevice cross-hatching for pupils, nostrils, and oral fissure corners.

#### 13.5 Mass-First Hair & Volumetric Garment Reconstruction
- Neural hair mask is sampled to generate high-density graphite under-mass ($D \approx 0.70–0.95$), ensuring hair reads as a solid mass before individual strands are added.
- Neural clothing mask is sampled to generate visible graphite clothing strokes, rendering sweaters and shirts with genuine tonal depth.

#### 13.6 Contour Suppression & The Contour-Off Test
- Outlines are suppressed along low-contrast boundaries (nasal bridge, cheek transitions, lower eyelid).
- Confirmed by the Contour-Off Acceptance Test: with contours, fine anatomy, and hair strands disabled, the portrait reads with full human recognition purely through 3,352 lines of chiaroscuro value fields and graphite shading marks.

---

### 14. Segmentation-Anchored Structural Reconstruction (TASK-114)

TASK-114 establishes **neural segmentation as the authoritative outer structural anchor**, eliminating structural loss between perception and rendering while strictly enforcing semantic spatial ownership.

#### 14.1 Responsibility Matrix
| Anatomical Structure | Primary Authority | Secondary Evidence |
| :--- | :--- | :--- |
| Outer Silhouette / Head Boundary | Semantic Segmentation | Face Landmarks (temple / jaw envelope) |
| Hair Silhouette & Mass Boundary | Semantic Segmentation (hair) | Face Landmarks |
| Inner Facial Anatomy | MediaPipe Face (478) | Photographic Luminance Field |
| Eyes, Eyebrows, Nose, Mouth | MediaPipe Face (478) | Photographic Luminance Field |
| Jaw Reference / Contour | MediaPipe Face + Segmentation | Face-to-Silhouette Fusion |
| Neck | Segmentation + Pose | Face Jaw Convergence |
| Shoulders & Torso Boundary | Semantic Segmentation (body) | MediaPipe Pose (33) |
| Clothing Boundary & Mass | Semantic Segmentation (clothing) | Photographic Luminance Field |

#### 14.2 Clean Segmentation & Connected Component Analysis
- Converts raw probability masks into clean binary masks via thresholding ($T = 0.50$).
- Deterministic 2-pass connected-component labeling with disjoint-set forest merges connected foreground regions.
- Filters disconnected noise and floating background artifacts (< 2% primary subject area or < 80 px).
- Closes micro-gaps and fills internal holes via $3 \times 3$ morphological dilation and erosion.

#### 14.3 Authoritative Subject Silhouette & Regional Boundaries
- Moore-neighborhood 8-directional contour boundary tracing computes clockwise boundary paths.
- 3-point Gaussian smoothing removes stair-step pixel quantization artifacts.
- Ramer-Douglas-Peucker (RDP) adaptive geometric simplification preserves hair curves while simplifying long body/torso edges.
- Traces regional masks (`hair`, `clothing`, `torso`) to form definitive spatial ownership boundaries.

#### 14.4 Face-to-Silhouette & Pose Fusion
- Structural model fuses inner facial landmarks within the outer silhouette coordinate system.
- Pose skeleton joints and limbs are validated against segmentation; limb strokes extending into empty background are rejected.
- Hair reconstructor and clothing shading generator sample region masks (`isPointInOrNearPoly` and `density > 0`), stopping stray wave lines and broad diagonal hatching from escaping the subject.

#### 14.5 Hard Spatial Ownership Validation & Clipping Gate
- Candidate strokes are validated against the authoritative silhouette and semantic region masks prior to sorting, timeline generation, and rendering.
- Strokes extending across subject boundaries are clipped at boundary intersections using binary bisection search.
- Unwanted strokes originating from out-of-bounds bounding box extrapolation are rejected with strict telemetry recording:
  - `totalCandidates`: Total raw geometric strokes generated.
  - `validCandidates`: Strokes passing all ownership gates.
  - `rejectedCandidates`: Strokes dropped (`outside_subject`, `wrong_semantic_region`, `geometric_invalidity`).
  - `clippedCandidates`: Strokes trimmed to stay strictly within subject contours.

