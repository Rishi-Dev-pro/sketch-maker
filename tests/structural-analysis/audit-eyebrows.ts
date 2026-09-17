import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import {
  preprocessPixelBuffer,
  PixelBuffer,
} from '../../packages/image-processing/src';
import {
  segmentSubject,
  computeSobelGradients,
  estimateAllFaceRegions,
  detectEyeLandmarks,
  detectEyebrows,
} from '../../packages/structural-analysis/src';

const imagesDir = path.resolve(__dirname, '../images');
const manifestPath = path.join(imagesDir, 'dataset.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

function decodeJpeg(filePath: string): PixelBuffer {
  const buf = fs.readFileSync(filePath);
  const raw = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
  return {
    width: raw.width,
    height: raw.height,
    data: new Uint8ClampedArray(raw.data),
  };
}

console.log('='.repeat(100));
console.log('  TASK-103 STEP 2B — EYEBROW DETECTION QUALITY AUDIT');
console.log('='.repeat(100));

for (const item of manifest.categories) {
  const imgPath = path.join(imagesDir, item.filename);
  const pixelBuf = decodeJpeg(imgPath);

  const normImage = preprocessPixelBuffer(pixelBuf, { targetDimension: 1024, normalizeLighting: false });
  const segResult = segmentSubject(normImage);
  const gradients = computeSobelGradients(normImage.luminance);

  const faceEstimates = estimateAllFaceRegions(segResult, normImage, gradients);
  const face = faceEstimates.length > 0 ? faceEstimates[0] : null;

  if (!face) {
    console.log(`[${item.id}] No face detected!`);
    continue;
  }

  const eyes = detectEyeLandmarks(face, normImage, gradients, segResult.mask);
  const brows = detectEyebrows(face, normImage, gradients, segResult.mask, eyes);

  const leftEye = eyes?.leftEye;
  const rightEye = eyes?.rightEye;
  const leftBrow = brows?.leftEyebrow;
  const rightBrow = brows?.rightEyebrow;

  console.log(`\n--------------------------------------------------------------------------------`);
  console.log(`IMAGE: ${item.id} (${item.category}) | Pose: ${face.pose}`);
  console.log(`FaceBox: [x:${face.faceBoundingBox.x.toFixed(3)}, y:${face.faceBoundingBox.y.toFixed(3)}, w:${face.faceBoundingBox.width.toFixed(3)}, h:${face.faceBoundingBox.height.toFixed(3)}]`);

  function formatPathExtent(pts?: { x: number; y: number }[]) {
    if (!pts || pts.length === 0) return 'NONE (0 pts)';
    let minX = 1, maxX = 0, minY = 1, maxY = 0;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return `${pts.length} pts: x in [${minX.toFixed(3)}, ${maxX.toFixed(3)}], y in [${minY.toFixed(3)}, ${maxY.toFixed(3)}]`;
  }

  console.log(`  LEFT EYE:   vis=${leftEye?.visibility.padEnd(10)} conf=${leftEye?.confidence?.toFixed(2)} | Extent: ${formatPathExtent(leftEye?.upperLid.points)}`);
  console.log(`  RIGHT EYE:  vis=${rightEye?.visibility.padEnd(10)} conf=${rightEye?.confidence?.toFixed(2)} | Extent: ${formatPathExtent(rightEye?.upperLid.points)}`);
  console.log(`  LEFT BROW:  vis=${leftBrow?.visibility.padEnd(10)} conf=${leftBrow?.confidence?.toFixed(2)} | Extent: ${formatPathExtent(leftBrow?.points)}`);
  console.log(`  RIGHT BROW: vis=${rightBrow?.visibility.padEnd(10)} conf=${rightBrow?.confidence?.toFixed(2)} | Extent: ${formatPathExtent(rightBrow?.points)}`);

  // Compute vertical offset between eye and brow
  if (leftEye?.upperLid.points.length && leftBrow?.points.length) {
    const meanEyeY = leftEye.upperLid.points.reduce((a, b) => a + b.y, 0) / leftEye.upperLid.points.length;
    const meanBrowY = leftBrow.points.reduce((a, b) => a + b.y, 0) / leftBrow.points.length;
    const diffY = meanEyeY - meanBrowY;
    const diffPercent = (diffY / face.faceBoundingBox.height) * 100;
    console.log(`  -> Left Brow is ${diffPercent.toFixed(1)}% of face height ABOVE left eye (diffY=${diffY.toFixed(4)})`);
  }

  if (rightEye?.upperLid.points.length && rightBrow?.points.length) {
    const meanEyeY = rightEye.upperLid.points.reduce((a, b) => a + b.y, 0) / rightEye.upperLid.points.length;
    const meanBrowY = rightBrow.points.reduce((a, b) => a + b.y, 0) / rightBrow.points.length;
    const diffY = meanEyeY - meanBrowY;
    const diffPercent = (diffY / face.faceBoundingBox.height) * 100;
    console.log(`  -> Right Brow is ${diffPercent.toFixed(1)}% of face height ABOVE right eye (diffY=${diffY.toFixed(4)})`);
  }
}
console.log('\n' + '='.repeat(100));
