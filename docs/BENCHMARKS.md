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

To guarantee that algorithmic improvements do not cause regressions on difficult images, every major engine release must be evaluated against standard test images stored in `tests/images/`:

1. `BM-01-FRONT-PORTRAIT`: Clean front-facing portrait, neutral studio lighting.
2. `BM-02-SIDE-PROFILE`: Sharp 90-degree profile; tests jawline and nose silhouette fidelity.
3. `BM-03-GLASSES`: Subject wearing wireframe or thick-rimmed glasses; tests eye occlusion handling.
4. `BM-04-FACIAL-HAIR`: Dense beard/mustache; tests hair vs. skin boundary separation.
5. `BM-05-HAIR-VARIETY`: Fine curly/afro/straight long hair; tests high-frequency detail noise handling.
6. `BM-06-EXTREME-LIGHTING`: High dynamic range, deep shadows, bright backlit rim lighting.
7. `BM-07-COMPLEX-BACKGROUND`: Busy foliage, urban street scene; tests background suppression.
8. `BM-08-LOW-LIGHT`: Noisy low-light selfie with ISO grain.
9. `BM-09-FULL-BODY-STANDING`: Full figure standing; tests head-to-toe pose and limb proportion.
10. `BM-10-FULL-BODY-SITTING`: Complex occlusion with folded arms/legs.
11. `BM-11-MULTI-PERSON`: Two or more subjects; tests multi-subject segmentation.
12. `BM-12-HIGH-RES`: 24MP+ photo; tests memory limits and downscaling pipeline.

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
