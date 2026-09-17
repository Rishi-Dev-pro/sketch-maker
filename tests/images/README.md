# Benchmark Image Dataset

This directory contains the standard 12-category benchmark evaluation dataset for **Sketch Maker**.

The dataset is established to ensure repeatable, regression-free evaluations of the algorithmic pipeline across all development phases (image processing, structural analysis, polyline simplification, stroke sorting, and progressive canvas animation).

---

## Benchmark Image Catalog

| ID | Filename | Category | Resolution | Megapixels | File Size | Primary Evaluation Focus |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **BM-01** | `bm-01-front-portrait.jpg` | Neutral Portrait | 1024 × 1024 | 1.05 MP | ~635 KB | Baseline facial landmark accuracy & symmetry |
| **BM-02** | `bm-02-side-profile.jpg` | Profile | 1024 × 1024 | 1.05 MP | ~577 KB | Profile jawline & nasal curve silhouette |
| **BM-03** | `bm-03-glasses.jpg` | Eyewear Occlusion | 1024 × 1024 | 1.05 MP | ~708 KB | Eye occlusion & spectacle frame vectorization |
| **BM-04** | `bm-04-facial-hair.jpg` | Facial Hair | 1024 × 1024 | 1.05 MP | ~720 KB | Dense beard texture vs. skin boundary |
| **BM-05** | `bm-05-hair-variety.jpg` | Hair Texture | 1024 × 1024 | 1.05 MP | ~723 KB | Afro/coiled curl simplification & stroke budget |
| **BM-06** | `bm-06-extreme-lighting.jpg`| Chiaroscuro / HDR | 1024 × 1024 | 1.05 MP | ~607 KB | Extreme backlight rim & shadow tolerance |
| **BM-07** | `bm-07-complex-background.jpg` | Cluttered Scene | 1024 × 1024 | 1.05 MP | ~922 KB | Foreground segmentation & background clutter rejection |
| **BM-08** | `bm-08-low-light.jpg` | ISO Noise | 1024 × 1024 | 1.05 MP | ~732 KB | Low-light sensor grain suppression |
| **BM-09** | `bm-09-full-body-standing.jpg` | Full Standing Pose | 896 × 1200 | 1.08 MP | ~560 KB | Full-length proportion & foot grounding |
| **BM-10** | `bm-10-full-body-sitting.jpg` | Complex Occlusion | 896 × 1200 | 1.08 MP | ~663 KB | Cross-legged sitting pose with folded limbs |
| **BM-11** | `bm-11-multi-person.jpg` | Multi-Subject | 1200 × 896 | 1.08 MP | ~636 KB | Two-subject instance segmentation & touching silhouettes |
| **BM-12** | `bm-12-high-res.jpg` | 24MP+ Master | 6000 × 4000 | 24.00 MP | ~1.27 MB | Downscaling throughput & memory leak safety |

---

## Manifest File

The full machine-readable schema and metadata for all benchmark images are stored in [`dataset.json`](file:///d:/projects%202.0/main/sketch-maker/tests/images/dataset.json).

Each entry contains:
- `id`: Unique benchmark identifier (e.g. `BM-01-FRONT-PORTRAIT`).
- `filename`: Image asset file name.
- `dimensions`: Width, height, aspect ratio, and megapixel count.
- `sha256`: Cryptographic checksum for deterministic dataset verification.
- `challengeFactors`: Difficult image properties to test.
- `passingCriteria`: Qualitative and quantitative acceptance criteria.

---

## Validation

To validate that all 12 benchmark images exist, are valid JPEG streams with correct dimensions, match their cryptographic checksums, and conform to the dataset manifest, run:

```bash
npm run test:dataset
```

Or execute directly:

```bash
node tests/images/validate.js
```
