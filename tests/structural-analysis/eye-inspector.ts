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
} from '../../packages/structural-analysis/src';

interface BenchmarkItem {
  id: string;
  filename: string;
  category: string;
}

interface DatasetManifest {
  categories: BenchmarkItem[];
}

export interface EyeInspectionRecord {
  id: string;
  filename: string;
  category: string;
  latencyMs: number;
  faceDetected: boolean;
  pose: string;
  leftEyeVisibility: string;
  rightEyeVisibility: string;
  leftEyeConf: number;
  rightEyeConf: number;
  hasLeftIris: boolean;
  hasLeftPupil: boolean;
  hasRightIris: boolean;
  hasRightPupil: boolean;
  leftPointCount: number;
  rightPointCount: number;
  origBase64: string;
  estimate: FaceRegionEstimate | null;
  eyes: EyeDetectionResult | null;
  subjectBox: { x: number; y: number; width: number; height: number };
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

export function runEyeInspectionSuite(): EyeInspectionRecord[] {
  console.log('='.repeat(96));
  console.log('  SKETCH MAKER - EYE & EYELID LANDMARK VISUAL INSPECTION (TASK-103 STEP 2A)');
  console.log('='.repeat(96));

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Dataset manifest missing at: ${manifestPath}`);
  }

  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  const manifest: DatasetManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const records: EyeInspectionRecord[] = [];

  for (const item of manifest.categories) {
    const imgPath = path.join(imagesDir, item.filename);
    const pixelBuf = decodeJpeg(imgPath);

    // Preprocessing & segmentation
    const normImage = preprocessPixelBuffer(pixelBuf, {
      targetDimension: 1024,
      normalizeLighting: false,
    });
    const segResult = segmentSubject(normImage);
    const gradients = computeSobelGradients(normImage.luminance);

    // Face estimation
    const faceEstimates = estimateAllFaceRegions(segResult, normImage, gradients);
    const primaryEst = faceEstimates.length > 0 ? faceEstimates[0] : null;

    // Eye detection timed
    const t0 = performance.now();
    const eyes = primaryEst
      ? detectEyeLandmarks(primaryEst, normImage, gradients, segResult.mask)
      : null;
    const t1 = performance.now();
    const latencyMs = Number((t1 - t0).toFixed(2));

    const leftEye = eyes?.leftEye;
    const rightEye = eyes?.rightEye;

    const leftPointCount = (leftEye?.upperLid.points.length ?? 0) + (leftEye?.lowerLid.points.length ?? 0);
    const rightPointCount = (rightEye?.upperLid.points.length ?? 0) + (rightEye?.lowerLid.points.length ?? 0);
    const hasLeftIris = Boolean(leftEye?.iris);
    const hasLeftPupil = Boolean(leftEye?.pupil);
    const hasRightIris = Boolean(rightEye?.iris);
    const hasRightPupil = Boolean(rightEye?.pupil);

    records.push({
      id: item.id,
      filename: item.filename,
      category: item.category,
      latencyMs,
      faceDetected: primaryEst !== null,
      pose: primaryEst ? primaryEst.pose : 'none',
      leftEyeVisibility: leftEye?.visibility ?? 'none',
      rightEyeVisibility: rightEye?.visibility ?? 'none',
      leftEyeConf: leftEye?.confidence ?? 0,
      rightEyeConf: rightEye?.confidence ?? 0,
      hasLeftIris,
      hasLeftPupil,
      hasRightIris,
      hasRightPupil,
      leftPointCount,
      rightPointCount,
      origBase64: fs.readFileSync(imgPath).toString('base64'),
      estimate: primaryEst,
      eyes,
      subjectBox: segResult.boundingBox,
    });

    console.log(
      `[EYES] ${item.id.padEnd(23)} | ` +
      `Pose: ${(primaryEst ? primaryEst.pose : 'none').padEnd(18)} | ` +
      `L-Eye: ${(leftEye?.visibility ?? 'none').padEnd(10)} (c: ${(leftEye?.confidence?.toFixed(2) ?? '0.00')}, pts: ${String(leftPointCount).padStart(3)}) | ` +
      `R-Eye: ${(rightEye?.visibility ?? 'none').padEnd(10)} (c: ${(rightEye?.confidence?.toFixed(2) ?? '0.00')}, pts: ${String(rightPointCount).padStart(3)}) | ` +
      `Iris(L/R): ${hasLeftIris ? 'YES' : 'NO '}/${hasRightIris ? 'YES' : 'NO '} | Pupil(L/R): ${hasLeftPupil ? 'YES' : 'NO '}/${hasRightPupil ? 'YES' : 'NO '} | ` +
      `Time: ${latencyMs.toFixed(2)} ms`
    );
  }

  const avgLatency = records.reduce((acc, r) => acc + r.latencyMs, 0) / records.length;
  console.log('-'.repeat(96));
  console.log(`Average Eye & Eyelid Landmark Extraction Latency: ${avgLatency.toFixed(2)} ms`);
  console.log('='.repeat(96));

  // Generate HTML report
  const htmlReport = generateEyeHtmlReport(records, avgLatency);
  const reportPath = path.join(artifactsDir, 'eye-report.html');
  fs.writeFileSync(reportPath, htmlReport, 'utf8');
  console.log(`[REPORT GENERATED] Eye visual inspection report written to: ${reportPath}`);

  return records;
}

function generateEyeHtmlReport(records: EyeInspectionRecord[], avgLatency: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Sketch Maker - Eye & Eyelid Landmarks Inspection (TASK-103 Step 2A)</title>
  <style>
    :root {
      --bg: #0d1117;
      --surface: #161b22;
      --border: #30363d;
      --accent: #58a6ff;
      --text: #c9d1d9;
      --text-dim: #8b949e;
      --pass: #2ea043;
      --warning: #d29922;
      --error: #f85149;
    }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      margin: 0;
      padding: 24px;
    }
    h1 { color: #f0f6fc; margin-bottom: 8px; font-size: 24px; }
    .meta { color: var(--text-dim); margin-bottom: 24px; font-size: 13px; }
    .summary-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px 20px;
      display: flex;
      gap: 32px;
      margin-bottom: 24px;
    }
    .metric { font-size: 24px; font-weight: 700; color: var(--accent); }
    .label { font-size: 11px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
      gap: 20px;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .card-header {
      padding: 10px 14px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: rgba(255,255,255,0.02);
    }
    .card-title { font-weight: 600; font-size: 13px; color: #f0f6fc; }
    .badge {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 12px;
      background: rgba(88, 166, 255, 0.15);
      color: var(--accent);
      border: 1px solid rgba(88, 166, 255, 0.3);
    }
    .badge.profile {
      background: rgba(210, 153, 34, 0.15);
      color: var(--warning);
      border-color: rgba(210, 153, 34, 0.3);
    }
    .stage {
      position: relative;
      width: 100%;
      height: 280px;
      background: #000;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .stage img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
    .overlay-svg {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }
    .card-body {
      padding: 12px 16px;
      font-size: 12px;
      line-height: 1.6;
    }
    .card-body div {
      display: flex;
      justify-content: space-between;
      border-bottom: 1px solid rgba(255,255,255,0.05);
      padding: 2px 0;
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      font-size: 12px;
      margin-bottom: 16px;
      padding: 8px 12px;
      background: var(--surface);
      border-radius: 6px;
      border: 1px solid var(--border);
    }
    .legend-item { display: flex; align-items: center; gap: 6px; }
    .box-indicator { width: 12px; height: 12px; border-radius: 2px; }
  </style>
</head>
<body>
  <h1>Sketch Maker - Eye & Eyelid Landmark Inspection</h1>
  <div class="meta">Phase 1: Feasibility Prototype | TASK-103 Step 2A | Generated: ${new Date().toISOString()}</div>

  <div class="summary-card">
    <div>
      <div class="metric">${records.length} / 12</div>
      <div class="label">Categories Evaluated</div>
    </div>
    <div>
      <div class="metric">${avgLatency.toFixed(2)} ms</div>
      <div class="label">Avg Eye Extraction Latency</div>
    </div>
    <div>
      <div class="metric">${records.filter(r => r.leftEyeVisibility === 'visible' || r.rightEyeVisibility === 'visible').length} / 12</div>
      <div class="label">Faces with Visible Eyes</div>
    </div>
    <div>
      <div class="metric">${records.filter(r => r.hasLeftIris || r.hasRightIris).length} / 12</div>
      <div class="label">Faces with Resolved Iris</div>
    </div>
  </div>

  <div class="legend">
    <div class="legend-item"><div class="box-indicator" style="border: 2px solid #58a6ff;"></div> Face Zone</div>
    <div class="legend-item"><div class="box-indicator" style="border: 2px solid #2ea043;"></div> Upper Eyelid</div>
    <div class="legend-item"><div class="box-indicator" style="border: 2px solid #3fb950;"></div> Lower Eyelid</div>
    <div class="legend-item"><div class="box-indicator" style="background: #a371f7; border-radius: 50%;"></div> Iris Center</div>
    <div class="legend-item"><div class="box-indicator" style="background: #f85149; border-radius: 50%;"></div> Pupil Center</div>
  </div>

  <div class="grid">
    ${records.map(r => {
      const e = r.estimate;
      const eyes = r.eyes;
      const isProfile = r.pose.includes('profile');

      function pointsToSvgPolyline(pts?: { x: number; y: number }[]): string {
        if (!pts || pts.length === 0) return '';
        return pts.map(p => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`).join(' ');
      }

      const leftUpper = pointsToSvgPolyline(eyes?.leftEye?.upperLid.points);
      const leftLower = pointsToSvgPolyline(eyes?.leftEye?.lowerLid.points);
      const rightUpper = pointsToSvgPolyline(eyes?.rightEye?.upperLid.points);
      const rightLower = pointsToSvgPolyline(eyes?.rightEye?.lowerLid.points);

      return `
      <div class="card">
        <div class="card-header">
          <span class="card-title">${r.id} (${r.category})</span>
          <span class="badge ${isProfile ? 'profile' : ''}">${r.pose}</span>
        </div>
        <div class="stage">
          <img src="data:image/jpeg;base64,${r.origBase64}" alt="${r.id}">
          <svg class="overlay-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
            ${e ? `
              <!-- Face Box -->
              <rect x="${(e.faceBoundingBox.x * 100).toFixed(1)}" y="${(e.faceBoundingBox.y * 100).toFixed(1)}"
                    width="${(e.faceBoundingBox.width * 100).toFixed(1)}" height="${(e.faceBoundingBox.height * 100).toFixed(1)}"
                    fill="none" stroke="#58a6ff" stroke-width="0.8" stroke-dasharray="2,2" />
            ` : ''}

            <!-- Left Eye Contours -->
            ${leftUpper ? `<polyline points="${leftUpper}" fill="none" stroke="#2ea043" stroke-width="1.6" stroke-linecap="round" />` : ''}
            ${leftLower ? `<polyline points="${leftLower}" fill="none" stroke="#3fb950" stroke-width="1.2" stroke-linecap="round" />` : ''}
            ${eyes?.leftEye?.iris ? `<circle cx="${(eyes.leftEye.iris.x * 100).toFixed(2)}" cy="${(eyes.leftEye.iris.y * 100).toFixed(2)}" r="1.5" fill="#a371f7" />` : ''}
            ${eyes?.leftEye?.pupil ? `<circle cx="${(eyes.leftEye.pupil.x * 100).toFixed(2)}" cy="${(eyes.leftEye.pupil.y * 100).toFixed(2)}" r="0.8" fill="#f85149" />` : ''}

            <!-- Right Eye Contours -->
            ${rightUpper ? `<polyline points="${rightUpper}" fill="none" stroke="#2ea043" stroke-width="1.6" stroke-linecap="round" />` : ''}
            ${rightLower ? `<polyline points="${rightLower}" fill="none" stroke="#3fb950" stroke-width="1.2" stroke-linecap="round" />` : ''}
            ${eyes?.rightEye?.iris ? `<circle cx="${(eyes.rightEye.iris.x * 100).toFixed(2)}" cy="${(eyes.rightEye.iris.y * 100).toFixed(2)}" r="1.5" fill="#a371f7" />` : ''}
            ${eyes?.rightEye?.pupil ? `<circle cx="${(eyes.rightEye.pupil.x * 100).toFixed(2)}" cy="${(eyes.rightEye.pupil.y * 100).toFixed(2)}" r="0.8" fill="#f85149" />` : ''}
          </svg>
        </div>
        <div class="card-body">
          <div><span class="label">Left Eye Visibility:</span> <span>${r.leftEyeVisibility} (conf: ${r.leftEyeConf.toFixed(2)})</span></div>
          <div><span class="label">Right Eye Visibility:</span> <span>${r.rightEyeVisibility} (conf: ${r.rightEyeConf.toFixed(2)})</span></div>
          <div><span class="label">Iris (L / R):</span> <span>${r.hasLeftIris ? 'YES' : 'NO'} / ${r.hasRightIris ? 'YES' : 'NO'}</span></div>
          <div><span class="label">Pupil (L / R):</span> <span>${r.hasLeftPupil ? 'YES' : 'NO'} / ${r.hasRightPupil ? 'YES' : 'NO'}</span></div>
          <div><span class="label">Contour Points:</span> <span>Left: ${r.leftPointCount}, Right: ${r.rightPointCount}</span></div>
          <div><span class="label">Latency:</span> <span>${r.latencyMs} ms</span></div>
        </div>
      </div>
    `;
    }).join('')}
  </div>
</body>
</html>`;
}

runEyeInspectionSuite();
