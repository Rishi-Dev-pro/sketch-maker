import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import jpeg from 'jpeg-js';
import { preprocessPixelBuffer, PixelBuffer } from '../../packages/image-processing/src';
import { DeterministicVisionProvider } from '../../packages/structural-analysis/src';
import {
  extractAllVectorGeometry,
  VectorGeometry,
  PathHierarchyLevel
} from '../../packages/stroke-engine/src';

interface DatasetItem {
  id: string;
  filename: string;
  category: string;
}

interface DatasetManifest {
  categories: DatasetItem[];
}

export interface GeometryBenchmarkResult {
  id: string;
  category: string;
  subjectCount: number;
  geometryLatencyMs: number;
  totalPaths: number;
  totalRawPoints: number;
  totalSimplifiedPoints: number;
  reductionRatioPct: number;
  pathsByLevel: Record<PathHierarchyLevel, number>;
  profileHiddenSuppressed: boolean;
  multiPersonSeparated: boolean;
}

async function runGeometryBenchmark() {
  console.log('================================================================================');
  console.log('  TASK-104: Contour & Vector Generation — 12-Category Benchmark Evaluation');
  console.log('================================================================================\n');

  const datasetPath = path.resolve(process.cwd(), 'tests/images/dataset.json');
  const manifest: DatasetManifest = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));

  const provider = new DeterministicVisionProvider();
  const results: GeometryBenchmarkResult[] = [];

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


    // Benchmark pure Vector Geometry extraction
    const tStart = performance.now();
    const vectorGeom: VectorGeometry = extractAllVectorGeometry(visionResult.subjects);
    const tEnd = performance.now();
    const geomLatency = tEnd - tStart;


    // Check BM-02 profile hidden-side suppression
    let profileHiddenSuppressed = true;
    if (item.id.includes('BM-02')) {
      const rightEyePaths = vectorGeom.paths.filter(p => p.id.includes('right_eye'));
      const rightEarPaths = vectorGeom.paths.filter(p => p.id.includes('right_ear'));
      profileHiddenSuppressed = rightEyePaths.length === 0 && rightEarPaths.length === 0;
    }

    // Check BM-11 multi-person separation
    let multiPersonSeparated = true;
    if (item.id.includes('BM-11')) {
      const subjectIds = new Set(vectorGeom.paths.map(p => p.subjectId).filter(Boolean));
      multiPersonSeparated = subjectIds.size === visionResult.subjects.length;
    }


    const rec: GeometryBenchmarkResult = {
      id: item.id,
      category: item.category,
      subjectCount: visionResult.subjects.length,

      geometryLatencyMs: Math.round(geomLatency * 100) / 100,
      totalPaths: vectorGeom.metrics.totalPaths,
      totalRawPoints: vectorGeom.metrics.totalRawPoints,
      totalSimplifiedPoints: vectorGeom.metrics.totalSimplifiedPoints,
      reductionRatioPct: Math.round(vectorGeom.metrics.pointReductionRatio * 1000) / 10,
      pathsByLevel: vectorGeom.metrics.pathCountByLevel,
      profileHiddenSuppressed,
      multiPersonSeparated
    };

    results.push(rec);

    console.log(
      `[${rec.id.padEnd(26)}] Latency: ${rec.geometryLatencyMs.toFixed(2).padStart(6)} ms | Paths: ${rec.totalPaths.toString().padStart(3)} | Raw Pts: ${rec.totalRawPoints.toString().padStart(5)} | Simplified: ${rec.totalSimplifiedPoints.toString().padStart(5)} | Reduction: ${rec.reductionRatioPct.toFixed(1)}%`
    );
  }

  const finalHeap = process.memoryUsage().heapUsed;
  const heapDeltaMB = Math.round(((finalHeap - initialHeap) / (1024 * 1024)) * 100) / 100;
  const totalHeapMB = Math.round((finalHeap / (1024 * 1024)) * 100) / 100;

  const avgLatency = results.reduce((acc, r) => acc + r.geometryLatencyMs, 0) / results.length;
  const avgPaths = results.reduce((acc, r) => acc + r.totalPaths, 0) / results.length;
  const avgRawPoints = results.reduce((acc, r) => acc + r.totalRawPoints, 0) / results.length;
  const avgSimplifiedPoints = results.reduce((acc, r) => acc + r.totalSimplifiedPoints, 0) / results.length;
  const avgReduction = results.reduce((acc, r) => acc + r.reductionRatioPct, 0) / results.length;

  console.log('\n================================================================================');
  console.log('  BENCHMARK SUMMARY');
  console.log('================================================================================');
  console.log(`Average Geometry Latency:    ${avgLatency.toFixed(2)} ms (SLA budget: < 50 ms)`);
  console.log(`Average Path Count:          ${avgPaths.toFixed(1)}`);
  console.log(`Average Raw Points:          ${avgRawPoints.toFixed(1)}`);
  console.log(`Average Simplified Points:   ${avgSimplifiedPoints.toFixed(1)}`);
  console.log(`Average Point Reduction:     ${avgReduction.toFixed(1)}%`);
  console.log(`Peak Heap Memory Delta:      ${heapDeltaMB} MB (Total Heap: ${totalHeapMB} MB)`);
  console.log(`BM-02 Profile Occlusion:     ${results.find(r => r.id.includes('BM-02'))?.profileHiddenSuppressed ? 'PASS (Hidden far side strictly suppressed)' : 'FAIL'}`);
  console.log(`BM-11 Multi-Person Isolation: ${results.find(r => r.id.includes('BM-11'))?.multiPersonSeparated ? 'PASS (Independent subjectId tagging)' : 'FAIL'}`);
  console.log('================================================================================\n');

  return results;
}

runGeometryBenchmark().catch(err => {
  console.error('Benchmark failed with error:', err);
  process.exit(1);
});
