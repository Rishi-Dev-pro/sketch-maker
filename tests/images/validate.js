/**
 * Benchmark Dataset Validator
 *
 * Verifies that all 12 standard benchmark images exist, are valid JPEG files,
 * match their recorded dimensions, match their SHA-256 checksums, and meet
 * the project quality standards.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const imagesDir = __dirname;
const manifestPath = path.join(imagesDir, 'dataset.json');

function getJpegDimensions(buffer) {
  if (buffer.length < 4 || buffer.readUInt16BE(0) !== 0xFFD8) {
    return null;
  }
  let i = 2;
  while (i < buffer.length - 8) {
    const marker = buffer.readUInt16BE(i);
    i += 2;
    // SOF0 (Baseline) or SOF2 (Progressive)
    if (marker === 0xFFC0 || marker === 0xFFC2) {
      const height = buffer.readUInt16BE(i + 3);
      const width = buffer.readUInt16BE(i + 5);
      return { width, height };
    } else if (marker === 0xFFD9) {
      // EOI (End of Image)
      break;
    } else {
      const length = buffer.readUInt16BE(i);
      i += length;
    }
  }
  return null;
}

function runValidation() {
  console.log('='.repeat(78));
  console.log('  SKETCH MAKER - BENCHMARK DATASET VALIDATION (TASK-006)');
  console.log('='.repeat(78));

  if (!fs.existsSync(manifestPath)) {
    console.error(`[FAIL] Manifest not found: ${manifestPath}`);
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  console.log(`Manifest: ${manifest.name} v${manifest.version}`);
  console.log(`Total categories defined: ${manifest.categories.length}`);
  console.log('-'.repeat(78));

  let passedCount = 0;
  let errorCount = 0;

  for (const item of manifest.categories) {
    const filePath = path.join(imagesDir, item.filename);

    if (!fs.existsSync(filePath)) {
      console.error(`[FAIL] Missing image file for ${item.id}: ${item.filename}`);
      errorCount++;
      continue;
    }

    const buf = fs.readFileSync(filePath);
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    const dims = getJpegDimensions(buf);

    if (!dims) {
      console.error(`[FAIL] Invalid JPEG format: ${item.filename}`);
      errorCount++;
      continue;
    }

    const dimMismatch = (dims.width !== item.dimensions.width || dims.height !== item.dimensions.height);
    const hashMismatch = (hash !== item.sha256);

    if (dimMismatch) {
      console.error(`[FAIL] Dimension mismatch on ${item.id}: expected ${item.dimensions.width}x${item.dimensions.height}, got ${dims.width}x${dims.height}`);
      errorCount++;
      continue;
    }

    if (hashMismatch) {
      console.error(`[FAIL] SHA-256 mismatch on ${item.id}: expected ${item.sha256}, got ${hash}`);
      errorCount++;
      continue;
    }

    // Check 24MP criteria for BM-12
    if (item.id === 'BM-12-HIGH-RES') {
      const totalPixels = dims.width * dims.height;
      if (totalPixels < 24_000_000) {
        console.error(`[FAIL] BM-12 resolution requirement not met: expected >= 24MP, got ${(totalPixels / 1_000_000).toFixed(2)} MP`);
        errorCount++;
        continue;
      }
    }

    const sizeKb = (buf.length / 1024).toFixed(1);
    const mp = ((dims.width * dims.height) / 1_000_000).toFixed(2);
    console.log(`[PASS] ${item.id.padEnd(25)} | ${item.filename.padEnd(29)} | ${dims.width}x${dims.height} (${mp} MP) | ${sizeKb} KB`);
    passedCount++;
  }

  console.log('-'.repeat(78));
  if (errorCount === 0 && passedCount === 12) {
    console.log(`[SUCCESS] All 12 benchmark images passed integrity & schema checks!`);
    console.log('='.repeat(78));
    process.exit(0);
  } else {
    console.error(`[FAILURE] Dataset validation failed: ${passedCount} passed, ${errorCount} errors.`);
    console.log('='.repeat(78));
    process.exit(1);
  }
}

runValidation();
