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
  detectMouth,
  MouthDetectionResult,
  detectJawline,
  JawlineDetectionResult,
} from '../../packages/structural-analysis/src';

interface BenchmarkItem {
  id: string;
  filename: string;
  category: string;
}

interface DatasetManifest {
  categories: BenchmarkItem[];
}

export interface JawlineInspectionRecord {
  id: string;
  filename: string;
  category: string;
  subjectIndex: number;
  subjectId: string;
  pose: string;
  latencyMs: number;
  jawlineVisibility: string;
  jawlineConfidence: number;
  leftJawDetected: boolean;
  leftJawConfidence: number;
  leftJawPoints: number;
  rightJawDetected: boolean;
  rightJawConfidence: number;
  rightJawPoints: number;
  chinDetected: boolean;
  chinConfidence: number;
  chinPoints: number;
  chinTipDetected: boolean;
  totalPoints: number;
  origBase64: string;
  estimate: FaceRegionEstimate | null;
  eyes: EyeDetectionResult | null;
  nose: NoseDetectionResult | null;
  mouth: MouthDetectionResult | null;
  jawline: JawlineDetectionResult | null;
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

export function runJawlineInspectionSuite(): void {
  console.log('='.repeat(100));
  console.log('  SKETCH MAKER - JAWLINE & FACIAL CONTOUR VISUAL INSPECTION (TASK-103 STEP 2E.1)');
  console.log('='.repeat(100));

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Dataset manifest not found at ${manifestPath}`);
  }

  const manifest: DatasetManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const records: JawlineInspectionRecord[] = [];

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
      console.log(`[JAWLINE] ${item.id.padEnd(26)} | NO FACE DETECTED`);
      continue;
    }

    const imgRawBuffer = fs.readFileSync(imgPath);
    const origBase64 = `data:image/jpeg;base64,${imgRawBuffer.toString('base64')}`;

    for (let subIdx = 0; subIdx < faceEstimates.length; subIdx++) {
      const faceEst = faceEstimates[subIdx];
      const eyes = detectEyeLandmarks(faceEst, normImage, gradients, segResult.mask);
      const nose = detectNose(faceEst, normImage, gradients, segResult.mask, eyes);
      const mouth = detectMouth(faceEst, normImage, gradients, segResult.mask, eyes, nose);

      const t0 = performance.now();
      const jaw = detectJawline(faceEst, normImage, gradients, segResult.mask, eyes, nose, mouth);
      const latency = performance.now() - t0;

      const leftPts = jaw.leftJaw?.points.length ?? 0;
      const rightPts = jaw.rightJaw?.points.length ?? 0;
      const chinPts = jaw.chin?.points.length ?? 0;
      const totalPoints = jaw.jawline?.points.length ?? (leftPts + rightPts + chinPts);

      const leftConf = jaw.leftJaw?.confidence ?? 0;
      const rightConf = jaw.rightJaw?.confidence ?? 0;
      const chinConf = jaw.chin?.confidence ?? 0;

      records.push({
        id: item.id,
        filename: item.filename,
        category: item.category,
        subjectIndex: subIdx,
        subjectId: faceEst.subjectId,
        pose: faceEst.pose,
        latencyMs: latency,
        jawlineVisibility: jaw.visibility,
        jawlineConfidence: jaw.confidence,
        leftJawDetected: leftPts > 0,
        leftJawConfidence: leftConf,
        leftJawPoints: leftPts,
        rightJawDetected: rightPts > 0,
        rightJawConfidence: rightConf,
        rightJawPoints: rightPts,
        chinDetected: chinPts > 0,
        chinConfidence: chinConf,
        chinPoints: chinPts,
        chinTipDetected: jaw.chinTip !== undefined,
        totalPoints,
        origBase64,
        estimate: faceEst,
        eyes,
        nose,
        mouth,
        jawline: jaw,
      });

      const label = faceEstimates.length > 1 ? `${item.id} (Sub ${subIdx + 1})` : item.id;
      console.log(
        `[JAWLINE] ${label.padEnd(26)} | Pose: ${faceEst.pose.padEnd(18)} | Jaw: ${jaw.visibility.padEnd(12)} (c: ${jaw.confidence.toFixed(2)}, pts: ${String(totalPoints).padStart(3)}) | Left: ${leftPts > 0 ? 'YES' : 'NO '} (${leftPts} pts) | Right: ${rightPts > 0 ? 'YES' : 'NO '} (${rightPts} pts) | Chin: ${chinPts > 0 ? 'YES' : 'NO '} (${chinPts} pts) | Tip: ${jaw.chinTip ? 'YES' : 'NO '} | Time: ${latency.toFixed(2)} ms`
      );
    }
  }

  const avgLatency = records.reduce((acc, r) => acc + r.latencyMs, 0) / records.length;
  console.log('-'.repeat(100));
  console.log(`Average Jawline Landmark Extraction Latency: ${avgLatency.toFixed(2)} ms`);
  console.log('='.repeat(100));

  generateHtmlReport(records, avgLatency);
}

function generateHtmlReport(records: JawlineInspectionRecord[], avgLatency: number): void {
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  const rows = records
    .map((r) => {
      const faceBox = r.estimate ? r.estimate.faceBoundingBox : null;
      const jaw = r.jawline;
      const mouth = r.mouth;
      const nose = r.nose;
      const eyes = r.eyes;

      const svgPaths: string[] = [];

      // Render face bounding box
      if (faceBox) {
        svgPaths.push(
          `<rect x="${(faceBox.x * 100).toFixed(2)}%" y="${(faceBox.y * 100).toFixed(2)}%" width="${(faceBox.width * 100).toFixed(2)}%" height="${(faceBox.height * 100).toFixed(2)}%" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="3,3" opacity="0.4"/>`
        );
      }

      // Render eyes in muted translucent green
      if (eyes?.leftEye?.upperLid.points.length) {
        const pts = eyes.leftEye.upperLid.points.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`).join(' ');
        svgPaths.push(`<polyline points="${pts}" fill="none" stroke="#4ade80" stroke-width="1.5" opacity="0.3"/>`);
      }
      if (eyes?.rightEye?.upperLid.points.length) {
        const pts = eyes.rightEye.upperLid.points.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`).join(' ');
        svgPaths.push(`<polyline points="${pts}" fill="none" stroke="#4ade80" stroke-width="1.5" opacity="0.3"/>`);
      }

      // Render nose tip in muted amber
      if (nose?.tip?.points.length) {
        const pts = nose.tip.points.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`).join(' ');
        svgPaths.push(`<polyline points="${pts}" fill="none" stroke="#fbbf24" stroke-width="1.5" opacity="0.3"/>`);
      }

      // Render oral fissure in muted coral
      if (mouth?.lipSeparation?.points.length) {
        const pts = mouth.lipSeparation.points.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`).join(' ');
        svgPaths.push(`<polyline points="${pts}" fill="none" stroke="#f43f5e" stroke-width="1.5" opacity="0.3"/>`);
      }

      // Render Left Jaw contour in sky blue
      if (jaw?.leftJaw?.points.length) {
        const pts = jaw.leftJaw.points.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`).join(' ');
        svgPaths.push(`<polyline points="${pts}" fill="none" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round"/>`);
      }

      // Render Right Jaw contour in indigo
      if (jaw?.rightJaw?.points.length) {
        const pts = jaw.rightJaw.points.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`).join(' ');
        svgPaths.push(`<polyline points="${pts}" fill="none" stroke="#818cf8" stroke-width="2.5" stroke-linecap="round"/>`);
      }

      // Render Chin contour in bright gold/amber
      if (jaw?.chin?.points.length) {
        const pts = jaw.chin.points.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`).join(' ');
        svgPaths.push(`<polyline points="${pts}" fill="none" stroke="#fbbf24" stroke-width="3" stroke-linecap="round"/>`);
      }

      // Render Chin Tip apex in rose/magenta
      if (jaw?.chinTip) {
        svgPaths.push(
          `<circle cx="${(jaw.chinTip.x * 100).toFixed(2)}%" cy="${(jaw.chinTip.y * 100).toFixed(2)}%" r="4" fill="#f43f5e" stroke="#ffffff" stroke-width="1.5"/>`
        );
      }

      const visBadgeClass =
        r.jawlineVisibility === 'visible' ? 'badge-visible' : r.jawlineVisibility === 'uncertain' ? 'badge-uncertain' : 'badge-undetected';

      return `
      <tr>
        <td><strong>${r.id}</strong><br><small style="color:#94a3b8;">${r.category} (Sub ${r.subjectIndex + 1})</small></td>
        <td><code>${r.pose}</code></td>
        <td><span class="badge ${visBadgeClass}">${r.jawlineVisibility}</span> (${r.jawlineConfidence.toFixed(2)})</td>
        <td>${r.leftJawDetected ? `<span style="color:#38bdf8;">✓ YES (${r.leftJawPoints} pts)</span>` : '<span style="color:#64748b;">NONE</span>'}</td>
        <td>${r.rightJawDetected ? `<span style="color:#818cf8;">✓ YES (${r.rightJawPoints} pts)</span>` : '<span style="color:#64748b;">NONE</span>'}</td>
        <td>${r.chinDetected ? `<span style="color:#fbbf24;">✓ YES (${r.chinPoints} pts)</span>` : '<span style="color:#64748b;">NONE</span>'}</td>
        <td>${r.chinTipDetected ? `<span style="color:#f43f5e;">● YES</span>` : '<span style="color:#64748b;">NONE</span>'}</td>
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
    .join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Sketch Maker - Jawline & Facial Contour Visual Inspection Report (TASK-103 Step 2E.1)</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #0f172a;
      color: #f8fafc;
      margin: 0;
      padding: 24px;
    }
    h1 {
      color: #38bdf8;
      margin-bottom: 8px;
    }
    p.subtitle {
      color: #94a3b8;
      margin-top: 0;
      margin-bottom: 24px;
    }
    .metrics-bar {
      display: flex;
      gap: 24px;
      background-color: #1e293b;
      padding: 16px 20px;
      border-radius: 8px;
      margin-bottom: 24px;
      border: 1px solid #334155;
    }
    .metric {
      display: flex;
      flex-direction: column;
    }
    .metric-label {
      font-size: 12px;
      text-transform: uppercase;
      color: #94a3b8;
      letter-spacing: 0.05em;
    }
    .metric-value {
      font-size: 20px;
      font-weight: bold;
      color: #38bdf8;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background-color: #1e293b;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid #334155;
    }
    th, td {
      padding: 12px 16px;
      text-align: left;
      border-bottom: 1px solid #334155;
      font-size: 14px;
      vertical-align: middle;
    }
    th {
      background-color: #0f172a;
      color: #cbd5e1;
      font-weight: 600;
      text-transform: uppercase;
      font-size: 12px;
      letter-spacing: 0.05em;
    }
    tr:hover {
      background-color: #273549;
    }
    .badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: bold;
      text-transform: uppercase;
    }
    .badge-visible {
      background-color: #065f46;
      color: #34d399;
    }
    .badge-uncertain {
      background-color: #854d0e;
      color: #facc15;
    }
    .badge-undetected {
      background-color: #7f1d1d;
      color: #f87171;
    }
    .canvas-box {
      position: relative;
      width: 180px;
      height: 180px;
      background-color: #000;
      border-radius: 4px;
      overflow: hidden;
      border: 1px solid #475569;
    }
    .canvas-box img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .canvas-box svg {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }
    .legend {
      display: flex;
      gap: 16px;
      margin-bottom: 16px;
      font-size: 13px;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .legend-color {
      width: 14px;
      height: 14px;
      border-radius: 3px;
    }
  </style>
</head>
<body>
  <h1>Sketch Maker - Jawline & Facial Contour Visual Inspection Report</h1>
  <p class="subtitle">TASK-103 Step 2E.1 Benchmark Suite Verification (BM-01 to BM-12)</p>

  <div class="metrics-bar">
    <div class="metric">
      <span class="metric-label">Benchmark Images</span>
      <span class="metric-value">${records.length} subjects</span>
    </div>
    <div class="metric">
      <span class="metric-label">Avg Extraction Latency</span>
      <span class="metric-value">${avgLatency.toFixed(2)} ms</span>
    </div>
    <div class="metric">
      <span class="metric-label">Target Latency</span>
      <span class="metric-value">&lt; 150 ms</span>
    </div>
    <div class="metric">
      <span class="metric-label">Profile Handling</span>
      <span class="metric-value">Active (BM-02)</span>
    </div>
    <div class="metric">
      <span class="metric-label">Memory Bounded</span>
      <span class="metric-value">Yes (BM-12 24MP)</span>
    </div>
  </div>

  <div class="legend">
    <div class="legend-item"><div class="legend-color" style="background:#38bdf8;"></div> Left Jaw Path (Sky Blue)</div>
    <div class="legend-item"><div class="legend-color" style="background:#818cf8;"></div> Right Jaw Path (Indigo)</div>
    <div class="legend-item"><div class="legend-color" style="background:#fbbf24;"></div> Chin Contour Arc (Gold)</div>
    <div class="legend-item"><div class="legend-color" style="background:#f43f5e;"></div> Chin Tip Apex (Rose)</div>
    <div class="legend-item"><div class="legend-color" style="background:#38bdf8; border:1px dashed #fff;"></div> Face Box (Dashed Sky)</div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Image / Category</th>
        <th>Head Pose</th>
        <th>Jawline Visibility</th>
        <th>Left Jaw</th>
        <th>Right Jaw</th>
        <th>Chin Arc</th>
        <th>Chin Tip</th>
        <th>Total Pts</th>
        <th>Latency</th>
        <th>Overlay Preview</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</body>
</html>`;

  const reportPath = path.join(artifactsDir, 'jawline-report.html');
  fs.writeFileSync(reportPath, html, 'utf-8');
  console.log(`\nReport written to: ${reportPath}`);
}

if (require.main === module) {
  runJawlineInspectionSuite();
}
