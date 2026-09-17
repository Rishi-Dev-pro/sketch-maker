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
} from '../../packages/structural-analysis/src';

interface BenchmarkItem {
  id: string;
  filename: string;
  category: string;
}

interface DatasetManifest {
  categories: BenchmarkItem[];
}

export interface MouthInspectionRecord {
  id: string;
  filename: string;
  category: string;
  subjectIndex: number;
  subjectId: string;
  pose: string;
  latencyMs: number;
  mouthVisibility: string;
  mouthConfidence: number;
  fissureDetected: boolean;
  fissureConfidence: number;
  fissurePoints: number;
  upperLipDetected: boolean;
  upperLipConfidence: number;
  upperLipPoints: number;
  lowerLipDetected: boolean;
  lowerLipConfidence: number;
  lowerLipPoints: number;
  leftCornerDetected: boolean;
  rightCornerDetected: boolean;
  totalPoints: number;
  origBase64: string;
  estimate: FaceRegionEstimate | null;
  eyes: EyeDetectionResult | null;
  nose: NoseDetectionResult | null;
  mouth: MouthDetectionResult | null;
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

export function runMouthInspectionSuite(): void {
  console.log('='.repeat(100));
  console.log('  SKETCH MAKER - MOUTH & LIPS LANDMARK VISUAL INSPECTION (TASK-103 STEP 2D)');
  console.log('='.repeat(100));

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Dataset manifest not found at ${manifestPath}`);
  }

  const manifest: DatasetManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const records: MouthInspectionRecord[] = [];

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
      console.log(`[MOUTH] ${item.id.padEnd(26)} | NO FACE DETECTED`);
      continue;
    }

    const imgRawBuffer = fs.readFileSync(imgPath);
    const origBase64 = `data:image/jpeg;base64,${imgRawBuffer.toString('base64')}`;

    for (let subIdx = 0; subIdx < faceEstimates.length; subIdx++) {
      const faceEst = faceEstimates[subIdx];
      const eyes = detectEyeLandmarks(faceEst, normImage, gradients, segResult.mask);
      const nose = detectNose(faceEst, normImage, gradients, segResult.mask, eyes);

      const t0 = performance.now();
      const mouth = detectMouth(faceEst, normImage, gradients, segResult.mask, eyes, nose);
      const latency = performance.now() - t0;

      const fissurePts = mouth.lipSeparation?.points.length ?? 0;
      const upperPts = mouth.upperLip?.points.length ?? 0;
      const lowerPts = mouth.lowerLip?.points.length ?? 0;
      const totalPoints = fissurePts + upperPts + lowerPts;

      const fissureConf = mouth.lipSeparation ? mouth.lipSeparation.confidence : 0;
      const upperConf = mouth.upperLip ? mouth.upperLip.confidence : 0;
      const lowerConf = mouth.lowerLip ? mouth.lowerLip.confidence : 0;

      records.push({
        id: item.id,
        filename: item.filename,
        category: item.category,
        subjectIndex: subIdx,
        subjectId: faceEst.subjectId,
        pose: faceEst.pose,
        latencyMs: latency,
        mouthVisibility: mouth.visibility,
        mouthConfidence: mouth.confidence,
        fissureDetected: fissurePts > 0,
        fissureConfidence: fissureConf,
        fissurePoints: fissurePts,
        upperLipDetected: upperPts > 0,
        upperLipConfidence: upperConf,
        upperLipPoints: upperPts,
        lowerLipDetected: lowerPts > 0,
        lowerLipConfidence: lowerConf,
        lowerLipPoints: lowerPts,
        leftCornerDetected: mouth.leftCorner !== undefined,
        rightCornerDetected: mouth.rightCorner !== undefined,
        totalPoints,
        origBase64,
        estimate: faceEst,
        eyes,
        nose,
        mouth,
      });

      const label = faceEstimates.length > 1 ? `${item.id} (Sub ${subIdx + 1})` : item.id;
      console.log(
        `[MOUTH] ${label.padEnd(26)} | Pose: ${faceEst.pose.padEnd(18)} | Mouth: ${mouth.visibility.padEnd(12)} (c: ${mouth.confidence.toFixed(2)}, pts: ${String(totalPoints).padStart(3)}) | Fissure: ${fissurePts > 0 ? 'YES' : 'NO '} (${fissurePts} pts) | Lips (U/L): ${upperPts > 0 ? 'YES' : 'NO '} (${upperPts} pts) / ${lowerPts > 0 ? 'YES' : 'NO '} (${lowerPts} pts) | Corners (L/R): ${mouth.leftCorner ? 'YES' : 'NO '} / ${mouth.rightCorner ? 'YES' : 'NO '} | Time: ${latency.toFixed(2)} ms`
      );
    }
  }

  const avgLatency = records.reduce((acc, r) => acc + r.latencyMs, 0) / records.length;
  console.log('-'.repeat(100));
  console.log(`Average Mouth Landmark Extraction Latency: ${avgLatency.toFixed(2)} ms`);
  console.log('='.repeat(100));

  generateHtmlReport(records, avgLatency);
}

function generateHtmlReport(records: MouthInspectionRecord[], avgLatency: number): void {
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  const rows = records
    .map((r) => {
      const faceBox = r.estimate ? r.estimate.faceBoundingBox : null;
      const mouth = r.mouth;
      const nose = r.nose;
      const eyes = r.eyes;

      const svgPaths: string[] = [];

      // Render face bounding box
      if (faceBox) {
        svgPaths.push(
          `<rect x="${(faceBox.x * 100).toFixed(2)}%" y="${(faceBox.y * 100).toFixed(2)}%" width="${(faceBox.width * 100).toFixed(2)}%" height="${(faceBox.height * 100).toFixed(2)}%" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="3,3" opacity="0.5"/>`
        );
      }

      // Render eye landmarks in translucent lime for reference
      if (eyes?.leftEye?.upperLid.points.length) {
        const pts = eyes.leftEye.upperLid.points.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`).join(' ');
        svgPaths.push(`<polyline points="${pts}" fill="none" stroke="#4ade80" stroke-width="1.5" opacity="0.3"/>`);
      }
      if (eyes?.rightEye?.upperLid.points.length) {
        const pts = eyes.rightEye.upperLid.points.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`).join(' ');
        svgPaths.push(`<polyline points="${pts}" fill="none" stroke="#4ade80" stroke-width="1.5" opacity="0.3"/>`);
      }

      // Render nose tip in translucent amber for reference
      if (nose?.tip?.points.length) {
        const pts = nose.tip.points.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`).join(' ');
        svgPaths.push(`<polyline points="${pts}" fill="none" stroke="#fbbf24" stroke-width="2" opacity="0.4"/>`);
      }

      // Render upper lip in coral pink
      if (mouth?.upperLip?.points.length) {
        const pts = mouth.upperLip.points.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`).join(' ');
        svgPaths.push(`<polyline points="${pts}" fill="none" stroke="#f43f5e" stroke-width="2.5" stroke-linecap="round"/>`);
      }

      // Render oral fissure / lip separation in electric cyan
      if (mouth?.lipSeparation?.points.length) {
        const pts = mouth.lipSeparation.points.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`).join(' ');
        svgPaths.push(`<polyline points="${pts}" fill="none" stroke="#06b6d4" stroke-width="2.5" stroke-linecap="round"/>`);
      }

      // Render lower lip in rose
      if (mouth?.lowerLip?.points.length) {
        const pts = mouth.lowerLip.points.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`).join(' ');
        svgPaths.push(`<polyline points="${pts}" fill="none" stroke="#ec4899" stroke-width="2.5" stroke-linecap="round"/>`);
      }

      // Render left mouth corner (commissure)
      if (mouth?.leftCorner) {
        svgPaths.push(
          `<circle cx="${(mouth.leftCorner.x * 100).toFixed(2)}%" cy="${(mouth.leftCorner.y * 100).toFixed(2)}%" r="3" fill="#facc15" stroke="#1e293b" stroke-width="1"/>`
        );
      }

      // Render right mouth corner (commissure)
      if (mouth?.rightCorner) {
        svgPaths.push(
          `<circle cx="${(mouth.rightCorner.x * 100).toFixed(2)}%" cy="${(mouth.rightCorner.y * 100).toFixed(2)}%" r="3" fill="#facc15" stroke="#1e293b" stroke-width="1"/>`
        );
      }

      const visBadgeClass =
        r.mouthVisibility === 'visible' ? 'badge-visible' : r.mouthVisibility === 'uncertain' ? 'badge-uncertain' : 'badge-undetected';

      return `
      <tr>
        <td><strong>${r.id}</strong><br><small style="color:#94a3b8;">${r.category} (Sub ${r.subjectIndex + 1})</small></td>
        <td><code>${r.pose}</code></td>
        <td><span class="badge ${visBadgeClass}">${r.mouthVisibility}</span> (${r.mouthConfidence.toFixed(2)})</td>
        <td>${r.fissureDetected ? `<span style="color:#06b6d4;">✓ YES (${r.fissurePoints} pts)</span>` : '<span style="color:#64748b;">NONE</span>'}</td>
        <td>${r.upperLipDetected ? `<span style="color:#f43f5e;">✓ YES (${r.upperLipPoints} pts)</span>` : '<span style="color:#64748b;">NONE</span>'}</td>
        <td>${r.lowerLipDetected ? `<span style="color:#ec4899;">✓ YES (${r.lowerLipPoints} pts)</span>` : '<span style="color:#64748b;">NONE</span>'}</td>
        <td>
          L: ${r.leftCornerDetected ? '<span style="color:#facc15;">● YES</span>' : '<span style="color:#64748b;">OCCLUDED/NONE</span>'}<br>
          R: ${r.rightCornerDetected ? '<span style="color:#facc15;">● YES</span>' : '<span style="color:#64748b;">OCCLUDED/NONE</span>'}
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
  <title>Sketch Maker - Mouth & Lips Landmark Visual Inspection Report (TASK-103 Step 2D)</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #0f172a;
      color: #f8fafc;
      margin: 0;
      padding: 24px;
    }
    h1 {
      margin-top: 0;
      color: #38bdf8;
    }
    .summary {
      background-color: #1e293b;
      padding: 16px 20px;
      border-radius: 8px;
      margin-bottom: 24px;
      display: flex;
      gap: 32px;
      align-items: center;
    }
    .summary-item {
      display: flex;
      flex-direction: column;
    }
    .summary-item .label {
      font-size: 12px;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .summary-item .value {
      font-size: 24px;
      font-weight: 700;
      color: #f8fafc;
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
    table {
      width: 100%;
      border-collapse: collapse;
      background-color: #1e293b;
      border-radius: 8px;
      overflow: hidden;
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
      color: #94a3b8;
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
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .badge-visible {
      background-color: #166534;
      color: #86efac;
    }
    .badge-uncertain {
      background-color: #854d0e;
      color: #fde047;
    }
    .badge-undetected {
      background-color: #334155;
      color: #94a3b8;
    }
    .canvas-box {
      position: relative;
      width: 160px;
      height: 160px;
      border-radius: 6px;
      overflow: hidden;
      background: #000;
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
  </style>
</head>
<body>
  <h1>Sketch Maker - Mouth & Lips Landmark Visual Inspection (TASK-103 Step 2D)</h1>
  <div class="summary">
    <div class="summary-item">
      <span class="label">Total Subjects Analyzed</span>
      <span class="value">${records.length}</span>
    </div>
    <div class="summary-item">
      <span class="label">Mouth Detected (Visible/Uncertain)</span>
      <span class="value">${records.filter((r) => r.mouthVisibility !== 'not_detected').length} / ${records.length}</span>
    </div>
    <div class="summary-item">
      <span class="label">Average Extraction Latency</span>
      <span class="value">${avgLatency.toFixed(2)} ms</span>
    </div>
    <div class="summary-item">
      <span class="label">Target Latency</span>
      <span class="value" style="color: #4ade80;">&lt; 150 ms</span>
    </div>
  </div>

  <div class="legend">
    <div class="legend-item"><div class="legend-color" style="background:#06b6d4;"></div> Oral Fissure / Lip Separation</div>
    <div class="legend-item"><div class="legend-color" style="background:#f43f5e;"></div> Upper Lip Vermilion</div>
    <div class="legend-item"><div class="legend-color" style="background:#ec4899;"></div> Lower Lip Vermilion</div>
    <div class="legend-item"><div class="legend-color" style="background:#facc15;"></div> Oral Commissures (Corners)</div>
    <div class="legend-item"><div class="legend-color" style="background:#38bdf8; border: 1px dashed #fff;"></div> Face BBox</div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Benchmark Item</th>
        <th>Pose</th>
        <th>Mouth Vis (Conf)</th>
        <th>Lip Separation</th>
        <th>Upper Lip</th>
        <th>Lower Lip</th>
        <th>Corners (L/R)</th>
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

  const reportPath = path.join(artifactsDir, 'mouth-report.html');
  fs.writeFileSync(reportPath, html, 'utf-8');
  console.log(`\nHTML visual inspection report generated at: ${reportPath}`);
}

// Direct execution
if (require.main === module) {
  runMouthInspectionSuite();
}
