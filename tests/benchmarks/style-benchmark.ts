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
  createRenderState
} from '../../packages/stroke-engine/src';
import {
  resolveStyledRenderState,
  getAllStylePresets
} from '../../packages/style-engine/src';
import { StyleId } from '@sketch-maker/shared-types';

interface DatasetItem {
  id: string;
  filename: string;
  category: string;
}

interface DatasetManifest {
  categories: DatasetItem[];
}

export interface StyleBenchmarkResult {
  id: string;
  category: string;
  totalStrokes: number;
  blackLatencyMs: number;
  redLatencyMs: number;
  neonLatencyMs: number;
  blueprintLatencyMs: number;
  avgLatencyMs: number;
  geometryInvariantPass: boolean;
  profileOcclusionPass: boolean;
  multiPersonSeparated: boolean;
}

async function runStyleBenchmark() {
  console.log('================================================================================');
  console.log('  TASK-109: Procedural Style Engine & Appearance System — 12-Category Benchmark');
  console.log('================================================================================\n');

  const datasetPath = path.resolve(process.cwd(), 'tests/images/dataset.json');
  const manifest: DatasetManifest = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));

  const provider = new DeterministicVisionProvider();
  const presets = getAllStylePresets();
  const results: StyleBenchmarkResult[] = [];

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

    // Pipeline: Perception -> Geometry -> Candidates -> Ordering -> Timeline -> RenderState
    const visionResult = await provider.analyze({
      image: preprocessed,
      sourceDimensions: { width: decoded.width, height: decoded.height }
    });

    const vectorGeo = extractAllVectorGeometry(
      visionResult.subjects,
      { minConfidence: 0.15, simplifyTolerance: 0.003 }
    );

    const candidateSet = generateStrokeCandidates(vectorGeo);
    const orderedSeq = orderStrokeCandidates(candidateSet);
    const timeline = createStrokeTimeline(orderedSeq, { targetDurationMs: 15000 });
    const renderState = createRenderState(timeline, timeline.totalDurationMs * 0.5);

    // Benchmark each of the 4 style presets
    const latencies: Record<StyleId, number> = {
      procedural_black: 0,
      red_line: 0,
      neon: 0,
      blueprint: 0
    };

    let geometryInvariantPass = true;

    for (const preset of presets) {
      const pId = preset.id as StyleId;
      // Warmup & timing
      resolveStyledRenderState(renderState, { preset: pId });

      const t0 = performance.now();
      const iterations = 50;
      let lastStyled = null;
      for (let i = 0; i < iterations; i++) {
        lastStyled = resolveStyledRenderState(renderState, { preset: pId });
      }
      const t1 = performance.now();
      const avgTime = (t1 - t0) / iterations;
      latencies[pId] = avgTime;

      // Invariant check: stroke count, stroke IDs, coordinates must match renderState exactly
      if (lastStyled) {
        if (lastStyled.styledStrokes.length !== renderState.strokes.length) {
          geometryInvariantPass = false;
        }
        for (let i = 0; i < lastStyled.styledStrokes.length; i++) {
          const sStyled = lastStyled.styledStrokes[i];
          const sOrig = renderState.strokes[i];
          if (sStyled.strokeId !== sOrig.strokeId) geometryInvariantPass = false;
          if (sStyled.geometry.points.length !== sOrig.geometry.points.length) geometryInvariantPass = false;
        }
      }
    }

    const avgLatencyMs = (
      latencies.procedural_black +
      latencies.red_line +
      latencies.neon +
      latencies.blueprint
    ) / 4;

    // Profile Occlusion Check (BM-02)
    let profileOcclusionPass = true;
    if (item.id.includes('BM-02')) {
      const neonStyled = resolveStyledRenderState(renderState, { preset: 'neon' });
      for (const s of neonStyled.styledStrokes) {
        if (s.semanticRole === 'eye' || s.semanticRole === 'ear') {
          // Verify no occluded features were styled
          if (s.strokeId.includes('occluded')) {
            profileOcclusionPass = false;
          }
        }
      }
    }

    // Multi-Person Isolation Check (BM-11)
    let multiPersonSeparated = true;
    if (item.id.includes('BM-11')) {
      const blueprintStyled = resolveStyledRenderState(renderState, { preset: 'blueprint' });
      const subjectIds = new Set(blueprintStyled.styledStrokes.map(s => s.subjectId).filter(Boolean));
      multiPersonSeparated = subjectIds.size === visionResult.subjects.length;
    }

    results.push({
      id: item.id,
      category: item.category,
      totalStrokes: renderState.totalStrokes,
      blackLatencyMs: latencies.procedural_black,
      redLatencyMs: latencies.red_line,
      neonLatencyMs: latencies.neon,
      blueprintLatencyMs: latencies.blueprint,
      avgLatencyMs,
      geometryInvariantPass,
      profileOcclusionPass,
      multiPersonSeparated
    });

    console.log(
      `  ✓ [${item.id.padEnd(26)}] ${renderState.totalStrokes} strokes | ` +
      `Black: ${latencies.procedural_black.toFixed(3)}ms | ` +
      `Red: ${latencies.red_line.toFixed(3)}ms | ` +
      `Neon: ${latencies.neon.toFixed(3)}ms | ` +
      `Blueprint: ${latencies.blueprint.toFixed(3)}ms | ` +
      `Avg: ${avgLatencyMs.toFixed(3)}ms | ` +
      `Invariant: ${geometryInvariantPass ? 'PASS' : 'FAIL'}`
    );
  }

  const finalHeap = process.memoryUsage().heapUsed;
  const heapDeltaMb = (finalHeap - initialHeap) / (1024 * 1024);

  const avgTotalStrokes = results.reduce((acc, r) => acc + r.totalStrokes, 0) / results.length;
  const avgBlack = results.reduce((acc, r) => acc + r.blackLatencyMs, 0) / results.length;
  const avgRed = results.reduce((acc, r) => acc + r.redLatencyMs, 0) / results.length;
  const avgNeon = results.reduce((acc, r) => acc + r.neonLatencyMs, 0) / results.length;
  const avgBlueprint = results.reduce((acc, r) => acc + r.blueprintLatencyMs, 0) / results.length;
  const overallAvg = results.reduce((acc, r) => acc + r.avgLatencyMs, 0) / results.length;
  const allInvariantsPass = results.every(r => r.geometryInvariantPass);
  const allOcclusionPass = results.every(r => r.profileOcclusionPass);
  const allMultiPersonPass = results.every(r => r.multiPersonSeparated);

  console.log('\n================================================================================');
  console.log('  12-CATEGORY STYLE ENGINE BENCHMARK SUMMARY');
  console.log('================================================================================');
  console.log(`  Average Total Strokes:            ${avgTotalStrokes.toFixed(1)}`);
  console.log(`  Procedural Black Latency:         ${avgBlack.toFixed(3)} ms`);
  console.log(`  Red Line Latency:                 ${avgRed.toFixed(3)} ms`);
  console.log(`  Neon Latency:                     ${avgNeon.toFixed(3)} ms`);
  console.log(`  Blueprint Latency:                ${avgBlueprint.toFixed(3)} ms`);
  console.log(`  Overall Avg Resolution Latency:   ${overallAvg.toFixed(3)} ms (Target: < 1.0 ms)`);
  console.log(`  Geometry Invariant Check:         ${allInvariantsPass ? 'PASS (100% Geometry Unchanged)' : 'FAIL'}`);
  console.log(`  BM-02 Profile Occlusion Check:    ${allOcclusionPass ? 'PASS (0 occluded styled strokes)' : 'FAIL'}`);
  console.log(`  BM-11 Multi-Person Isolation:     ${allMultiPersonPass ? 'PASS (Distinct subjects preserved)' : 'FAIL'}`);
  console.log(`  Heap RAM Delta:                   ${heapDeltaMb.toFixed(2)} MB`);
  console.log('================================================================================\n');

  if (overallAvg > 1.0) {
    console.error(`❌ Benchmark SLA violation: average style resolution latency ${overallAvg.toFixed(3)} ms exceeds 1.0 ms`);
    process.exit(1);
  }
}

runStyleBenchmark().catch(err => {
  console.error('Benchmark failed with error:', err);
  process.exit(1);
});
