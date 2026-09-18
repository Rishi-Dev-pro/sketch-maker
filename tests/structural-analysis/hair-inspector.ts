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
  detectEars,
  EarDetectionResult,
  detectHair,
  HairDetectionResult,
} from '../../packages/structural-analysis/src';

interface BenchmarkItem {
  id: string;
  filename: string;
  category: string;
}

interface DatasetManifest {
  categories: BenchmarkItem[];
}

export interface HairInspectionRecord {
  id: string;
  filename: string;
  category: string;
  subjectIndex: number;
  subjectId: string;
  pose: string;
  hairLatencyMs: number;
  cumulativeLatencyMs: number;
  visibility: string;
  confidence: number;
  styleEstimate: string;
  isVoluminous: boolean;
  hairlineDetected: boolean;
  hairlinePoints: number;
  hairlineConfidence: number;
  outerSilhouetteDetected: boolean;
  outerPoints: number;
  outerConfidence: number;
  massesCount: number;
  totalHairPoints: number;
  directionalFlowAngle?: number;
  origBase64: string;
  estimate: FaceRegionEstimate | null;
  hair: HairDetectionResult | null;
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

export function runHairInspectionSuite(): void {
  console.log('='.repeat(105));
  console.log('  SKETCH MAKER - HAIR STRUCTURE DETECTION BENCHMARK & VISUAL AUDIT (TASK-103 STEP 2F)');
  console.log('='.repeat(105));

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Dataset manifest not found at ${manifestPath}`);
  }

  const manifest: DatasetManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const records: HairInspectionRecord[] = [];

  for (const item of manifest.categories) {
    const imgPath = path.join(imagesDir, item.filename);
    const pixelBuf = decodeJpeg(imgPath);

    const totalT0 = performance.now();

    const normImage = preprocessPixelBuffer(pixelBuf, {
      targetDimension: 1024,
      normalizeLighting: false,
    });
    const segResult = segmentSubject(normImage);
    const gradients = computeSobelGradients(normImage.luminance);

    // Multi-subject face estimation (e.g. BM-11)
    const faceEstimates = estimateAllFaceRegions(segResult, normImage, gradients);

    if (faceEstimates.length === 0) {
      console.log(`[HAIR] ${item.id.padEnd(26)} | NO FACE DETECTED`);
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
      const ears = detectEars(faceEst, normImage, gradients, segResult.mask, eyes, brows, nose, mouth, jawline);

      const hairT0 = performance.now();
      const hair = detectHair(
        faceEst,
        normImage,
        gradients,
        segResult.mask,
        brows,
        eyes,
        jawline,
        ears
      );
      const hairLatency = performance.now() - hairT0;
      const cumulativeLatency = performance.now() - totalT0;

      const hairlinePts = hair.hairline?.points.length ?? 0;
      const outerPts = hair.outerSilhouette?.points.length ?? 0;
      const massesPts = hair.masses.reduce((acc, m) => acc + m.points.length, 0);
      const totalPoints = hairlinePts + outerPts + massesPts;

      records.push({
        id: item.id,
        filename: item.filename,
        category: item.category,
        subjectIndex: subIdx,
        subjectId: faceEst.subjectId,
        pose: faceEst.pose,
        hairLatencyMs: hairLatency,
        cumulativeLatencyMs: cumulativeLatency,
        visibility: hair.visibility,
        confidence: hair.confidence,
        styleEstimate: hair.styleEstimate ?? 'uncertain',
        isVoluminous: !!hair.isVoluminous,
        hairlineDetected: !!hair.hairline,
        hairlinePoints: hairlinePts,
        hairlineConfidence: hair.hairline?.confidence ?? 0,
        outerSilhouetteDetected: !!hair.outerSilhouette,
        outerPoints: outerPts,
        outerConfidence: hair.outerSilhouette?.confidence ?? 0,
        massesCount: hair.masses.length,
        totalHairPoints: totalPoints,
        directionalFlowAngle: hair.directionalFlowAngle,
        origBase64,
        estimate: faceEst,
        hair,
      });

      const hairlineTag = hair.hairline ? `HL:${hairlinePts}pts` : 'HL:none';
      const outerTag = hair.outerSilhouette ? `OUT:${outerPts}pts` : 'OUT:none';
      const massTag = `MASS:${hair.masses.length}`;
      const styleTag = `[${hair.styleEstimate ?? 'unknown'}]`;

      console.log(
        `[HAIR] ${item.id.padEnd(24)} | Sub #${subIdx} | ${faceEst.pose.padEnd(13)} | ` +
        `${hair.visibility.padEnd(11)} | Conf: ${(hair.confidence * 100).toFixed(0).padStart(3)}% | ` +
        `${styleTag.padEnd(12)} | ${hairlineTag.padEnd(10)} | ${outerTag.padEnd(11)} | ${massTag.padEnd(7)} | ` +
        `Hair: ${hairLatency.toFixed(2).padStart(5)}ms | Total: ${cumulativeLatency.toFixed(2).padStart(6)}ms`
      );
    }
  }

  // Latency summary
  const avgHairLatency = records.reduce((s, r) => s + r.hairLatencyMs, 0) / (records.length || 1);
  const maxHairLatency = Math.max(...records.map((r) => r.hairLatencyMs));
  const avgCumulLatency = records.reduce((s, r) => s + r.cumulativeLatencyMs, 0) / (records.length || 1);

  console.log('-'.repeat(105));
  console.log(`  Processed ${records.length} subjects across ${manifest.categories.length} benchmark categories.`);
  console.log(`  Hair Detection Latency:  avg = ${avgHairLatency.toFixed(2)} ms | max = ${maxHairLatency.toFixed(2)} ms (budget < 100 ms)`);
  console.log(`  Cumulative Pipeline Latency: avg = ${avgCumulLatency.toFixed(2)} ms (including segmentation + all facial modules)`);
  console.log('='.repeat(105));

  // Generate HTML report
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  const htmlPath = path.join(artifactsDir, 'hair-report.html');
  generateHtmlReport(records, htmlPath, avgHairLatency, maxHairLatency, avgCumulLatency);
  console.log(`\n  Generated Visual Audit Report: ${htmlPath}\n`);
}

function generateHtmlReport(
  records: HairInspectionRecord[],
  outputPath: string,
  avgLatency: number,
  maxLatency: number,
  avgCumulLatency: number
): void {
  const cardsHtml = records
    .map((r) => {
      const hair = r.hair;
      const hairlinePtsJson = JSON.stringify(hair?.hairline?.points ?? []);
      const outerPtsJson = JSON.stringify(hair?.outerSilhouette?.points ?? []);
      const massesJson = JSON.stringify((hair?.masses ?? []).map((m) => m.points));
      const fBoxJson = JSON.stringify(r.estimate?.faceBoundingBox ?? null);
      const hBoxJson = JSON.stringify(r.estimate?.headBoundingBox ?? null);

      const statusBadge =
        r.visibility === 'visible'
          ? '<span class="badge badge-success">VISIBLE</span>'
          : r.visibility === 'uncertain'
          ? '<span class="badge badge-warning">UNCERTAIN</span>'
          : '<span class="badge badge-danger">NOT DETECTED</span>';

      const styleBadge = `<span class="badge badge-info">${(r.styleEstimate || 'unknown').toUpperCase()}</span>`;

      return `
      <div class="benchmark-card" data-category="${r.category}" data-id="${r.id}">
        <div class="card-header">
          <div>
            <span class="card-id">${r.id}</span>
            <span class="card-category">(${r.category})</span>
            ${r.subjectIndex > 0 ? `<span class="badge badge-sub">Subject #${r.subjectIndex}</span>` : ''}
          </div>
          <div class="header-badges">
            ${statusBadge}
            ${styleBadge}
          </div>
        </div>

        <div class="canvas-container">
          <canvas id="canvas-${r.id}-${r.subjectIndex}" width="512" height="512"></canvas>
        </div>

        <div class="metrics-grid">
          <div class="metric">
            <span class="metric-label">Pose</span>
            <span class="metric-val">${r.pose}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Confidence</span>
            <span class="metric-val">${(r.confidence * 100).toFixed(1)}%</span>
          </div>
          <div class="metric">
            <span class="metric-label">Hair Latency</span>
            <span class="metric-val">${r.hairLatencyMs.toFixed(2)} ms</span>
          </div>
          <div class="metric">
            <span class="metric-label">Total Points</span>
            <span class="metric-val">${r.totalHairPoints} pts</span>
          </div>
          <div class="metric">
            <span class="metric-label">Hairline</span>
            <span class="metric-val">${r.hairlineDetected ? `${r.hairlinePoints} pts (${(r.hairlineConfidence * 100).toFixed(0)}%)` : 'None'}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Outer Silhouette</span>
            <span class="metric-val">${r.outerSilhouetteDetected ? `${r.outerPoints} pts` : 'None'}</span>
          </div>
          <div class="metric">
            <span class="metric-label">Internal Masses</span>
            <span class="metric-val">${r.massesCount} masses</span>
          </div>
          <div class="metric">
            <span class="metric-label">Directional Flow</span>
            <span class="metric-val">${r.directionalFlowAngle !== undefined ? `${(r.directionalFlowAngle * (180 / Math.PI)).toFixed(1)}°` : 'N/A'}</span>
          </div>
        </div>

        <script>
          (function() {
            const canvas = document.getElementById('canvas-${r.id}-${r.subjectIndex}');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const img = new Image();
            img.onload = function() {
              ctx.drawImage(img, 0, 0, 512, 512);

              const fBox = ${fBoxJson};
              const hBox = ${hBoxJson};
              const hairlinePts = ${hairlinePtsJson};
              const outerPts = ${outerPtsJson};
              const masses = ${massesJson};

              // Draw head bounding box (subtle grey/purple dash)
              if (hBox) {
                ctx.strokeStyle = 'rgba(180, 140, 255, 0.45)';
                ctx.lineWidth = 1;
                ctx.setLineDash([3, 3]);
                ctx.strokeRect(hBox.x * 512, hBox.y * 512, hBox.width * 512, hBox.height * 512);
                ctx.setLineDash([]);
              }

              // Draw face bounding box (subtle blue dash)
              if (fBox) {
                ctx.strokeStyle = 'rgba(70, 160, 255, 0.40)';
                ctx.lineWidth = 1;
                ctx.setLineDash([2, 2]);
                ctx.strokeRect(fBox.x * 512, fBox.y * 512, fBox.width * 512, fBox.height * 512);
                ctx.setLineDash([]);
              }

              // Draw Outer Hair Silhouette (Cyan/Teal)
              if (outerPts && outerPts.length > 1) {
                ctx.strokeStyle = '#00e5ff';
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.moveTo(outerPts[0].x * 512, outerPts[0].y * 512);
                for (let i = 1; i < outerPts.length; i++) {
                  ctx.lineTo(outerPts[i].x * 512, outerPts[i].y * 512);
                }
                ctx.stroke();

                // Draw points
                ctx.fillStyle = '#00b0ff';
                for (const pt of outerPts) {
                  ctx.beginPath();
                  ctx.arc(pt.x * 512, pt.y * 512, 2.0, 0, Math.PI * 2);
                  ctx.fill();
                }
              }

              // Draw Hairline Contour (Gold / Amber)
              if (hairlinePts && hairlinePts.length > 1) {
                ctx.strokeStyle = '#ffd700';
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.moveTo(hairlinePts[0].x * 512, hairlinePts[0].y * 512);
                for (let i = 1; i < hairlinePts.length; i++) {
                  ctx.lineTo(hairlinePts[i].x * 512, hairlinePts[i].y * 512);
                }
                ctx.stroke();

                // Draw points
                ctx.fillStyle = '#ff9100';
                for (const pt of hairlinePts) {
                  ctx.beginPath();
                  ctx.arc(pt.x * 512, pt.y * 512, 2.5, 0, Math.PI * 2);
                  ctx.fill();
                }
              }

              // Draw Internal Masses (Coral / Orange)
              if (masses && masses.length > 0) {
                ctx.strokeStyle = '#ff6e40';
                ctx.lineWidth = 1.8;
                for (const m of masses) {
                  if (m.length > 1) {
                    ctx.beginPath();
                    ctx.moveTo(m[0].x * 512, m[0].y * 512);
                    for (let i = 1; i < m.length; i++) {
                      ctx.lineTo(m[i].x * 512, m[i].y * 512);
                    }
                    ctx.stroke();
                  }
                }
              }
            };
            img.src = '${r.origBase64}';
          })();
        </script>
      </div>`;
    })
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Hair Structure Detection Visual Audit (TASK-103 Step 2F)</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --heading: #f0f6fc;
      --accent: #00e5ff;
      --gold: #ffd700;
      --coral: #ff6e40;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      padding: 24px;
      line-height: 1.5;
    }
    h1 { color: var(--heading); font-size: 24px; margin-bottom: 8px; }
    .subtitle { color: #8b949e; font-size: 14px; margin-bottom: 24px; }
    
    .summary-box {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px 20px;
      margin-bottom: 24px;
      display: flex;
      gap: 32px;
      flex-wrap: wrap;
    }
    .summary-item { display: flex; flex-direction: column; }
    .summary-label { font-size: 11px; text-transform: uppercase; color: #8b949e; letter-spacing: 0.5px; }
    .summary-val { font-size: 20px; font-weight: bold; color: var(--heading); margin-top: 2px; }
    .summary-val.highlight { color: var(--accent); }

    .legend {
      display: flex;
      gap: 20px;
      margin-bottom: 20px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px 16px;
      font-size: 13px;
      align-items: center;
    }
    .legend-item { display: flex; align-items: center; gap: 8px; }
    .legend-color { width: 14px; height: 14px; border-radius: 3px; }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(480px, 1fr));
      gap: 20px;
    }
    .benchmark-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      display: flex;
      flex-direction: column;
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .card-id { font-weight: bold; color: var(--heading); font-size: 16px; }
    .card-category { color: #8b949e; font-size: 13px; margin-left: 6px; }
    .header-badges { display: flex; gap: 6px; }

    .badge {
      font-size: 10px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 12px;
      letter-spacing: 0.5px;
    }
    .badge-success { background: rgba(46, 160, 67, 0.2); color: #3fb950; border: 1px solid rgba(46, 160, 67, 0.4); }
    .badge-warning { background: rgba(210, 153, 34, 0.2); color: #d29922; border: 1px solid rgba(210, 153, 34, 0.4); }
    .badge-danger { background: rgba(248, 81, 73, 0.2); color: #f85149; border: 1px solid rgba(248, 81, 73, 0.4); }
    .badge-info { background: rgba(56, 139, 253, 0.2); color: #58a6ff; border: 1px solid rgba(56, 139, 253, 0.4); }
    .badge-sub { background: rgba(187, 128, 179, 0.2); color: #bc8cff; border: 1px solid rgba(187, 128, 179, 0.4); }

    .canvas-container {
      width: 100%;
      aspect-ratio: 1 / 1;
      background: #000;
      border-radius: 4px;
      overflow: hidden;
      margin-bottom: 12px;
    }
    canvas { width: 100%; height: 100%; display: block; object-fit: contain; }

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      background: rgba(255,255,255,0.02);
      border-radius: 6px;
      padding: 10px;
    }
    .metric { display: flex; flex-direction: column; }
    .metric-label { font-size: 10px; text-transform: uppercase; color: #8b949e; }
    .metric-val { font-size: 13px; font-weight: 600; color: #e6edf3; margin-top: 1px; }
  </style>
</head>
<body>
  <h1>Hair Structure Detection Visual Audit</h1>
  <div class="subtitle">TASK-103 Step 2F &bull; Procedural Drawing Landmark Pipeline</div>

  <div class="summary-box">
    <div class="summary-item">
      <span class="summary-label">Evaluated Subjects</span>
      <span class="summary-val highlight">${records.length}</span>
    </div>
    <div class="summary-item">
      <span class="summary-label">Hair Avg Latency</span>
      <span class="summary-val highlight">${avgLatency.toFixed(2)} ms</span>
    </div>
    <div class="summary-item">
      <span class="summary-label">Hair Max Latency</span>
      <span class="summary-val">${maxLatency.toFixed(2)} ms</span>
    </div>
    <div class="summary-item">
      <span class="summary-label">Cumulative Pipeline Latency</span>
      <span class="summary-val">${avgCumulLatency.toFixed(2)} ms</span>
    </div>
    <div class="summary-item">
      <span class="summary-label">Latency Budget</span>
      <span class="summary-val" style="color: #3fb950;">&lt; 100.0 ms</span>
    </div>
    <div class="summary-item">
      <span class="summary-label">Detection Algorithm</span>
      <span class="summary-val" style="font-size: 14px; margin-top: 5px;">Silhouette + Hairline Ridge + Luminance / Edge Multi-cue</span>
    </div>
  </div>

  <div class="legend">
    <span style="font-weight: 600; color: var(--heading);">Contour Legend:</span>
    <div class="legend-item">
      <div class="legend-color" style="background: #ffd700;"></div>
      <span>Hairline Contour (Forehead / Scalp Transition)</span>
    </div>
    <div class="legend-item">
      <div class="legend-color" style="background: #00e5ff;"></div>
      <span>Outer Hair Silhouette (Perimeter Perimeter)</span>
    </div>
    <div class="legend-item">
      <div class="legend-color" style="background: #ff6e40;"></div>
      <span>Internal Mass Dividers / Part Seam</span>
    </div>
    <div class="legend-item">
      <div class="legend-color" style="background: rgba(180, 140, 255, 0.7);"></div>
      <span>Head Cranium Enclosing Box</span>
    </div>
  </div>

  <div class="grid">
    ${cardsHtml}
  </div>
</body>
</html>`;

  fs.writeFileSync(outputPath, html, 'utf-8');
}

if (require.main === module) {
  runHairInspectionSuite();
}
