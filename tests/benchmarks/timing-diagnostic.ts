import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import jpeg from 'jpeg-js';
import { preprocessPixelBuffer } from '../../packages/image-processing/src';
import { DeterministicVisionProvider, analyzeSubjectTonalRegions } from '../../packages/structural-analysis/src';

const timestamps: Record<string, number> = {};
const t = (label: string) => {
  const now = performance.now();
  timestamps[label] = now;
  console.log(`[${(now / 1000).toFixed(3)}s] ${label}`);
};

async function run() {
  t('START');

  const raw = fs.readFileSync('./tests/images/BM-01-FRONT-PORTRAIT.jpg');
  t('JPEG READ');

  const dec = jpeg.decode(raw, { useTArray: true });
  t(`JPEG DECODED: ${dec.width}x${dec.height}`);

  const norm = preprocessPixelBuffer(
    { width: dec.width, height: dec.height, data: dec.data },
    { maxDimension: 1024 }
  );
  t(`PREPROCESS COMPLETE: ${norm.width}x${norm.height}`);

  const provider = new DeterministicVisionProvider();
  t('PROVIDER CREATED');

  const res = await provider.analyze({
    image: norm,
    sourceDimensions: { width: dec.width, height: dec.height },
    options: { mode: 'deterministic' }
  });
  t('PROVIDER ANALYZE COMPLETE');

  console.log('Subject:', !!res.primarySubject);

  const regions = analyzeSubjectTonalRegions(
    norm.luminance,
    res.primarySubject
  );
  t('TONAL ANALYSIS COMPLETE');

  console.log('Tonal regions count:', regions.length);

  for (const r of regions) {
    console.log(
      r.id,
      r.semanticAssociation,
      'intensity:',
      r.intensity.toFixed(3),
      'class:',
      r.classification,
      'bounds:',
      JSON.stringify(r.bounds)
    );
  }

  t('DONE');

  const tStart = timestamps['START'];
  const tJpegRead = timestamps['JPEG READ'];
  const tJpegDec = timestamps[`JPEG DECODED: ${dec.width}x${dec.height}`];
  const tPreprocess = timestamps[`PREPROCESS COMPLETE: ${norm.width}x${norm.height}`];
  const tProvCreate = timestamps['PROVIDER CREATED'];
  const tProvAnalyze = timestamps['PROVIDER ANALYZE COMPLETE'];
  const tTonal = timestamps['TONAL ANALYSIS COMPLETE'];
  const tDone = timestamps['DONE'];

  console.log('\n--- TIMING BREAKDOWN ---');
  console.log(`JPEG READ:          ${(tJpegRead - tStart).toFixed(2)} ms`);
  console.log(`JPEG DECODE:        ${(tJpegDec - tJpegRead).toFixed(2)} ms`);
  console.log(`PREPROCESSING:      ${(tPreprocess - tJpegDec).toFixed(2)} ms`);
  console.log(`PROVIDER CREATION:  ${(tProvCreate - tPreprocess).toFixed(2)} ms`);
  console.log(`PROVIDER ANALYZE:   ${(tProvAnalyze - tProvCreate).toFixed(2)} ms`);
  console.log(`TONAL ANALYSIS:     ${(tTonal - tProvAnalyze).toFixed(2)} ms`);
  console.log(`TOTAL:              ${(tDone - tStart).toFixed(2)} ms`);
}

run().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
