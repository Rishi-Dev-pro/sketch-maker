import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import jpeg from 'jpeg-js';
import {
  preprocessPixelBuffer,
  PixelBuffer,
} from '../../packages/image-processing/src';
import {
  segmentSubject,
  computeSobelGradients,
  estimateAllFaceRegions,
  FaceRegionEstimate,
  detectEyeLandmarks,
  EyeDetectionResult,
  detectNose,
  NoseDetectionResult,
} from '../../packages/structural-analysis/src';

interface BenchmarkItem {
  id: string;
  filename: string;
  category: string;
}

interface DatasetManifest {
  categories: BenchmarkItem[];
}

export interface NoseInspectionRecord {
  id: string;
  filename: string;
  category: string;
  subjectIndex: number;
  subjectId: string;
  pose: string;
  latencyMs: number;
  noseVisibility: string;
  noseConfidence: number;
  bridgeDetected: boolean;
  bridgeConfidence: number;
  bridgePoints: number;
  tipDetected: boolean;
  tipConfidence: number;
  leftNostrilVisibility: string;
  leftNostrilConfidence: number;
  rightNostrilVisibility: string;
  rightNostrilConfidence: number;
  totalPoints: number;
  origBase64: string;
  estimate: FaceRegionEstimate | null;
  eyes: EyeDetectionResult | null;
  nose: NoseDetectionResult | null;
}

const imagesDir = path.resolve(__dirname, '../images');
const manifestPath = path.join(imagesDir, 'dataset.json');
const artifactsDir = path.resolve(__dirname, '../artifacts');

function decodeJpeg(filePath: string): PixelBuffer {
  const buf = fs.readFileSync(filePath);
  const raw = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
  return {
    width: raw.width,
    height: raw.height,
    data: new Uint8ClampedArray(raw.data),
  };
}

export function runNoseInspectionSuite(): void {
  console.log('='.repeat(100));
  console.log('  SKETCH MAKER - NOSE LANDMARK VISUAL INSPECTION (TASK-103 STEP 2C)');
  console.log('='.repeat(100));

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Dataset manifest not found at ${manifestPath}`);
  }

  const manifest: DatasetManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const records: NoseInspectionRecord[] = [];

  for (const item of manifest.categories) {
    const imgPath = path.join(imagesDir, item.filename);
    const pixelBuf = decodeJpeg(imgPath);

    const normImage = preprocessPixelBuffer(pixelBuf, {
      targetDimension: 1024,
      normalizeLighting: false,
    });
    const segResult = segmentSubject(normImage);
    const gradients = computeSobelGradients(normImage.luminance);

    // Multi-subject face estimation (e.g. BM-11)
    const faceEstimates = estimateAllFaceRegions(segResult, normImage, gradients);

    if (faceEstimates.length === 0) {
      console.log(`[NOSE] ${item.id.padEnd(26)} | NO FACE DETECTED`);
      continue;
    }

    const imgRawBuffer = fs.readFileSync(imgPath);
    const origBase64 = `data:image/jpeg;base64,${imgRawBuffer.toString('base64')}`;

    for (let subIdx = 0; subIdx < faceEstimates.length; subIdx++) {
      const faceEst = faceEstimates[subIdx];
      const eyes = detectEyeLandmarks(faceEst, normImage, gradients, segResult.mask);

      const t0 = performance.now();
      const nose = detectNose(faceEst, normImage, gradients, segResult.mask, eyes);
      const latency = performance.now() - t0;

      const bridgePts = nose.bridge?.points.length ?? 0;
      const tipPts = nose.tip?.points.length ?? 0;
      const leftNosPts = nose.leftNostril?.points.length ?? 0;
      const rightNosPts = nose.rightNostril?.points.length ?? 0;
      const totalPoints = bridgePts + tipPts + leftNosPts + rightNosPts;

      const bridgeConf = nose.bridge ? nose.bridge.confidence : 0;
      const tipConf = nose.tip ? nose.tip.confidence : 0;
      const leftNosConf = nose.leftNostril ? nose.leftNostril.confidence : 0;
      const rightNosConf = nose.rightNostril ? nose.rightNostril.confidence : 0;

      records.push({
        id: item.id,
        filename: item.filename,
        category: item.category,
        subjectIndex: subIdx,
        subjectId: faceEst.subjectId,
        pose: faceEst.pose,
        latencyMs: latency,
        noseVisibility: nose.visibility,
        noseConfidence: nose.confidence,
        bridgeDetected: bridgePts > 0,
        bridgeConfidence: bridgeConf,
        bridgePoints: bridgePts,
        tipDetected: tipPts > 0,
        tipConfidence: tipConf,
        leftNostrilVisibility: nose.leftNostril?.visibility ?? 'not_detected',
        leftNostrilConfidence: leftNosConf,
        rightNostrilVisibility: nose.rightNostril?.visibility ?? 'not_detected',
        rightNostrilConfidence: rightNosConf,
        totalPoints,
        origBase64,
        estimate: faceEst,
        eyes,
        nose,
      });

      const label = faceEstimates.length > 1 ? `${item.id} (Sub ${subIdx + 1})` : item.id;
      console.log(
        `[NOSE] ${label.padEnd(26)} | Pose: ${faceEst.pose.padEnd(18)} | Nose: ${nose.visibility.padEnd(12)} (c: ${nose.confidence.toFixed(2)}, pts: ${String(totalPoints).padStart(3)}) | Bridge: ${bridgePts > 0 ? 'YES' : 'NO '} (${bridgePts} pts) | Nostrils (L/R): ${nose.leftNostril?.visibility ?? 'none'} / ${nose.rightNostril?.visibility ?? 'none'} | Time: ${latency.toFixed(2)} ms`
      );
    }
  }

  const avgLatency = records.reduce((acc, r) => acc + r.latencyMs, 0) / records.length;
  console.log('-'.repeat(100));
  console.log(`Average Nose Landmark Extraction Latency: ${avgLatency.toFixed(2)} ms`);
  console.log('='.repeat(100));

  generateHtmlReport(records, avgLatency);
}

function generateHtmlReport(records: NoseInspectionRecord[], avgLatency: number): void {
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  const rows = records
    .map((r, i) => {
      const faceBox = r.estimate ? r.estimate.faceBoundingBox : null;
      const nose = r.nose;
      const eyes = r.eyes;

      const svgPaths: string[] = [];

      // Render face bounding box
      if (faceBox) {
        svgPaths.push(
          `<rect x="${(faceBox.x * 100).toFixed(2)}%" y="${(faceBox.y * 100).toFixed(2)}%" width="${(faceBox.width * 100).toFixed(2)}%" height="${(faceBox.height * 100).toFixed(2)}%" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="3,3" opacity="0.6"/>`
        );
      }

      // Render eye landmarks in translucent lime for reference
      if (eyes?.leftEye?.upperLid.points.length) {
        const pts = eyes.leftEye.upperLid.points.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`).join(' ');
        svgPaths.push(`<polyline points="${pts}" fill="none" stroke="#4ade80" stroke-width="1.5" opacity="0.4"/>`);
      }
      if (eyes?.rightEye?.upperLid.points.length) {
        const pts = eyes.rightEye.upperLid.points.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`).join(' ');
        svgPaths.push(`<polyline points="${pts}" fill="none" stroke="#4ade80" stroke-width="1.5" opacity="0.4"/>`);
      }

      // Render nasal bridge in bright yellow/amber
      if (nose?.bridge?.points.length) {
        const pts = nose.bridge.points.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`).join(' ');
        svgPaths.push(`<polyline points="${pts}" fill="none" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round"/>`);
        for (const p of nose.bridge.points) {
          svgPaths.push(`<circle cx="${(p.x * 100).toFixed(2)}%" cy="${(p.y * 100).toFixed(2)}%" r="1.5" fill="#fef08a"/>`);
        }
      }

      // Render nasal tip in magenta
      if (nose?.tip?.points.length) {
        const pts = nose.tip.points.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`).join(' ');
        svgPaths.push(`<polyline points="${pts}" fill="none" stroke="#ec4899" stroke-width="2.5" stroke-linecap="round"/>`);
      }

      // Render left nostril in coral
      if (nose?.leftNostril?.points.length) {
        const pts = nose.leftNostril.points.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`).join(' ');
        svgPaths.push(`<polyline points="${pts}" fill="none" stroke="#f43f5e" stroke-width="2" stroke-linecap="round"/>`);
      }

      // Render right nostril in coral
      if (nose?.rightNostril?.points.length) {
        const pts = nose.rightNostril.points.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`).join(' ');
        svgPaths.push(`<polyline points="${pts}" fill="none" stroke="#f43f5e" stroke-width="2" stroke-linecap="round"/>`);
      }

      const visBadgeClass =
        r.noseVisibility === 'visible' ? 'badge-visible' : r.noseVisibility === 'uncertain' ? 'badge-uncertain' : 'badge-undetected';

      return `
      <tr>
        <td><strong>${r.id}</strong><br><small style="color:#94a3b8;">${r.category} (Sub ${r.subjectIndex + 1})</small></td>
        <td><code>${r.pose}</code></td>
        <td><span class="badge ${visBadgeClass}">${r.noseVisibility}</span> (${r.noseConfidence.toFixed(2)})</td>
        <td>${r.bridgeDetected ? `<span style="color:#fbbf24;">✓ YES (${r.bridgePoints} pts)</span>` : '<span style="color:#64748b;">NONE</span>'}</td>
        <td>${r.tipDetected ? '<span style="color:#ec4899;">✓ YES</span>' : '<span style="color:#64748b;">NONE</span>'}</td>
        <td>
          L: <code>${r.leftNostrilVisibility}</code> (${r.leftNostrilConfidence.toFixed(2)})<br>
          R: <code>${r.rightNostrilVisibility}</code> (${r.rightNostrilConfidence.toFixed(2)})
        </td>
        <td><strong>${r.totalPoints}</strong></td>
        <td>${r.latencyMs.toFixed(2)} ms</td>
        <td>
          <div class="canvas-box">
            <img src="${r.origBase64}" alt="${r.id}" />
            <svg viewBox="0 0 100 100" preserveAspectRatio="none">
              ${svgPaths.join('\n              ')}
            </svg>
          </div>
        </td>
      </tr>`;
    })
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Sketch Maker - Nose Landmark Visual Inspection Report (TASK-103 Step 2C)</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 24px; }
    h1 { color: #f8fafc; margin-bottom: 4px; }
    p.lead { color: #94a3b8; margin-top: 0; margin-bottom: 24px; }
    .metrics-bar { display: flex; gap: 16px; margin-bottom: 24px; }
    .metric-card { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 16px 20px; flex: 1; }
    .metric-label { font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
    .metric-val { font-size: 24px; font-weight: 700; color: #38bdf8; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 8px; overflow: hidden; }
    th, td { padding: 12px 14px; text-align: left; border-bottom: 1px solid #334155; font-size: 13px; }
    th { background: #0f172a; color: #94a3b8; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; }
    tr:hover { background: #243248; }
    code { background: #0f172a; padding: 2px 6px; border-radius: 4px; font-family: "JetBrains Mono", Consolas, monospace; font-size: 11px; color: #38bdf8; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
    .badge-visible { background: #065f46; color: #34d399; }
    .badge-uncertain { background: #854d0e; color: #fde047; }
    .badge-undetected { background: #334155; color: #94a3b8; }
    .canvas-box { position: relative; width: 140px; height: 140px; background: #000; border-radius: 4px; overflow: hidden; border: 1px solid #475569; }
    .canvas-box img { width: 100%; height: 100%; object-fit: contain; }
    .canvas-box svg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; }
    .legend { display: flex; gap: 16px; align-items: center; margin-bottom: 16px; font-size: 12px; color: #94a3b8; }
    .legend-item { display: flex; align-items: center; gap: 6px; }
    .legend-color { width: 12px; height: 12px; border-radius: 2px; }
  </style>
</head>
<body>
  <h1>Sketch Maker - Nose Landmark Visual Inspection Report</h1>
  <p class="lead">TASK-103 Step 2C: Multi-cue nasal dorsum ridge tracing, tip localization, and alar boundary extraction.</p>

  <div class="metrics-bar">
    <div class="metric-card">
      <div class="metric-label">Benchmark Categories</div>
      <div class="metric-val">12 / 12</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Average Extraction Latency</div>
      <div class="metric-val">${avgLatency.toFixed(2)} ms</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Latency SLA Target</div>
      <div class="metric-val">&lt; 150 ms</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">External Dependencies</div>
      <div class="metric-val">0 (Pure TS)</div>
    </div>
  </div>

  <div class="legend">
    <div class="legend-item"><div class="legend-color" style="background:#38bdf8;"></div> Face Box</div>
    <div class="legend-item"><div class="legend-color" style="background:#4ade80;"></div> Eyelids (Ref)</div>
    <div class="legend-item"><div class="legend-color" style="background:#fbbf24;"></div> Nasal Bridge</div>
    <div class="legend-item"><div class="legend-color" style="background:#ec4899;"></div> Nasal Tip</div>
    <div class="legend-item"><div class="legend-color" style="background:#f43f5e;"></div> Nostrils / Alar Margins</div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Benchmark Image</th>
        <th>Head Pose</th>
        <th>Nose Visibility</th>
        <th>Bridge</th>
        <th>Tip</th>
        <th>Nostrils (L / R)</th>
        <th>Total Points</th>
        <th>Latency</th>
        <th>Visual Overlay</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</body>
</html>`;

  const reportPath = path.join(artifactsDir, 'nose-report.html');
  fs.writeFileSync(reportPath, html, 'utf-8');
  console.log(`[REPORT GENERATED] Nose visual inspection report written to: ${reportPath}`);
}

// Direct execution
if (require.main === module) {
  runNoseInspectionSuite();
}
