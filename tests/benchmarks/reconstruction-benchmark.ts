import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import jpeg from 'jpeg-js';
import { preprocessPixelBuffer, PixelBuffer } from '../../packages/image-processing/src';
import {
  DeterministicVisionProvider,
  generateFeatureCoverageReport,
  reconstructSubjectFeatures,
} from '../../packages/structural-analysis/src';
import {
  extractAllVectorGeometry,
  generateStrokeCandidates,
  orderStrokeCandidates,
  createStrokeTimeline,
  createRenderState,
} from '../../packages/stroke-engine/src';
import { resolveStyledRenderState } from '../../packages/style-engine/src';

interface DatasetItem {
  id: string;
  filename: string;
  category: string;
}

interface DatasetManifest {
  categories: DatasetItem[];
}

export interface ReconstructionBenchmarkRow {
  id: string;
  category: string;
  reconstructedPaths: number;
  vectorPaths: number;
  strokeCandidates: number;
  drawableStrokes: number;
  facialCoveragePct: number;
  overallCoveragePct: number;
  meaningfulRatioPct: number;
  latencyMs: number;
  profileOccludedPass: boolean;
  multiPersonPass: boolean;
}

export async function runReconstructionBenchmark(): Promise<ReconstructionBenchmarkRow[]> {
  console.log('================================================================================');
  console.log('  TASK-110: Artistic Reconstruction Fidelity Recovery — 12-Category Benchmark');
  console.log('================================================================================\n');

  const datasetPath = path.resolve(process.cwd(), 'tests/images/dataset.json');
  const manifest: DatasetManifest = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));

  const provider = new DeterministicVisionProvider();
  const rows: ReconstructionBenchmarkRow[] = [];

  for (const item of manifest.categories) {
    const imagePath = path.resolve(process.cwd(), 'tests/images', item.filename);
    const rawBuffer = fs.readFileSync(imagePath);
    const decoded = jpeg.decode(rawBuffer, { useTArray: true });

    const pixelBuffer: PixelBuffer = {
      width: decoded.width,
      height: decoded.height,
      data: decoded.data,
    };

    const normalized = preprocessPixelBuffer(pixelBuffer, { maxDimension: 1024 });

    const tStart = performance.now();

    // 1. Perception & Structural Analysis (Deterministic Provider)
    const visionResult = await provider.analyze({
      image: normalized,
      sourceDimensions: { width: decoded.width, height: decoded.height },
      options: { mode: 'deterministic' },
    });

    const primarySubject = visionResult.primarySubject;
    if (!primarySubject) {
      console.warn(`[WARN] No subject detected for ${item.id}`);
      continue;
    }

    // Ensure reconstruction is attached
    if (!primarySubject.reconstruction) {
      primarySubject.reconstruction = reconstructSubjectFeatures(primarySubject);
    }

    // 2. Vector Extraction (TASK-104 + TASK-110)
    const geometry = extractAllVectorGeometry(visionResult.subjects);

    // 3. Stroke Candidate Generation (TASK-105 + TASK-110)
    const candidates = generateStrokeCandidates(geometry);

    // 4. Stroke Ordering (TASK-106)
    const sequence = orderStrokeCandidates(candidates);

    // 5. Timeline Scheduling (TASK-107)
    const timeline = createStrokeTimeline(sequence, { targetDurationMs: 15000 });

    // 6. Progressive Render State (TASK-108)
    const renderState = createRenderState(timeline, timeline.totalDurationMs);

    // 7. Style Engine (TASK-109)
    const styled = resolveStyledRenderState(renderState, { preset: 'procedural_black' });

    const tEnd = performance.now();
    const latencyMs = Number((tEnd - tStart).toFixed(2));

    // 8. 19-Feature Coverage Diagnostics (TASK-110)
    const coverage = generateFeatureCoverageReport(
      primarySubject,
      primarySubject.reconstruction,
      geometry.paths,
      candidates.candidates,
      renderState.strokes
    );

    // Specific structural checks
    let profileOccludedPass = true;
    if (item.id === 'bm-02') {
      // In BM-02 left profile, right eye, right eyebrow, right ear must not be fabricated
      const feats = coverage.features;
      profileOccludedPass = feats.rightEye.notes?.includes('Occluded') === true;
    }

    let multiPersonPass = true;
    if (item.id === 'bm-11') {
      multiPersonPass = visionResult.subjects.length >= 2;
    }

    const row: ReconstructionBenchmarkRow = {
      id: item.id.toUpperCase(),
      category: item.category,
      reconstructedPaths: primarySubject.reconstruction?.allReconstructedPaths.length ?? 0,
      vectorPaths: geometry.metrics.totalPaths,
      strokeCandidates: candidates.metrics.totalCandidates,
      drawableStrokes: candidates.metrics.drawableCandidates,
      facialCoveragePct: Math.round(coverage.metrics.facialCoverage * 100),
      overallCoveragePct: Math.round(coverage.metrics.overallStructuralCoverage * 100),
      meaningfulRatioPct: Math.round(coverage.metrics.meaningfulStrokeRatio * 100),
      latencyMs,
      profileOccludedPass,
      multiPersonPass,
    };

    rows.push(row);
  }

  // Print Summary Table
  console.log(
    'ID    | Category            | Recon | Vectors | Strokes (Drw) | Face Cov | Total Cov | Meaningful | Latency  | Checks'
  );
  console.log(
    '------|---------------------|-------|---------|---------------|----------|-----------|------------|----------|-------'
  );

  for (const r of rows) {
    const checks = (r.profileOccludedPass && r.multiPersonPass) ? 'PASS' : 'FAIL';
    console.log(
      `${r.id.padEnd(5)} | ` +
      `${r.category.padEnd(19)} | ` +
      `${String(r.reconstructedPaths).padStart(5)} | ` +
      `${String(r.vectorPaths).padStart(7)} | ` +
      `${(String(r.drawableStrokes) + '/' + String(r.strokeCandidates)).padStart(13)} | ` +
      `${(String(r.facialCoveragePct) + '%').padStart(8)} | ` +
      `${(String(r.overallCoveragePct) + '%').padStart(9)} | ` +
      `${(String(r.meaningfulRatioPct) + '%').padStart(10)} | ` +
      `${(r.latencyMs.toFixed(1) + 'ms').padStart(8)} | ` +
      `${checks}`
    );
  }

  console.log('--------------------------------------------------------------------------------\n');

  // Compute aggregate averages
  const avgFaceCov = Math.round(rows.reduce((acc, r) => acc + r.facialCoveragePct, 0) / rows.length);
  const avgTotalCov = Math.round(rows.reduce((acc, r) => acc + r.overallCoveragePct, 0) / rows.length);
  const avgMeaningful = Math.round(rows.reduce((acc, r) => acc + r.meaningfulRatioPct, 0) / rows.length);
  const avgLatency = (rows.reduce((acc, r) => acc + r.latencyMs, 0) / rows.length).toFixed(1);

  console.log(`Aggregate 12-Benchmark Results:`);
  console.log(`  - Average Facial Feature Coverage:  ${avgFaceCov}%`);
  console.log(`  - Average Overall Structural Cov:   ${avgTotalCov}%`);
  console.log(`  - Meaningful Feature Stroke Ratio:  ${avgMeaningful}%`);
  console.log(`  - End-to-End Pipeline Latency:      ${avgLatency} ms`);
  console.log('================================================================================\n');

  return rows;
}

// Direct execution support
if (process.argv[1]?.includes('reconstruction-benchmark')) {
  runReconstructionBenchmark().catch((err) => {
    console.error('Reconstruction benchmark failed:', err);
    process.exit(1);
  });
}
