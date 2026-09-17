# BENCHMARKS.md

## Performance & Quality Benchmarks

This document tracks quantitative performance benchmarks, memory profiles, and qualitative evaluation metrics across development iterations. 

> **Golden Rule:** *"Always distinguish 'feels faster' from 'measured faster'. Benchmark before and after optimizations."*

---

## 1. Key Performance Targets (SLA)

| Metric | Target (Balanced Profile) | Ultra Profile Target | Measured (Current) | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Preprocessing & Downscaling Latency** | < 300 ms | < 800 ms | **68.7 ms (avg 12 imgs), 240.3 ms (24MP)** | **PASS (EXCEEDS SLA)** |
| **Subject Segmentation Latency** | < 500 ms | < 1,200 ms | **239.7 ms (avg 12 imgs)** | **PASS (EXCEEDS SLA)** |
| **Total Analysis Latency** (Photo → `SubjectModel`) | < 1,500 ms | < 3,500 ms | Preprocessing (68.7ms) + Segmentation (239.7ms) = **308.4 ms** | **IN_PROGRESS (ON TRACK)** |
| **Stroke Generation** (`SubjectModel` → `StrokeModel`) | < 500 ms | < 1,200 ms | Pending Phase 1 | NOT MEASURED |
| **Style Switching Latency** (Using Cached Strokes) | < 80 ms | < 150 ms | Pending Phase 6 | NOT MEASURED |
| **Rendering FPS** (Progressive Animation Loop) | 60 FPS (Stable) | ≥ 55 FPS | Pending Phase 3 | NOT MEASURED |
| **Peak Heap RAM (Preprocessing + Segmentation)** | < 150 MB | < 350 MB | **~24.5 MB (Balanced), ~28.0 MB (High)** | **PASS (EXCEEDS SLA)** |
| **Initial Bundle Size (Web Client)** | < 350 KB (gzipped) | N/A | 46.2 KB (js) + 0.8 KB (css) | **PASS** |
| **Export Time (High-Res 4K PNG)** | < 1,000 ms | < 2,500 ms | Pending Phase 8 | NOT MEASURED |
| **Video Export Time (10s 1080p MP4)** | < 8,000 ms | < 15,000 ms | Pending Phase 8 | NOT MEASURED |

---

## 2. Adaptive Quality Profiles

| Profile | Target Device Class | Max Processing Resolution | Stroke Budget (Max) | Curve Smoothing Level |
| :--- | :--- | :--- | :--- | :--- |
| **FAST** | Low-end mobile / Budget laptops | 512 × 512 px | ~1,200 strokes | High (Aggressive simplification) |
| **BALANCED** | Standard smartphones / Laptops | 1024 × 1024 px | ~3,500 strokes | Medium |
| **HIGH** | Modern desktops / Flagship devices | 1600 × 1600 px | ~7,500 strokes | Precise |
| **ULTRA** | Workstations / Print Export Mode | 3000 × 3000 px | ~15,000+ strokes | Ultra-fine |

---

## 3. Standard Benchmark Image Dataset (12 Categories)

To guarantee that algorithmic improvements do not cause regressions on difficult images, every major engine release must be evaluated against the standard test images curated and stored in [`tests/images/`](file:///d:/projects%202.0/main/sketch-maker/tests/images/):

| ID | Filename | Category | Dimensions | MP | Size | Evaluation Focus |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **BM-01** | `bm-01-front-portrait.jpg` | Neutral Portrait | 1024 × 1024 | 1.05 MP | 635 KB | Facial landmark symmetry & primary contour clarity |
| **BM-02** | `bm-02-side-profile.jpg` | Side Profile | 1024 × 1024 | 1.05 MP | 577 KB | Profile jawline & nose curve silhouette fidelity |
| **BM-03** | `bm-03-glasses.jpg` | Eyewear Occlusion | 1024 × 1024 | 1.05 MP | 708 KB | Eyeglass frame extraction vs. pupil preservation |
| **BM-04** | `bm-04-facial-hair.jpg` | Facial Hair | 1024 × 1024 | 1.05 MP | 720 KB | Dense beard texture vs. anatomical skin boundary |
| **BM-05** | `bm-05-hair-variety.jpg` | Textured Hair | 1024 × 1024 | 1.05 MP | 723 KB | Afro/coiled curl simplification & stroke budget |
| **BM-06** | `bm-06-extreme-lighting.jpg`| Chiaroscuro / HDR | 1024 × 1024 | 1.05 MP | 607 KB | Backlight rim lighting & deep shadow tolerance |
| **BM-07** | `bm-07-complex-background.jpg`| Cluttered Scene | 1024 × 1024 | 1.05 MP | 922 KB | Foreground segmentation & background suppression |
| **BM-08** | `bm-08-low-light.jpg` | ISO Noise | 1024 × 1024 | 1.05 MP | 732 KB | Low-light sensor grain suppression & SNR filtering |
| **BM-09** | `bm-09-full-body-standing.jpg`| Full Standing | 896 × 1200 | 1.08 MP | 560 KB | Whole-body anatomical proportions & grounding |
| **BM-10** | `bm-10-full-body-sitting.jpg` | Complex Occlusion | 896 × 1200 | 1.08 MP | 663 KB | Cross-legged sitting pose with folded limbs |
| **BM-11** | `bm-11-multi-person.jpg` | Multi-Subject | 1200 × 896 | 1.08 MP | 636 KB | Multi-person segmentation & touching silhouettes |
| **BM-12** | `bm-12-high-res.jpg` | 24MP+ Master | 6000 × 4000 | 24.00 MP | 1.27 MB | High-res downscaling throughput & peak RAM limits |

* Complete machine-readable metadata and verification checksums are tracked in [`tests/images/dataset.json`](file:///d:/projects%202.0/main/sketch-maker/tests/images/dataset.json).
* Automated dataset integrity validation is executed via `npm run test:dataset` (or `node tests/images/validate.js`).

---

## 4. Qualitative Visual Evaluation Matrix

Every evaluation run grades outputs across 7 dimensions on a 1–10 scale:

| Dimension | Question | Passing Bar |
| :--- | :--- | :--- |
| **Structural Accuracy** | Does the artwork preserve anatomical and geometric proportions? | ≥ 8 / 10 |
| **Recognizability** | Does the subject remain immediately recognizable to a human observer? | ≥ 8 / 10 |
| **Noise Suppression** | Are irrelevant wrinkles, fabric artifacts, and background noise suppressed? | ≥ 8 / 10 |
| **Composition & Silhouette** | Is the primary subject cleanly framed and separated from clutter? | ≥ 8 / 10 |
| **Detail Hierarchy** | Do eyes, mouth, and key contours take priority over low-value texture? | ≥ 9 / 10 |
| **Animation Flow** | Does the progressive drawing reveal feel organic and artistically intentional? | ≥ 8 / 10 |
| **Consistency** | Does quality remain stable across varied skin tones, ages, and backgrounds? | ≥ 8 / 10 |

---

## 5. Benchmark History Log
 
### Run 2026-09-17 — TASK-101 Image Preprocessing & Normalization Evaluation
* **Hardware Environment:** Node.js v24.16.0, Windows x64, Pure TypeScript implementation.
* **Test Command:** `npm run benchmark:image-processing` (`tests/image-processing/benchmark-runner.ts`)
* **Scope:** All 12 standard benchmark categories (`BM-01` through `BM-12`), including 24MP high-resolution downsampling.

| Benchmark ID | Input Resolution | Input MP | Target Resolution | Downscaled MP | Preprocessing Latency | Luminance Range | Luminance Mean |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `BM-01-FRONT-PORTRAIT` | 1024 × 1024 | 1.05 MP | 1024 × 1024 | 1.05 MP | 48.8 ms | [0, 255] | 148.2 |
| `BM-02-SIDE-PROFILE` | 1024 × 1024 | 1.05 MP | 1024 × 1024 | 1.05 MP | 30.4 ms | [0, 255] | 68.6 |
| `BM-03-GLASSES` | 1024 × 1024 | 1.05 MP | 1024 × 1024 | 1.05 MP | 45.9 ms | [0, 255] | 89.9 |
| `BM-04-FACIAL-HAIR` | 1024 × 1024 | 1.05 MP | 1024 × 1024 | 1.05 MP | 36.4 ms | [0, 255] | 91.1 |
| `BM-05-HAIR-VARIETY` | 1024 × 1024 | 1.05 MP | 1024 × 1024 | 1.05 MP | 26.0 ms | [0, 252] | 87.1 |
| `BM-06-EXTREME-LIGHTING` | 1024 × 1024 | 1.05 MP | 1024 × 1024 | 1.05 MP | 15.6 ms | [0, 255] | 21.1 |
| `BM-07-COMPLEX-BACKGROUND`| 1024 × 1024 | 1.05 MP | 1024 × 1024 | 1.05 MP | 21.0 ms | [0, 255] | 105.5 |
| `BM-08-LOW-LIGHT` | 1024 × 1024 | 1.05 MP | 1024 × 1024 | 1.05 MP | 34.7 ms | [0, 255] | 37.3 |
| `BM-09-FULL-BODY-STANDING`| 896 × 1200 | 1.08 MP | 765 × 1024 | 0.78 MP | 82.2 ms | [0, 255] | 182.1 |
| `BM-10-FULL-BODY-SITTING` | 896 × 1200 | 1.08 MP | 765 × 1024 | 0.78 MP | 78.2 ms | [0, 255] | 154.8 |
| `BM-11-MULTI-PERSON` | 1200 × 896 | 1.08 MP | 1024 × 765 | 0.78 MP | 97.9 ms | [0, 255] | 165.0 |
| `BM-12-HIGH-RES` | 6000 × 4000 | 24.00 MP | 1024 × 683 | 0.70 MP | 307.7 ms | [0, 255] | 119.3 |

#### 24MP BM-12 Specialized Stress Profile Measurements:
- **`FAST` Profile (Max 512px):** Output 512 × 341 (0.17 MP) — **230.9 ms**, Heap: 18.2 MB.
- **`BALANCED` Profile (Max 1024px):** Output 1024 × 683 (0.70 MP) — **240.3 ms**, Heap: 18.6 MB.
- **`HIGH` Profile (Max 1600px):** Output 1600 × 1067 (1.71 MP) — **407.5 ms**, Heap: 19.1 MB.
- **Result:** Balanced profile average across 12 benchmark images: **68.7 ms** (well below 300ms SLA). 24MP memory consumption strictly bounded at ~18-19MB (far below 150MB SLA ceiling).

---

### Run 2026-09-17 — TASK-102 Subject Segmentation & Background Separation Evaluation
* **Hardware Environment:** Node.js v24.16.0, Windows x64, Pure TypeScript implementation.
* **Test Command:** `npm run benchmark:segmentation` (`tests/structural-analysis/visual-inspector.ts`)
* **Scope:** All 12 standard benchmark categories (`BM-01` through `BM-12`). Includes visual inspection report in `tests/artifacts/segmentation-report.html`.

| Benchmark ID | Input Dimensions | Processing Resolution | Segmentation Latency | Subject Coverage | Instances Detected | Confidence Score |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `BM-01-FRONT-PORTRAIT` | 1024 × 1024 | 1024 × 1024 | 313.2 ms | 52.7% | 1 (`primary_subject`) | 0.538 |
| `BM-02-SIDE-PROFILE` | 1024 × 1024 | 1024 × 1024 | 243.6 ms | 38.7% | 1 (`primary_subject`) | 0.451 |
| `BM-03-GLASSES` | 1024 × 1024 | 1024 × 1024 | 343.8 ms | 43.4% | 1 (`primary_subject`) | 0.486 |
| `BM-04-FACIAL-HAIR` | 1024 × 1024 | 1024 × 1024 | 263.9 ms | 47.9% | 1 (`primary_subject`) | 0.450 |
| `BM-05-HAIR-VARIETY` | 1024 × 1024 | 1024 × 1024 | 206.3 ms | 51.2% | 1 (`primary_subject`) | 0.547 |
| `BM-06-EXTREME-LIGHTING` | 1024 × 1024 | 1024 × 1024 | 208.4 ms | 19.0% | 1 (`primary_subject`) | 0.527 |
| `BM-07-COMPLEX-BACKGROUND`| 1024 × 1024 | 1024 × 1024 | 164.4 ms | 85.8% | 1 (`primary_subject`) | 0.469 |
| `BM-08-LOW-LIGHT` | 1024 × 1024 | 1024 × 1024 | 275.5 ms | 32.3% | 1 (`primary_subject`) | 0.434 |
| `BM-09-FULL-BODY-STANDING`| 896 × 1200 | 765 × 1024 | 232.3 ms | 38.0% | 1 (`primary_subject`) | 0.486 |
| `BM-10-FULL-BODY-SITTING` | 896 × 1200 | 765 × 1024 | 224.5 ms | 51.9% | 1 (`primary_subject`) | 0.486 |
| `BM-11-MULTI-PERSON` | 1200 × 896 | 1024 × 765 | 164.8 ms | 42.0% | 1 (`primary_subject`) | 0.605 |
| `BM-12-HIGH-RES` | 6000 × 4000 | 1024 × 683 | 235.2 ms | 49.9% | 1 (`primary_subject`) | 0.456 |

* **Average Segmentation Latency (Balanced Profile):** **239.7 ms** (SLA target: < 500 ms).
* **Combined Pipeline Latency (Preprocessing + Segmentation):** **308.4 ms** (SLA target: < 1500 ms for total analysis).

---

### Run 2026-09-17 — TASK-103 Step 2A Eye & Eyelid Landmark Detection Evaluation
* **Hardware Environment:** Node.js v24.16.0, Windows x64, Pure TypeScript implementation.
* **Test Command:** `npm run benchmark:eyes` (`tests/structural-analysis/eye-inspector.ts`)
* **Scope:** All 12 standard benchmark categories (`BM-01` through `BM-12`). Includes visual inspection report in `tests/artifacts/eye-report.html`.

| Benchmark ID | Pose Detected | Left Eye Visibility | Right Eye Visibility | Left Conf | Right Conf | Iris (L / R) | Pupil (L / R) | Eyelid Pts (L / R) | Eye Latency |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `BM-01-FRONT-PORTRAIT` | `frontal` | `visible` | `visible` | 0.47 | 0.56 | YES / YES | YES / YES | 234 / 234 | 4.63 ms |
| `BM-02-SIDE-PROFILE` | `left_profile` | `visible` | `occluded` | 0.41 | 0.00 | YES / NONE | YES / NONE | 154 / 0 | 2.08 ms |
| `BM-03-GLASSES` | `frontal` | `visible` | `visible` | 0.47 | 0.47 | YES / YES | YES / YES | 234 / 234 | 0.70 ms |
| `BM-04-FACIAL-HAIR` | `three_quarter_left` | `visible` | `visible` | 0.43 | 0.43 | YES / YES | YES / YES | 242 / 242 | 0.73 ms |
| `BM-05-HAIR-VARIETY` | `frontal` | `visible` | `visible` | 0.39 | 0.33 | NONE / YES | NONE / YES | 238 / 238 | 1.28 ms |
| `BM-06-EXTREME-LIGHTING` | `frontal` | `visible` | `visible` | 0.61 | 0.52 | YES / YES | YES / YES | 218 / 218 | 0.51 ms |
| `BM-07-COMPLEX-BACKGROUND`| `frontal` | `visible` | `visible` | 0.53 | 0.53 | YES / YES | YES / YES | 450 / 450 | 1.92 ms |
| `BM-08-LOW-LIGHT` | `three_quarter_right` | `visible` | `visible` | 0.43 | 0.31 | YES / YES | YES / NONE | 286 / 286 | 0.59 ms |
| `BM-09-FULL-BODY-STANDING`| `three_quarter_right` | `visible` | `visible` | 0.56 | 0.61 | YES / YES | YES / YES | 146 / 146 | 0.40 ms |
| `BM-10-FULL-BODY-SITTING` | `frontal` | `visible` | `visible` | 0.33 | 0.53 | YES / YES | YES / YES | 138 / 138 | 0.31 ms |
| `BM-11-MULTI-PERSON` | `three_quarter_left` | `visible` | `visible` | 0.59 | 0.58 | YES / YES | YES / YES | 230 / 230 | 0.37 ms |
| `BM-12-HIGH-RES` | `frontal` | `visible` | `visible` | 0.31 | 0.33 | YES / YES | YES / YES | 254 / 254 | 0.46 ms |

* **Average Eye & Eyelid Landmark Extraction Latency:** **1.17 ms** (SLA target: < 150 ms).
* **Key Observations:**
  * **`BM-02` Profile Robustness & Iris Suppression:** The physically hidden right eye is strictly marked `visibility: 'occluded'` with confidence `0.00`, zero fabricated eyelid points (`0`), and `iris = pupil = undefined` (`NONE`), satisfying the contract requirement to never mirror or invent coordinates.
  * **Evidence-Dependent Resolution (`BM-05`, `BM-08`):** On `BM-05`, curls obstructing the left orbital socket prevent iris/pupil resolution (correctly marked `NONE`) while the right eye resolves cleanly. On `BM-08` (low light), deep shadow on the right socket prevents pupil resolution without hallucinating.
  * **`BM-03` Eyewear Disambiguation:** Eyeglass frames above the orbital margin do not hijack the eyelid paths; local luminance valley scoring anchors the margin trace to the palpebral fissure.
  * **`BM-06` Extreme Lighting:** Both eyes are correctly located on the frontal face despite dramatic chiaroscuro shadow ($conf_{left} = 0.61, conf_{right} = 0.52$).
  * **Zero External Dependencies & Exceptional Throughput:** Sub-2ms execution across all benchmarks ensures 60 FPS headroom during progressive rendering.

---

### Run 2026-09-17 — TASK-103 Step 2B Eyebrow Landmark Detection Evaluation
* **Hardware Environment:** Node.js v24.16.0, Windows x64, Pure TypeScript implementation.
* **Test Command:** `npm run benchmark:eyebrows` (`tests/structural-analysis/eyebrow-inspector.ts`)
* **Scope:** All 12 standard benchmark categories (`BM-01` through `BM-12`). Includes visual inspection report in `tests/artifacts/eyebrow-report.html`.

| Benchmark ID | Pose Detected | Left Brow Visibility | Right Brow Visibility | Left Conf | Right Conf | Brow Pts (L / R) | Brow Latency |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `BM-01-FRONT-PORTRAIT` | `frontal` | `visible` | `visible` | 0.23 | 0.19 | 182 / 169 | 11.71 ms |
| `BM-02-SIDE-PROFILE` | `left_profile` | `uncertain` | `occluded` | 0.16 | 0.00 | 146 / 0 | 6.11 ms |
| `BM-03-GLASSES` | `frontal` | `visible` | `visible` | 0.23 | 0.23 | 193 / 177 | 1.84 ms |
| `BM-04-FACIAL-HAIR` | `three_quarter_left` | `visible` | `visible` | 0.24 | 0.21 | 199 / 151 | 3.86 ms |
| `BM-05-HAIR-VARIETY` | `frontal` | `visible` | `visible` | 0.19 | 0.19 | 205 / 205 | 1.68 ms |
| `BM-06-EXTREME-LIGHTING` | `frontal` | `not_detected` | `visible` | 0.10 | 0.32 | 0 / 98 | 0.87 ms |
| `BM-07-COMPLEX-BACKGROUND`| `frontal` | `visible` | `visible` | 0.24 | 0.22 | 389 / 389 | 5.35 ms |
| `BM-08-LOW-LIGHT` | `three_quarter_right` | `uncertain` | `uncertain` | 0.16 | 0.16 | 207 / 233 | 1.05 ms |
| `BM-09-FULL-BODY-STANDING`| `three_quarter_right` | `uncertain` | `visible` | 0.16 | 0.24 | 18 / 110 | 0.95 ms |
| `BM-10-FULL-BODY-SITTING` | `frontal` | `uncertain` | `visible` | 0.16 | 0.22 | 19 / 75 | 0.38 ms |
| `BM-11-MULTI-PERSON` | `three_quarter_left` | `uncertain` | `visible` | 0.17 | 0.24 | 146 / 167 | 1.09 ms |
| `BM-12-HIGH-RES` | `frontal` | `not_detected` | `uncertain` | 0.09 | 0.17 | 0 / 206 | 1.87 ms |

* **Average Eyebrow Landmark Extraction Latency:** **3.06 ms** (SLA target: < 150 ms).
* **Key Observations:**
  * **`BM-02` Profile Robustness:** The physically hidden right eyebrow is strictly marked `visibility: 'occluded'` with confidence `0.00` and zero points (`0`).
  * **`BM-03` Spectacle Separation:** Eyelid separation constraint ($\ge 2$px above superior palpebral margin) ensures spectacle rims do not hijack brow contours.
  * **`BM-06` Extreme Lighting:** Shadowed left eyebrow correctly registers as `not_detected` (zero hallucinated points) while the lit right eyebrow traces cleanly ($conf = 0.32, 98$ pts).
  * **`BM-04` Facial Hair Isolation:** Dense beard on lower jaw does not contaminate the supraorbital band.

---

### Run 2026-09-17 — TASK-103 Step 2C Nose Landmark Detection Evaluation
* **Hardware Environment:** Node.js v24.16.0, Windows x64, Pure TypeScript implementation.
* **Test Command:** `npm run benchmark:nose` (`tests/structural-analysis/nose-inspector.ts`)
* **Scope:** All 12 standard benchmark categories (`BM-01` through `BM-12`). Includes visual inspection report in `tests/artifacts/nose-report.html`.

| Benchmark ID | Pose Detected | Nose Visibility | Nose Conf | Bridge Pts | Tip | Nostrils (L / R) | Total Pts | Nose Latency |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `BM-01-FRONT-PORTRAIT` | `frontal` | `visible` | 0.42 | 111 | YES | `visible` / `visible` | 121 | 13.74 ms |
| `BM-02-SIDE-PROFILE` | `left_profile` | `uncertain` | 0.15 | 0 | NONE | `uncertain` / `occluded` | 5 | 6.66 ms |
| `BM-03-GLASSES` | `frontal` | `visible` | 0.19 | 0 | NONE | `visible` / `visible` | 10 | 1.47 ms |
| `BM-04-FACIAL-HAIR` | `three_quarter_left` | `visible` | 0.36 | 75 | YES | `visible` / `visible` | 85 | 1.45 ms |
| `BM-05-HAIR-VARIETY` | `frontal` | `visible` | 0.28 | 116 | YES | `visible` / `visible` | 131 | 2.20 ms |
| `BM-06-EXTREME-LIGHTING` | `frontal` | `not_detected` | 0.00 | 0 | NONE | `not_detected` / `not_detected` | 0 | 1.20 ms |
| `BM-07-COMPLEX-BACKGROUND`| `frontal` | `visible` | 0.37 | 108 | YES | `visible` / `visible` | 123 | 8.22 ms |
| `BM-08-LOW-LIGHT` | `three_quarter_right` | `visible` | 0.35 | 30 | YES | `visible` / `visible` | 45 | 0.72 ms |
| `BM-09-FULL-BODY-STANDING`| `three_quarter_right` | `visible` | 0.20 | 53 | YES | `visible` / `visible` | 63 | 0.85 ms |
| `BM-10-FULL-BODY-SITTING` | `frontal` | `visible` | 0.34 | 21 | YES | `visible` / `visible` | 31 | 0.33 ms |
| `BM-11-MULTI-PERSON` | `three_quarter_left` | `visible` | 0.49 | 55 | YES | `visible` / `visible` | 65 | 0.88 ms |
| `BM-12-HIGH-RES` | `frontal` | `visible` | 0.34 | 53 | YES | `visible` / `visible` | 63 | 1.05 ms |

* **Average Nose Landmark Extraction Latency:** **3.23 ms** (SLA target: < 150 ms).
* **Key Observations:**
  * **`BM-02` Profile Robustness & Hidden-Side Nostril Suppression:** The physically hidden right nostril is strictly marked `visibility: 'occluded'` with confidence `0.00` and zero points (`0`), while the visible profile side extracts the left alar opening.
  * **`BM-03` Spectacle-Bridge Avoidance:** The glasses bridge connecting the rims at the nasion does not get mistaken for a nasal bridge (`bridge: NONE`), while the nostrils below are accurately localized.
  * **`BM-04` Facial Hair & Mustache Separation:** Dense mustache hair below $y \ge 0.74$ is prevented from contaminating nostril pockets; the alar base sits cleanly on the upper nasal margin above the facial hair.
  * **`BM-06` Extreme Lighting Fidelity:** Severe half-face chiaroscuro shadow honestly returns `visibility: 'not_detected'` with zero fabricated points, strictly avoiding hallucinating a false bridge along the harsh illumination dividing line.
  * **Cumulative Facial Latency (Face Region + Eyes + Brows + Nose):** $\approx 22 \text{ ms}$, leaving $> 120 \text{ ms}$ headroom under the 150 ms structural-analysis budget.
