import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import jpeg from 'jpeg-js';
import { preprocessPixelBuffer, PixelBuffer } from '../../packages/image-processing/src';
import { DeterministicVisionProvider } from '../../packages/structural-analysis/src';
import {
  extractAllVectorGeometry,
  VectorGeometry,
  generateStrokeCandidates,
  StrokeCandidateSet,
  orderStrokeCandidates,
  OrderedStrokeSequence,
  createStrokeTimeline,
  StrokeTimeline,
  validateStrokeTimeline,
  getTimelineState
} from '../../packages/stroke-engine/src';

interface DatasetItem {
  id: string;
  filename: string;
  category: string;
}

interface DatasetManifest {
  categories: DatasetItem[];
}

export interface TimelineBenchmarkResult {
  id: string;
  category: string;
  subjectCount: number;
  timelineLatencyMs: number;
  totalStrokes: number;
  naturalDurationMs: number;
  finalDurationMs: number;
  avgStrokeDurationMs: number;
  maxConcurrency: number;
  avgOverlapMs: number;
  queryLatencyUs: number;
  timelineValid: boolean;
  profileOcclusionPass: boolean;
  multiPersonSeparated: boolean;
}

async function runStrokeTimelineBenchmark() {
  console.log('================================================================================');
  console.log('  TASK-107: Progressive Stroke Timeline & Scheduling — 12-Category Benchmark');
  console.log('================================================================================\n');

  const datasetPath = path.resolve(process.cwd(), 'tests/images/dataset.json');
  const manifest: DatasetManifest = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));

  const provider = new DeterministicVisionProvider();
  const results: TimelineBenchmarkResult[] = [];

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

    // 2. Vector Geometry
    const vectorGeom: VectorGeometry = extractAllVectorGeometry(visionResult.subjects);

    // 3. Stroke Candidates
    const strokeSet: StrokeCandidateSet = generateStrokeCandidates(vectorGeom);

    // 4. Stroke Ordering
    const sequence: OrderedStrokeSequence = orderStrokeCandidates(strokeSet);

    // 5. Benchmark Pure Timeline Scheduling
    const tStart = performance.now();
    const timeline: StrokeTimeline = createStrokeTimeline(sequence, {
      targetDurationMs: 15000 // Standard 15-second progressive drawing animation
    });
    const tEnd = performance.now();
    const timelineLatency = tEnd - tStart;

    // Validate timeline integrity
    const validation = validateStrokeTimeline(timeline);

    // Benchmark Timeline Query Performance (getTimelineState at 0%, 25%, 50%, 75%, 100%)
    const qStart = performance.now();
    for (let p = 0; p <= 1.0; p += 0.25) {
      getTimelineState(timeline, timeline.totalDurationMs * p);
    }
    const qEnd = performance.now();
    const queryLatencyUs = Math.round(((qEnd - qStart) / 5) * 1000); // Microseconds per query

    // Verify BM-02 profile occlusion:
    // 0 occluded strokes in timeline!
    let profileOcclusionPass = true;
    if (item.id.includes('BM-02')) {
      const occludedInTimeline = timeline.strokes.filter(
        (s) => s.stroke.stroke.visibility === 'occluded' ||
               s.stroke.stroke.filteredReason === 'occluded' ||
               s.stroke.stroke.sourcePathId.includes('right_eye') ||
               s.stroke.stroke.sourcePathId.includes('right_ear')
      );
      profileOcclusionPass = occludedInTimeline.length === 0;
    }

    // Verify BM-11 multi-person separation:
    // Preserves distinct subjectIds
    let multiPersonSeparated = true;
    if (item.id.includes('BM-11')) {
      const subjectIds = new Set(timeline.strokes.map((s) => s.stroke.stroke.subjectId).filter(Boolean));
      multiPersonSeparated = subjectIds.size === visionResult.subjects.length;
    }

    const rec: TimelineBenchmarkResult = {
      id: item.id,
      category: item.category,
      subjectCount: visionResult.subjects.length,
      timelineLatencyMs: Math.round(timelineLatency * 100) / 100,
      totalStrokes: timeline.strokes.length,
      naturalDurationMs: timeline.naturalDurationMs,
      finalDurationMs: timeline.totalDurationMs,
      avgStrokeDurationMs: timeline.metrics.averageStrokeDurationMs,
      maxConcurrency: timeline.metrics.maxConcurrency,
      avgOverlapMs: timeline.metrics.averageOverlapMs,
      queryLatencyUs,
      timelineValid: validation.valid,
      profileOcclusionPass,
      multiPersonSeparated
    };

    results.push(rec);

    console.log(
      `[${rec.id.padEnd(26)}] Latency: ${rec.timelineLatencyMs.toFixed(2).padStart(5)} ms | Strokes: ${rec.totalStrokes.toString().padStart(2)} | Natural: ${(rec.naturalDurationMs / 1000).toFixed(1)}s -> Final: ${(rec.finalDurationMs / 1000).toFixed(1)}s | AvgStroke: ${rec.avgStrokeDurationMs}ms | Concurrency: ${rec.maxConcurrency} | Query: ${rec.queryLatencyUs}µs | Valid: ${rec.timelineValid ? 'YES' : 'NO'}`
    );
  }

  const finalHeap = process.memoryUsage().heapUsed;
  const heapDeltaMB = Math.round(((finalHeap - initialHeap) / (1024 * 1024)) * 100) / 100;
  const totalHeapMB = Math.round((finalHeap / (1024 * 1024)) * 100) / 100;

  const avgLatency = results.reduce((acc, r) => acc + r.timelineLatencyMs, 0) / results.length;
  const avgStrokes = results.reduce((acc, r) => acc + r.totalStrokes, 0) / results.length;
  const avgNatural = results.reduce((acc, r) => acc + r.naturalDurationMs, 0) / results.length;
  const avgFinal = results.reduce((acc, r) => acc + r.finalDurationMs, 0) / results.length;
  const avgStrokeDur = results.reduce((acc, r) => acc + r.avgStrokeDurationMs, 0) / results.length;
  const avgConcurrency = results.reduce((acc, r) => acc + r.maxConcurrency, 0) / results.length;
  const avgQuery = results.reduce((acc, r) => acc + r.queryLatencyUs, 0) / results.length;
  const allValid = results.every((r) => r.timelineValid);
  const bm02Pass = results.find((r) => r.id.includes('BM-02'))?.profileOcclusionPass;
  const bm11Pass = results.find((r) => r.id.includes('BM-11'))?.multiPersonSeparated;

  console.log('\n================================================================================');
  console.log('  BENCHMARK SUMMARY');
  console.log('================================================================================');
  console.log(`Average Timeline Latency:    ${avgLatency.toFixed(2)} ms (SLA budget: < 10 ms)`);
  console.log(`Average Total Strokes:       ${avgStrokes.toFixed(1)}`);
  console.log(`Average Natural Duration:    ${(avgNatural / 1000).toFixed(2)} s`);
  console.log(`Average Final Duration:      ${(avgFinal / 1000).toFixed(2)} s (Target: 15.00 s)`);
  console.log(`Average Stroke Duration:     ${avgStrokeDur.toFixed(1)} ms`);
  console.log(`Average Max Concurrency:     ${avgConcurrency.toFixed(1)} simultaneous strokes`);
  console.log(`Average Query Latency:       ${avgQuery.toFixed(1)} µs (O(N) state evaluation)`);
  console.log(`Timeline Integrity Passed:   ${allValid ? 'PASS (100% Valid)' : 'FAIL'}`);
  console.log(`BM-02 Profile Occlusion:     ${bm02Pass ? 'PASS (0 occluded timeline strokes)' : 'FAIL'}`);
  console.log(`BM-11 Multi-Person Isolation: ${bm11Pass ? 'PASS (Independent subjectId preservation)' : 'FAIL'}`);
  console.log(`Peak Heap Memory Delta:      ${heapDeltaMB} MB (Total Heap: ${totalHeapMB} MB)`);
  console.log('================================================================================\n');

  return results;
}

runStrokeTimelineBenchmark().catch((err) => {
  console.error('Benchmark failed with error:', err);
  process.exit(1);
});
