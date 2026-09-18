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
  detectEyebrows,
  EyebrowDetectionResult,
  detectNose,
  NoseDetectionResult,
  detectMouth,
  MouthDetectionResult,
  detectJawline,
  JawlineDetectionResult,
} from '../../packages/structural-analysis/src';
import { detectEars, EarDetectionResult } from '../../packages/structural-analysis/src/ears';

interface BenchmarkItem {
  id: string;
  filename: string;
  category: string;
}

interface DatasetManifest {
  categories: BenchmarkItem[];
}

export interface EarInspectionRecord {
  id: string;
  filename: string;
  category: string;
  subjectIndex: number;
  subjectId: string;
  pose: string;
  latencyMs: number;
  overallVisibility: string;
  overallConfidence: number;
  leftVisibility: string;
  leftDetected: boolean;
  leftConfidence: number;
  leftPoints: number;
  rightVisibility: string;
  rightDetected: boolean;
  rightConfidence: number;
  rightPoints: number;
  totalPoints: number;
  origBase64: string;
  estimate: FaceRegionEstimate | null;
  eyes: EyeDetectionResult | null;
  brows: EyebrowDetectionResult | null;
  nose: NoseDetectionResult | null;
  mouth: MouthDetectionResult | null;
  jawline: JawlineDetectionResult | null;
  ears: EarDetectionResult | null;
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

export function runEarInspectionSuite(): void {
  console.log('='.repeat(100));
  console.log('  SKETCH MAKER - EAR LANDMARK & CONTOUR VISUAL INSPECTION (TASK-103 STEP 2E.2)');
  console.log('='.repeat(100));

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Dataset manifest not found at ${manifestPath}`);
  }

  const manifest: DatasetManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const records: EarInspectionRecord[] = [];

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
      console.log(`[EARS] ${item.id.padEnd(26)} | NO FACE DETECTED`);
      continue;
    }

    const imgRawBuffer = fs.readFileSync(imgPath);
    const origBase64 = `data:image/jpeg;base64,${imgRawBuffer.toString('base64')}`;

    for (let subIdx = 0; subIdx < faceEstimates.length; subIdx++) {
      const faceEst = faceEstimates[subIdx];
      const eyes = detectEyeLandmarks(faceEst, normImage, gradients, segResult.mask);
      const brows = detectEyebrows(faceEst, normImage, gradients, segResult.mask, eyes);
      const nose = detectNose(faceEst, normImage, gradients, segResult.mask, eyes);
      const mouth = detectMouth(faceEst, normImage, gradients, segResult.mask, eyes, nose);
      const jawline = detectJawline(faceEst, normImage, gradients, segResult.mask, eyes, nose, mouth);

      const t0 = performance.now();
      const ears = detectEars(
        faceEst,
        normImage,
        gradients,
        segResult.mask,
        eyes,
        brows,
        nose,
        mouth,
        jawline
      );
      const latency = performance.now() - t0;

      const leftPts = ears.leftEar?.points.length ?? 0;
      const rightPts = ears.rightEar?.points.length ?? 0;
      const totalPoints = leftPts + rightPts;

      const leftConf = ears.leftEar?.confidence ?? 0;
      const rightConf = ears.rightEar?.confidence ?? 0;

      records.push({
        id: item.id,
        filename: item.filename,
        category: item.category,
        subjectIndex: subIdx,
        subjectId: faceEst.subjectId,
        pose: faceEst.pose,
        latencyMs: latency,
        overallVisibility: ears.visibility,
        overallConfidence: ears.confidence,
        leftVisibility: ears.leftVisibility,
        leftDetected: leftPts > 0,
        leftConfidence: leftConf,
        leftPoints: leftPts,
        rightVisibility: ears.rightVisibility,
        rightDetected: rightPts > 0,
        rightConfidence: rightConf,
        rightPoints: rightPts,
        totalPoints,
        origBase64,
        estimate: faceEst,
        eyes,
        brows,
        nose,
        mouth,
        jawline,
        ears,
      });

      const label = faceEstimates.length > 1 ? `${item.id} (Sub ${subIdx + 1})` : item.id;
      console.log(
        `[EARS] ${label.padEnd(26)} | Pose: ${faceEst.pose.padEnd(18)} | Overall: ${ears.visibility.padEnd(12)} (c: ${ears.confidence.toFixed(2)}) | L: ${ears.leftVisibility.padEnd(12)} (${leftPts} pts, c: ${leftConf.toFixed(2)}) | R: ${ears.rightVisibility.padEnd(12)} (${rightPts} pts, c: ${rightConf.toFixed(2)}) | Time: ${latency.toFixed(2)} ms`
      );
    }
  }

  const avgLatency = records.reduce((acc, r) => acc + r.latencyMs, 0) / records.length;
  console.log('-'.repeat(100));
  console.log(`Average Ear Landmark Extraction Latency: ${avgLatency.toFixed(2)} ms`);
  console.log('='.repeat(100));

  generateHtmlReport(records, avgLatency);
}

function generateHtmlReport(records: EarInspectionRecord[], avgLatency: number): void {
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  const rows = records
    .map((r) => {
      const faceBox = r.estimate ? r.estimate.faceBoundingBox : null;
      const ears = r.ears;
      const jaw = r.jawline;
      const mouth = r.mouth;
      const nose = r.nose;
      const eyes = r.eyes;

      const svgPaths: string[] = [];

      // Render face bounding box
      if (faceBox) {
        svgPaths.push(
          `<rect x="${(faceBox.x * 100).toFixed(2)}%" y="${(faceBox.y * 100).toFixed(2)}%" width="${(faceBox.width * 100).toFixed(2)}%" height="${(faceBox.height * 100).toFixed(2)}%" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="3,3" opacity="0.3"/>`
        );
      }

      // Render eyes in muted translucent green
      if (eyes?.leftEye?.upperLid.points.length) {
        const pts = eyes.leftEye.upperLid.points.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`).join(' ');
        svgPaths.push(`<polyline points="${pts}" fill="none" stroke="#4ade80" stroke-width="1.2" opacity="0.3"/>`);
      }
      if (eyes?.rightEye?.upperLid.points.length) {
        const pts = eyes.rightEye.upperLid.points.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`).join(' ');
        svgPaths.push(`<polyline points="${pts}" fill="none" stroke="#4ade80" stroke-width="1.2" opacity="0.3"/>`);
      }

      // Render jawline in muted translucent sky blue
      if (jaw?.jawline?.points.length) {
        const pts = jaw.jawline.points.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`).join(' ');
        svgPaths.push(`<polyline points="${pts}" fill="none" stroke="#38bdf8" stroke-width="1.5" opacity="0.3"/>`);
      }

      // Render Left Ear in bright cyan / teal (#06b6d4)
      if (ears?.leftEar?.points.length) {
        const pts = ears.leftEar.points.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`).join(' ');
        svgPaths.push(`<polyline points="${pts}" fill="none" stroke="#06b6d4" stroke-width="3" stroke-linecap="round"/>`);
        for (const pt of ears.leftEar.points) {
          svgPaths.push(`<circle cx="${(pt.x * 100).toFixed(2)}%" cy="${(pt.y * 100).toFixed(2)}%" r="2" fill="#22d3ee"/>`);
        }
      }

      // Render Right Ear in bright amber / orange (#f59e0b)
      if (ears?.rightEar?.points.length) {
        const pts = ears.rightEar.points.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`).join(' ');
        svgPaths.push(`<polyline points="${pts}" fill="none" stroke="#f59e0b" stroke-width="3" stroke-linecap="round"/>`);
        for (const pt of ears.rightEar.points) {
          svgPaths.push(`<circle cx="${(pt.x * 100).toFixed(2)}%" cy="${(pt.y * 100).toFixed(2)}%" r="2" fill="#fbbf24"/>`);
        }
      }

      const visBadgeClass =
        r.overallVisibility === 'visible'
          ? 'badge-visible'
          : r.overallVisibility === 'uncertain'
          ? 'badge-uncertain'
          : r.overallVisibility === 'occluded'
          ? 'badge-occluded'
          : 'badge-undetected';

      const leftBadgeClass =
        r.leftVisibility === 'visible'
          ? 'badge-visible'
          : r.leftVisibility === 'uncertain'
          ? 'badge-uncertain'
          : r.leftVisibility === 'occluded'
          ? 'badge-occluded'
          : 'badge-undetected';

      const rightBadgeClass =
        r.rightVisibility === 'visible'
          ? 'badge-visible'
          : r.rightVisibility === 'uncertain'
          ? 'badge-uncertain'
          : r.rightVisibility === 'occluded'
          ? 'badge-occluded'
          : 'badge-undetected';

      return `
      <tr>
        <td><strong>${r.id}</strong><br><small style="color:#94a3b8;">${r.category} (Sub ${r.subjectIndex + 1})</small></td>
        <td><code>${r.pose}</code></td>
        <td><span class="badge ${visBadgeClass}">${r.overallVisibility}</span> (${r.overallConfidence.toFixed(2)})</td>
        <td><span class="badge ${leftBadgeClass}">${r.leftVisibility}</span> (${r.leftPoints} pts, c: ${r.leftConfidence.toFixed(2)})</td>
        <td><span class="badge ${rightBadgeClass}">${r.rightVisibility}</span> (${r.rightPoints} pts, c: ${r.rightConfidence.toFixed(2)})</td>
        <td>${r.totalPoints}</td>
        <td>${r.latencyMs.toFixed(2)} ms</td>
        <td style="padding: 6px; text-align: center;">
          <div style="position: relative; width: 140px; height: 140px; margin: 0 auto; background: #000; border-radius: 6px; overflow: hidden;">
            <img src="${r.origBase64}" style="width: 100%; height: 100%; object-fit: cover; opacity: 0.7;" />
            <svg viewBox="0 0 100 100" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;">
              ${svgPaths.join('\n')}
            </svg>
          </div>
        </td>
      </tr>
      `;
    })
    .join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Ear Landmark Detection Visual Audit (TASK-103 Step 2E.2)</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 24px; }
    h1 { margin-top: 0; font-size: 24px; color: #38bdf8; }
    .meta { color: #94a3b8; font-size: 14px; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 13px; }
    th, td { border: 1px solid #334155; padding: 8px 12px; text-align: left; vertical-align: middle; }
    th { background: #1e293b; color: #e2e8f0; }
    tr:nth-child(even) { background: #1e293b40; }
    .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
    .badge-visible { background: #065f46; color: #34d399; }
    .badge-uncertain { background: #854d0e; color: #facc15; }
    .badge-occluded { background: #3730a3; color: #a5b4fc; }
    .badge-undetected { background: #334155; color: #94a3b8; }
    .legend { display: flex; gap: 16px; margin-top: 12px; font-size: 13px; color: #cbd5e1; }
    .legend-item { display: flex; align-items: center; gap: 6px; }
    .color-box { width: 12px; height: 12px; border-radius: 2px; }
  </style>
</head>
<body>
  <h1>Ear Landmark & Contour Visual Audit (TASK-103 Step 2E.2)</h1>
  <div class="meta">
    Evaluated across all 12 standard benchmark categories | Average Extraction Latency: <strong>${avgLatency.toFixed(2)} ms</strong> | Zero External Model Dependencies (Pure TS)
  </div>

  <div class="legend">
    <div class="legend-item"><div class="color-box" style="background:#06b6d4;"></div> Left Ear (Cyan)</div>
    <div class="legend-item"><div class="color-box" style="background:#f59e0b;"></div> Right Ear (Amber)</div>
    <div class="legend-item"><div class="color-box" style="background:#38bdf8; opacity:0.3;"></div> Face Box & Jawline (Muted Sky)</div>
    <div class="legend-item"><div class="color-box" style="background:#4ade80; opacity:0.3;"></div> Eyes (Muted Green)</div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Benchmark Image</th>
        <th>Estimated Pose</th>
        <th>Overall Status</th>
        <th>Left Ear (Subject)</th>
        <th>Right Ear (Subject)</th>
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

  const reportPath = path.join(artifactsDir, 'ear-report.html');
  fs.writeFileSync(reportPath, html, 'utf-8');
  console.log(`\nVisual Inspection HTML Report saved to: ${reportPath}`);
}

// Direct CLI invocation
if (require.main === module) {
  runEarInspectionSuite();
}
