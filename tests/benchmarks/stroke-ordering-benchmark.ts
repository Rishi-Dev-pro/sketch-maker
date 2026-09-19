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
  validateOrderedStrokeSequence,
  CompositionPhase
} from '../../packages/stroke-engine/src';

interface DatasetItem {
  id: string;
  filename: string;
  category: string;
}

interface DatasetManifest {
  categories: DatasetItem[];
}

export interface OrderingBenchmarkResult {
  id: string;
  category: string;
  subjectCount: number;
  orderingLatencyMs: number;
  totalCandidates: number;
  drawableStrokes: number;
  filteredStrokes: number;
  phaseCounts: Record<CompositionPhase, number>;
  dependencyCount: number;
  maxDependencyDepth: number;
  sequenceValid: boolean;
  profileOcclusionPass: boolean;
  multiPersonSeparated: boolean;
}

async function runStrokeOrderingBenchmark() {
  console.log('================================================================================');
  console.log('  TASK-106: Stroke Ordering & Composition — 12-Category Benchmark');
  console.log('================================================================================\n');

  const datasetPath = path.resolve(process.cwd(), 'tests/images/dataset.json');
  const manifest: DatasetManifest = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));

  const provider = new DeterministicVisionProvider();
  const results: OrderingBenchmarkResult[] = [];

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

    // 4. Benchmark Pure Stroke Ordering
    const tStart = performance.now();
    const sequence: OrderedStrokeSequence = orderStrokeCandidates(strokeSet);
    const tEnd = performance.now();
    const orderingLatency = tEnd - tStart;

    // Validate sequence integrity
    const validation = validateOrderedStrokeSequence(sequence);

    // Verify BM-02 profile occlusion:
    // 0 occluded strokes in drawable sequence!
    let profileOcclusionPass = true;
    if (item.id.includes('BM-02')) {
      const occludedInDrawable = sequence.strokes.filter(
        (s) => s.stroke.visibility === 'occluded' || s.stroke.filteredReason === 'occluded' ||
               s.stroke.sourcePathId.includes('right_eye') || s.stroke.sourcePathId.includes('right_ear')
      );
      profileOcclusionPass = occludedInDrawable.length === 0;
    }

    // Verify BM-11 multi-person separation:
    // Preserves distinct subjectIds
    let multiPersonSeparated = true;
    if (item.id.includes('BM-11')) {
      const subjectIds = new Set(sequence.strokes.map((s) => s.stroke.subjectId).filter(Boolean));
      multiPersonSeparated = subjectIds.size === visionResult.subjects.length;
    }

    const rec: OrderingBenchmarkResult = {
      id: item.id,
      category: item.category,
      subjectCount: visionResult.subjects.length,
      orderingLatencyMs: Math.round(orderingLatency * 100) / 100,
      totalCandidates: sequence.totalStrokes,
      drawableStrokes: sequence.drawableStrokes,
      filteredStrokes: sequence.filteredStrokes.length,
      phaseCounts: sequence.metrics.phaseCounts,
      dependencyCount: sequence.metrics.dependencyCount,
      maxDependencyDepth: sequence.metrics.maxDependencyDepth,
      sequenceValid: validation.isValid,
      profileOcclusionPass,
      multiPersonSeparated
    };

    results.push(rec);

    const pF = rec.phaseCounts.foundation || 0;
    const pP = rec.phaseCounts.primary_structure || 0;
    const pE = rec.phaseCounts.expressive_features || 0;
    const pS = rec.phaseCounts.secondary_anatomy || 0;
    const pR = rec.phaseCounts.refinement || 0;
    const pT = rec.phaseCounts.texture_accent || 0;

    console.log(
      `[${rec.id.padEnd(26)}] Latency: ${rec.orderingLatencyMs.toFixed(2).padStart(6)} ms | Ordered: ${rec.drawableStrokes.toString().padStart(3)} | Phases (F:${pF} P:${pP} E:${pE} S:${pS} R:${pR} T:${pT}) | DepDepth: ${rec.maxDependencyDepth} | Valid: ${rec.sequenceValid ? 'YES' : 'NO'}`
    );
  }

  const finalHeap = process.memoryUsage().heapUsed;
  const heapDeltaMB = Math.round(((finalHeap - initialHeap) / (1024 * 1024)) * 100) / 100;
  const totalHeapMB = Math.round((finalHeap / (1024 * 1024)) * 100) / 100;

  const avgLatency = results.reduce((acc, r) => acc + r.orderingLatencyMs, 0) / results.length;
  const avgOrdered = results.reduce((acc, r) => acc + r.drawableStrokes, 0) / results.length;
  const avgFiltered = results.reduce((acc, r) => acc + r.filteredStrokes, 0) / results.length;
  const avgDeps = results.reduce((acc, r) => acc + r.dependencyCount, 0) / results.length;
  const allValid = results.every((r) => r.sequenceValid);
  const bm02Pass = results.find((r) => r.id.includes('BM-02'))?.profileOcclusionPass;
  const bm11Pass = results.find((r) => r.id.includes('BM-11'))?.multiPersonSeparated;

  console.log('\n================================================================================');
  console.log('  BENCHMARK SUMMARY');
  console.log('================================================================================');
  console.log(`Average Ordering Latency:     ${avgLatency.toFixed(2)} ms (SLA budget: < 10 ms)`);
  console.log(`Average Ordered Strokes:      ${avgOrdered.toFixed(1)}`);
  console.log(`Average Filtered Strokes:     ${avgFiltered.toFixed(1)}`);
  console.log(`Average Dependency Edges:     ${avgDeps.toFixed(1)}`);
  console.log(`Sequence Integrity Passed:    ${allValid ? 'PASS (100% Valid)' : 'FAIL'}`);
  console.log(`BM-02 Profile Occlusion:      ${bm02Pass ? 'PASS (0 occluded drawable strokes)' : 'FAIL'}`);
  console.log(`BM-11 Multi-Person Isolation:  ${bm11Pass ? 'PASS (Independent subjectId preservation)' : 'FAIL'}`);
  console.log(`Peak Heap Memory Delta:       ${heapDeltaMB} MB (Total Heap: ${totalHeapMB} MB)`);
  console.log('================================================================================\n');

  return results;
}

runStrokeOrderingBenchmark().catch((err) => {
  console.error('Benchmark failed with error:', err);
  process.exit(1);
});
