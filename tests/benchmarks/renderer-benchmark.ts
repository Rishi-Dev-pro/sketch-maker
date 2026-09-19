import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import jpeg from 'jpeg-js';
import { preprocessPixelBuffer, PixelBuffer } from '../../packages/image-processing/src';
import { DeterministicVisionProvider } from '../../packages/structural-analysis/src';
import {
  extractAllVectorGeometry,
  generateStrokeCandidates,
  orderStrokeCandidates,
  createStrokeTimeline,
  createRenderState,
  validateRenderState,
  getTimelineState,
  getPartialStrokeGeometry
} from '../../packages/stroke-engine/src';

interface DatasetItem {
  id: string;
  filename: string;
  category: string;
}

interface DatasetManifest {
  categories: DatasetItem[];
}

export interface RendererBenchmarkResult {
  id: string;
  category: string;
  totalStrokes: number;
  activeStrokesAvg: number;
  completedStrokesMid: number;
  renderStateLatencyMs: number;
  queryLatencyUs: number;
  partialGeoLatencyUs: number;
  estimatedFps: number;
  integrityValid: boolean;
  profileOcclusionPass: boolean;
  multiPersonSeparated: boolean;
}

async function runRendererBenchmark() {
  console.log('================================================================================');
  console.log('  TASK-108: Procedural Stroke Renderer & Partial Geometry — 12-Category Benchmark');
  console.log('================================================================================\n');

  const datasetPath = path.resolve(process.cwd(), 'tests/images/dataset.json');
  const manifest: DatasetManifest = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));

  const provider = new DeterministicVisionProvider();
  const results: RendererBenchmarkResult[] = [];

  const initialHeap = process.memoryUsage().heapUsed;

  for (const item of manifest.categories) {
    const imagePath = path.resolve(process.cwd(), 'tests/images', item.filename);
    const rawBuffer = fs.readFileSync(imagePath);
    const decoded = jpeg.decode(rawBuffer, { useTArray: true });

    const pixelBuffer: PixelBuffer = {
      data: decoded.data,
      width: decoded.width,
      height: decoded.height
    };

    const preprocessed = preprocessPixelBuffer(pixelBuffer, { maxDimension: 1024 });

    // 1. Perception
    const visionResult = await provider.analyze({
      image: preprocessed,
      sourceDimensions: { width: decoded.width, height: decoded.height }
    });

    // 2. Vector Geometry (TASK-104)
    const vectorGeom = extractAllVectorGeometry(visionResult.subjects);

    // 3. Stroke Candidates (TASK-105)
    const candidateSet = generateStrokeCandidates(vectorGeom);

    // 4. Stroke Ordering (TASK-106)
    const orderedSequence = orderStrokeCandidates(candidateSet);

    // 5. Stroke Timeline (TASK-107)
    const timeline = createStrokeTimeline(orderedSequence, { targetDurationMs: 15000 });

    // 6. Benchmark TASK-108 Render State & Partial Geometry
    const totalDuration = timeline.totalDurationMs;
    const testTimestamps = [
      0,
      totalDuration * 0.25,
      totalDuration * 0.50,
      totalDuration * 0.75,
      totalDuration * 1.00
    ];

    let totalRenderStateTimeMs = 0;
    let midActiveCount = 0;
    let midCompletedCount = 0;
    let allValid = true;

    // Measure render state generation across test frames
    const runsPerTimestamp = 5;
    for (const tMs of testTimestamps) {
      for (let r = 0; r < runsPerTimestamp; r++) {
        const t0 = performance.now();
        const renderState = createRenderState(timeline, tMs);
        const t1 = performance.now();
        totalRenderStateTimeMs += (t1 - t0);

        if (tMs === totalDuration * 0.50 && r === 0) {
          midActiveCount = renderState.activeCount;
          midCompletedCount = renderState.completedCount;
        }

        const val = validateRenderState(renderState, timeline);
        if (!val.valid) {
          allValid = false;
        }
      }
    }

    const avgRenderStateLatencyMs = totalRenderStateTimeMs / (testTimestamps.length * runsPerTimestamp);

    // Isolated Micro-benchmark: Timeline Query Latency (µs)
    const queryRuns = 100;
    const q0 = performance.now();
    for (let q = 0; q < queryRuns; q++) {
      getTimelineState(timeline, (q / queryRuns) * totalDuration);
    }
    const q1 = performance.now();
    const queryLatencyUs = ((q1 - q0) / queryRuns) * 1000;

    // Isolated Micro-benchmark: Partial Geometry Extraction Latency (µs)
    let partialGeoTimeUs = 0;
    if (timeline.strokes.length > 0) {
      const sampleCandidate = timeline.strokes[0].stroke.stroke;
      const geoRuns = 200;
      const g0 = performance.now();
      for (let g = 0; g < geoRuns; g++) {
        getPartialStrokeGeometry(sampleCandidate, (g % 100) / 100);
      }
      const g1 = performance.now();
      partialGeoTimeUs = ((g1 - g0) / geoRuns) * 1000;
    }

    // Profile Occlusion Check (BM-02)
    let profileOcclusionPass = true;
    if (item.id.includes('BM-02')) {
      const fullRenderState = createRenderState(timeline, totalDuration);
      const occludedInRender = fullRenderState.strokes.filter(
        (s) => s.strokeId.includes('right_eye') ||
               s.strokeId.includes('right_ear')
      );
      profileOcclusionPass = occludedInRender.length === 0;
    }

    // Multi-Person Subject Check (BM-11)
    let multiPersonSeparated = true;
    if (item.id.includes('BM-11')) {
      const fullRenderState = createRenderState(timeline, totalDuration);
      const subjectIds = new Set(fullRenderState.strokes.map(s => s.subjectId).filter(Boolean));
      multiPersonSeparated = subjectIds.size === visionResult.subjects.length;
    }

    // Estimated render FPS based on render-state compilation overhead
    const estimatedFps = Math.min(1000, Math.round(1000 / Math.max(0.1, avgRenderStateLatencyMs)));

    results.push({
      id: item.id,
      category: item.category,
      totalStrokes: timeline.strokes.length,
      activeStrokesAvg: midActiveCount,
      completedStrokesMid: midCompletedCount,
      renderStateLatencyMs: avgRenderStateLatencyMs,
      queryLatencyUs,
      partialGeoLatencyUs: partialGeoTimeUs,
      estimatedFps,
      integrityValid: allValid,
      profileOcclusionPass,
      multiPersonSeparated
    });

    console.log(
      `[${item.id.padEnd(25)}] ` +
      `RenderState: ${avgRenderStateLatencyMs.toFixed(2).padStart(5)} ms | ` +
      `Strokes: ${timeline.strokes.length.toString().padStart(2)} | ` +
      `Active (mid): ${midActiveCount.toString().padStart(2)} | ` +
      `Completed (mid): ${midCompletedCount.toString().padStart(2)} | ` +
      `Query: ${queryLatencyUs.toFixed(0).padStart(3)}µs | ` +
      `PartialGeo: ${partialGeoTimeUs.toFixed(1).padStart(4)}µs | ` +
      `Est. FPS: ${estimatedFps.toString().padStart(4)} | ` +
      `Valid: ${allValid ? 'YES' : 'NO'}`
    );
  }

  const finalHeap = process.memoryUsage().heapUsed;
  const heapDeltaMb = (finalHeap - initialHeap) / (1024 * 1024);
  const totalHeapMb = finalHeap / (1024 * 1024);

  // Summary Metrics
  const avgLatency = results.reduce((acc, r) => acc + r.renderStateLatencyMs, 0) / results.length;
  const avgStrokes = results.reduce((acc, r) => acc + r.totalStrokes, 0) / results.length;
  const avgActive = results.reduce((acc, r) => acc + r.activeStrokesAvg, 0) / results.length;
  const avgQueryUs = results.reduce((acc, r) => acc + r.queryLatencyUs, 0) / results.length;
  const avgGeoUs = results.reduce((acc, r) => acc + r.partialGeoLatencyUs, 0) / results.length;
  const avgFps = results.reduce((acc, r) => acc + r.estimatedFps, 0) / results.length;
  const allIntegrityPass = results.every(r => r.integrityValid);
  const bm02Pass = results.find(r => r.id.includes('BM-02'))?.profileOcclusionPass ?? false;
  const bm11Pass = results.find(r => r.id.includes('BM-11'))?.multiPersonSeparated ?? false;

  console.log('\n================================================================================');
  console.log('  BENCHMARK SUMMARY');
  console.log('================================================================================');
  console.log(`Average RenderState Latency:   ${avgLatency.toFixed(2)} ms (SLA budget: < 2.0 ms)`);
  console.log(`Average Total Strokes:         ${avgStrokes.toFixed(1)}`);
  console.log(`Average Midpoint Active:       ${avgActive.toFixed(1)} active strokes`);
  console.log(`Average Query Latency:         ${avgQueryUs.toFixed(1)} µs`);
  console.log(`Average Partial Geo Latency:   ${avgGeoUs.toFixed(1)} µs`);
  console.log(`Average Estimated Comp. FPS:   ${Math.round(avgFps)} FPS`);
  console.log(`RenderState Integrity:         ${allIntegrityPass ? 'PASS (100% Valid)' : 'FAIL'}`);
  console.log(`BM-02 Profile Occlusion:       ${bm02Pass ? 'PASS (0 occluded render strokes)' : 'FAIL'}`);
  console.log(`BM-11 Multi-Person Isolation:  ${bm11Pass ? 'PASS (Subject separation maintained)' : 'FAIL'}`);
  console.log(`Peak Heap Memory Delta:        ${heapDeltaMb.toFixed(2)} MB (Total Heap: ${totalHeapMb.toFixed(2)} MB)`);
  console.log('================================================================================\n');
}

runRendererBenchmark().catch(err => {
  console.error('Renderer Benchmark failed:', err);
  process.exit(1);
});
