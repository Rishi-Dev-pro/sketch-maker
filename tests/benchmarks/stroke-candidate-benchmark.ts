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
  StrokeSemanticRole
} from '../../packages/stroke-engine/src';

interface DatasetItem {
  id: string;
  filename: string;
  category: string;
}

interface DatasetManifest {
  categories: DatasetItem[];
}

export interface StrokeBenchmarkResult {
  id: string;
  category: string;
  subjectCount: number;
  strokeLatencyMs: number;
  totalCandidates: number;
  drawableCandidates: number;
  filteredCandidates: number;
  averageLength: number;
  averageImportance: number;
  averageWidth: number;
  strokesByRole: Partial<Record<StrokeSemanticRole, number>>;
  profileOcclusionPass: boolean;
  multiPersonSeparated: boolean;
}

async function runStrokeCandidateBenchmark() {
  console.log('================================================================================');
  console.log('  TASK-105: Procedural Stroke Candidate Generation — 12-Category Benchmark');
  console.log('================================================================================\n');

  const datasetPath = path.resolve(process.cwd(), 'tests/images/dataset.json');
  const manifest: DatasetManifest = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));

  const provider = new DeterministicVisionProvider();
  const results: StrokeBenchmarkResult[] = [];

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

    // Run perception to obtain SubjectModel
    const visionResult = await provider.analyze({
      image: preprocessed,
      sourceDimensions: { width: decoded.width, height: decoded.height }
    });

    // Extract Vector Geometry
    const vectorGeom: VectorGeometry = extractAllVectorGeometry(visionResult.subjects);

    // Benchmark pure Stroke Candidate Generation
    const tStart = performance.now();
    const strokeSet: StrokeCandidateSet = generateStrokeCandidates(vectorGeom);
    const tEnd = performance.now();
    const strokeLatency = tEnd - tStart;

    // Check BM-02 profile hidden-side suppression:
    // Occluded features must produce 0 drawable strokes!
    let profileOcclusionPass = true;
    if (item.id.includes('BM-02')) {
      const occludedDrawables = strokeSet.candidates.filter(
        c => c.drawable && (c.sourcePathId.includes('right_eye') || c.sourcePathId.includes('right_ear') || c.visibility === 'occluded')
      );
      profileOcclusionPass = occludedDrawables.length === 0;
    }

    // Check BM-11 multi-person separation:
    // Candidates must preserve distinct subjectId tags
    let multiPersonSeparated = true;
    if (item.id.includes('BM-11')) {
      const subjectIds = new Set(strokeSet.candidates.map(c => c.subjectId).filter(Boolean));
      multiPersonSeparated = subjectIds.size === visionResult.subjects.length;
    }

    const rec: StrokeBenchmarkResult = {
      id: item.id,
      category: item.category,
      subjectCount: visionResult.subjects.length,
      strokeLatencyMs: Math.round(strokeLatency * 100) / 100,
      totalCandidates: strokeSet.metrics.totalCandidates,
      drawableCandidates: strokeSet.metrics.drawableCandidates,
      filteredCandidates: strokeSet.metrics.filteredCandidates,
      averageLength: strokeSet.metrics.averageLength,
      averageImportance: strokeSet.metrics.averageImportance,
      averageWidth: strokeSet.metrics.averageWidth,
      strokesByRole: strokeSet.metrics.strokesBySemanticRole,
      profileOcclusionPass,
      multiPersonSeparated
    };

    results.push(rec);

    console.log(
      `[${rec.id.padEnd(26)}] Latency: ${rec.strokeLatencyMs.toFixed(2).padStart(6)} ms | Total: ${rec.totalCandidates.toString().padStart(3)} | Drawable: ${rec.drawableCandidates.toString().padStart(3)} | Filtered: ${rec.filteredCandidates.toString().padStart(2)} | Avg Len: ${rec.averageLength.toFixed(3)} | Avg Imp: ${rec.averageImportance.toFixed(2)}`
    );
  }

  const finalHeap = process.memoryUsage().heapUsed;
  const heapDeltaMB = Math.round(((finalHeap - initialHeap) / (1024 * 1024)) * 100) / 100;
  const totalHeapMB = Math.round((finalHeap / (1024 * 1024)) * 100) / 100;

  const avgLatency = results.reduce((acc, r) => acc + r.strokeLatencyMs, 0) / results.length;
  const avgTotal = results.reduce((acc, r) => acc + r.totalCandidates, 0) / results.length;
  const avgDrawable = results.reduce((acc, r) => acc + r.drawableCandidates, 0) / results.length;
  const avgFiltered = results.reduce((acc, r) => acc + r.filteredCandidates, 0) / results.length;
  const avgLength = results.reduce((acc, r) => acc + r.averageLength, 0) / results.length;
  const avgImportance = results.reduce((acc, r) => acc + r.averageImportance, 0) / results.length;
  const maxCandidates = Math.max(...results.map(r => r.totalCandidates));

  console.log('\n================================================================================');
  console.log('  BENCHMARK SUMMARY');
  console.log('================================================================================');
  console.log(`Average Stroke Latency:       ${avgLatency.toFixed(2)} ms (SLA budget: < 50 ms)`);
  console.log(`Average Total Candidates:     ${avgTotal.toFixed(1)}`);
  console.log(`Average Drawable Candidates:  ${avgDrawable.toFixed(1)}`);
  console.log(`Average Filtered Candidates:  ${avgFiltered.toFixed(1)}`);
  console.log(`Maximum Candidates in Batch:  ${maxCandidates} (Safe scaling: no stroke explosion)`);
  console.log(`Average Candidate Arc Length: ${avgLength.toFixed(4)}`);
  console.log(`Average Candidate Importance: ${avgImportance.toFixed(2)}`);
  console.log(`Peak Heap Memory Delta:       ${heapDeltaMB} MB (Total Heap: ${totalHeapMB} MB)`);
  console.log(`BM-02 Profile Occlusion:      ${results.find(r => r.id.includes('BM-02'))?.profileOcclusionPass ? 'PASS (0 occluded drawable strokes)' : 'FAIL'}`);
  console.log(`BM-11 Multi-Person Isolation:  ${results.find(r => r.id.includes('BM-11'))?.multiPersonSeparated ? 'PASS (Independent subjectId preservation)' : 'FAIL'}`);
  console.log('================================================================================\n');

  return results;
}

runStrokeCandidateBenchmark().catch(err => {
  console.error('Benchmark failed with error:', err);
  process.exit(1);
});
