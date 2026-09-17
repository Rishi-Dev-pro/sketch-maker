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
} from '../../packages/structural-analysis/src';

interface BenchmarkItem {
  id: string;
  filename: string;
  category: string;
}

interface DatasetManifest {
  categories: BenchmarkItem[];
}

export interface EyebrowInspectionRecord {
  id: string;
  filename: string;
  category: string;
  latencyMs: number;
  faceDetected: boolean;
  pose: string;
  leftBrowVisibility: string;
  rightBrowVisibility: string;
  leftBrowConf: number;
  rightBrowConf: number;
  leftPointCount: number;
  rightPointCount: number;
  origBase64: string;
  estimate: FaceRegionEstimate | null;
  eyes: EyeDetectionResult | null;
  brows: EyebrowDetectionResult | null;
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

export function runEyebrowInspectionSuite(): void {
  console.log('='.repeat(96));
  console.log('  SKETCH MAKER - EYEBROW LANDMARK VISUAL INSPECTION (TASK-103 STEP 2B)');
  console.log('='.repeat(96));

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Dataset manifest not found at ${manifestPath}`);
  }

  const manifest: DatasetManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const records: EyebrowInspectionRecord[] = [];

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

    // Face estimation & eye detection
    const faceEstimates = estimateAllFaceRegions(segResult, normImage, gradients);
    const primaryEst = faceEstimates.length > 0 ? faceEstimates[0] : null;

    const eyes = primaryEst
      ? detectEyeLandmarks(primaryEst, normImage, gradients, segResult.mask)
      : null;

    // Eyebrow detection timed
    const t0 = performance.now();
    const brows = primaryEst
      ? detectEyebrows(primaryEst, normImage, gradients, segResult.mask, eyes ?? undefined)
      : null;
    const t1 = performance.now();
    const latencyMs = Number((t1 - t0).toFixed(2));

    const leftBrow = brows?.leftEyebrow;
    const rightBrow = brows?.rightEyebrow;

    const leftPointCount = leftBrow?.points.length ?? 0;
    const rightPointCount = rightBrow?.points.length ?? 0;

    records.push({
      id: item.id,
      filename: item.filename,
      category: item.category,
      latencyMs,
      faceDetected: primaryEst !== null,
      pose: primaryEst ? primaryEst.pose : 'none',
      leftBrowVisibility: leftBrow?.visibility ?? 'none',
      rightBrowVisibility: rightBrow?.visibility ?? 'none',
      leftBrowConf: leftBrow?.confidence ?? 0,
      rightBrowConf: rightBrow?.confidence ?? 0,
      leftPointCount,
      rightPointCount,
      origBase64: fs.readFileSync(imgPath).toString('base64'),
      estimate: primaryEst,
      eyes,
      brows,
      subjectBox: segResult.boundingBox,
    });

    console.log(
      `[BROWS] ${item.id.padEnd(23)} | ` +
      `Pose: ${(primaryEst ? primaryEst.pose : 'none').padEnd(18)} | ` +
      `L-Brow: ${(leftBrow?.visibility ?? 'none').padEnd(10)} (c: ${(leftBrow?.confidence?.toFixed(2) ?? '0.00')}, pts: ${String(leftPointCount).padStart(3)}) | ` +
      `R-Brow: ${(rightBrow?.visibility ?? 'none').padEnd(10)} (c: ${(rightBrow?.confidence?.toFixed(2) ?? '0.00')}, pts: ${String(rightPointCount).padStart(3)}) | ` +
      `Time: ${latencyMs.toFixed(2)} ms`
    );
  }

  const avgLatency = records.reduce((acc, r) => acc + r.latencyMs, 0) / records.length;
  console.log('-'.repeat(96));
  console.log(`Average Eyebrow Landmark Extraction Latency: ${avgLatency.toFixed(2)} ms`);
  console.log('='.repeat(96));

  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  const htmlContent = generateEyebrowReportHtml(records, avgLatency);
  const reportPath = path.join(artifactsDir, 'eyebrow-report.html');
  fs.writeFileSync(reportPath, htmlContent, 'utf-8');
  console.log(`[REPORT GENERATED] Eyebrow visual inspection report written to: ${reportPath}\n`);
}

function generateEyebrowReportHtml(records: EyebrowInspectionRecord[], avgLatency: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Sketch Maker - Eyebrow Landmark Visual Inspection (TASK-103 Step 2B)</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --text-muted: #8b949e;
      --accent: #58a6ff;
      --brow: #d29922;
      --brow-light: #f0883e;
      --lid: #2ea043;
      --success: #238636;
      --warning: #d29922;
      --danger: #da3633;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 24px;
    }
    header {
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
    }
    h1 {
      margin: 0 0 8px 0;
      font-size: 24px;
      color: #fff;
    }
    .summary-bar {
      display: flex;
      gap: 24px;
      margin-bottom: 24px;
      background: var(--card-bg);
      padding: 16px;
      border-radius: 8px;
      border: 1px solid var(--border);
    }
    .metric {
      font-size: 20px;
      font-weight: bold;
      color: #fff;
    }
    .label {
      font-size: 12px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .legend {
      display: flex;
      gap: 16px;
      margin-bottom: 16px;
      font-size: 12px;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .box-indicator {
      width: 14px;
      height: 14px;
      border-radius: 3px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
      gap: 20px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .card-header {
      padding: 10px 14px;
      background: #1f242c;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .card-title {
      font-weight: 600;
      font-size: 13px;
    }
    .badge {
      font-size: 10px;
      padding: 2px 8px;
      border-radius: 12px;
      background: #238636;
      color: #fff;
      font-weight: bold;
      text-transform: uppercase;
    }
    .badge.profile {
      background: #8957e5;
    }
    .stage {
      position: relative;
      width: 100%;
      aspect-ratio: 1;
      background: #000;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .stage img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      opacity: 0.85;
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
      padding: 12px;
      font-size: 12px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px 12px;
    }
  </style>
</head>
<body>
  <header>
    <h1>Sketch Maker — Eyebrow Landmark Visual Inspection</h1>
    <p style="color: var(--text-muted); margin: 0; font-size: 14px;">
      TASK-103 Step 2B: Pure TypeScript Eyebrow Ridge Tracing & Pose-Driven Suppression
    </p>
  </header>

  <div class="summary-bar">
    <div>
      <div class="metric">${records.length}</div>
      <div class="label">Benchmark Images</div>
    </div>
    <div>
      <div class="metric">${avgLatency.toFixed(2)} ms</div>
      <div class="label">Avg Extraction Latency</div>
    </div>
    <div>
      <div class="metric">${records.filter(r => r.leftBrowVisibility === 'visible' || r.rightBrowVisibility === 'visible').length} / 12</div>
      <div class="label">Faces with Visible Brows</div>
    </div>
    <div>
      <div class="metric">${records.filter(r => r.pose.includes('profile')).length}</div>
      <div class="label">Profile Faces (Occluded Side Verified)</div>
    </div>
  </div>

  <div class="legend">
    <div class="legend-item"><div class="box-indicator" style="border: 2px solid #58a6ff;"></div> Face Zone</div>
    <div class="legend-item"><div class="box-indicator" style="border: 2px solid #2ea043;"></div> Eyelids</div>
    <div class="legend-item"><div class="box-indicator" style="border: 2px solid #d29922;"></div> Left Eyebrow</div>
    <div class="legend-item"><div class="box-indicator" style="border: 2px solid #f0883e;"></div> Right Eyebrow</div>
  </div>

  <div class="grid">
    ${records.map(r => {
      const e = r.estimate;
      const eyes = r.eyes;
      const brows = r.brows;
      const isProfile = r.pose.includes('profile');

      function pointsToSvgPolyline(pts?: { x: number; y: number }[]): string {
        if (!pts || pts.length === 0) return '';
        return pts.map(p => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`).join(' ');
      }

      const leftUpper = pointsToSvgPolyline(eyes?.leftEye?.upperLid.points);
      const leftLower = pointsToSvgPolyline(eyes?.leftEye?.lowerLid.points);
      const rightUpper = pointsToSvgPolyline(eyes?.rightEye?.upperLid.points);
      const rightLower = pointsToSvgPolyline(eyes?.rightEye?.lowerLid.points);

      const leftBrowPath = pointsToSvgPolyline(brows?.leftEyebrow?.points);
      const rightBrowPath = pointsToSvgPolyline(brows?.rightEyebrow?.points);

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

            <!-- Eye Contours for spatial reference -->
            ${leftUpper ? `<polyline points="${leftUpper}" fill="none" stroke="#2ea043" stroke-width="1.2" stroke-linecap="round" />` : ''}
            ${leftLower ? `<polyline points="${leftLower}" fill="none" stroke="#2ea043" stroke-width="0.8" stroke-linecap="round" />` : ''}
            ${rightUpper ? `<polyline points="${rightUpper}" fill="none" stroke="#2ea043" stroke-width="1.2" stroke-linecap="round" />` : ''}
            ${rightLower ? `<polyline points="${rightLower}" fill="none" stroke="#2ea043" stroke-width="0.8" stroke-linecap="round" />` : ''}

            <!-- Eyebrow Paths -->
            ${leftBrowPath ? `<polyline points="${leftBrowPath}" fill="none" stroke="#d29922" stroke-width="2.2" stroke-linecap="round" />` : ''}
            ${rightBrowPath ? `<polyline points="${rightBrowPath}" fill="none" stroke="#f0883e" stroke-width="2.2" stroke-linecap="round" />` : ''}
          </svg>
        </div>
        <div class="card-body">
          <div><span class="label">Left Brow Visibility:</span> <span>${r.leftBrowVisibility} (c: ${r.leftBrowConf.toFixed(2)})</span></div>
          <div><span class="label">Right Brow Visibility:</span> <span>${r.rightBrowVisibility} (c: ${r.rightBrowConf.toFixed(2)})</span></div>
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

runEyebrowInspectionSuite();
