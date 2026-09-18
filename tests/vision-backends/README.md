# Vision Backend Evaluation (TASK-103.5)

This directory contains experimental evaluation code, adapters, and benchmark tooling designed to objectively assess pretrained computer vision models against the project's canonical pure-TypeScript perception baseline.

---

## 1. Scope & Constraints

* **Strictly Isolated:** Code in this directory is for research, benchmarking, and architectural evaluation only.
* **Zero Production Footprint:** Production packages (`packages/*` and `apps/web`) do NOT depend on anything in this directory.
* **No Large Model Binaries:** No `.task`, `.onnx`, or weight checkpoints are tracked in Git.
* **Deterministic Baseline Preserved:** The handcrafted, zero-dependency structural analysis pipeline remains the authoritative baseline throughout this evaluation.

---

## 2. Directory Contents

* `README.md`: This file.
* `adapter-prototype.ts`: Mapping prototype from MediaPipe Face Landmarker (478-point mesh) and Pose Landmarker (33-point skeleton) to canonical `SubjectModel` (`FacialFeatures`, `BodyFeatures`).
* `benchmark-runner.ts`: Comparative benchmark evaluating the deterministic baseline vs. pretrained model runtimes on the 12 canonical test images (`BM-01` through `BM-12`).

---

## 3. Associated Artifacts

* `tests/artifacts/vision-backend-evaluation.html`: Interactive in-browser visual evaluation test harness and audit report.
* `docs/VISION_BACKEND_EVALUATION.md`: Comprehensive architectural decision report and recommendation.
