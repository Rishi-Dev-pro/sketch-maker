# BENCHMARKS.md

## Performance & Quality Benchmarks

This document tracks quantitative performance benchmarks, memory profiles, and qualitative evaluation metrics across development iterations. 

> **Golden Rule:** *"Always distinguish 'feels faster' from 'measured faster'. Benchmark before and after optimizations."*

---

## 1. Key Performance Targets (SLA)

| Metric | Target (Balanced Profile) | Ultra Profile Target | Measured (Current) | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Analysis Latency** (Photo → `SubjectModel`) | < 1,500 ms | < 3,500 ms | Pending Phase 1 | NOT MEASURED |
| **Stroke Generation** (`SubjectModel` → `StrokeModel`) | < 500 ms | < 1,200 ms | Pending Phase 1 | NOT MEASURED |
| **Style Switching Latency** (Using Cached Strokes) | < 80 ms | < 150 ms | Pending Phase 6 | NOT MEASURED |
| **Rendering FPS** (Progressive Animation Loop) | 60 FPS (Stable) | ≥ 55 FPS | Pending Phase 3 | NOT MEASURED |
| **Peak Browser RAM** | < 150 MB | < 350 MB | Pending Phase 1 | NOT MEASURED |
| **Initial Bundle Size (Web Client)** | < 350 KB (gzipped) | N/A | Pending Phase 4 | NOT MEASURED |
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

*(Historical runs will be recorded here with hardware specs, commit hashes, latency numbers, and quality scores).*
