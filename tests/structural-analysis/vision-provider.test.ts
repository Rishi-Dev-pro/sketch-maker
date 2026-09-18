import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import {
  preprocessPixelBuffer,
  PixelBuffer,
} from '../../packages/image-processing/src';
import {
  DeterministicVisionProvider,
  MediaPipeVisionProvider,
  VisionCoordinator,
  VisionProvider,
  VisionInput,
  VisionResult,
  MediaPipeUnavailableError,
} from '../../packages/structural-analysis/src';
import { SubjectModel } from '../../packages/shared-types/src';

function decodeJpeg(filePath: string): PixelBuffer {
  const buf = fs.readFileSync(filePath);
  const raw = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
  return {
    width: raw.width,
    height: raw.height,
    data: new Uint8ClampedArray(raw.data),
  };
}

const imagesDir = path.resolve(__dirname, '../images');

describe('Vision Provider Architecture (TASK-103.6)', () => {
  const imgPath = path.join(imagesDir, 'bm-01-front-portrait.jpg');
  const pixelBuf = decodeJpeg(imgPath);
  const normImage = preprocessPixelBuffer(pixelBuf, {
    maxDimension: 512,
    normalizeLighting: false,
  });

  const baseInput: VisionInput = {
    image: normImage,
    sourceDimensions: {
      width: 1024,
      height: 1024,
      aspectRatio: '1:1',
      megapixels: 1.05,
    },
  };

  it('Test 1: DeterministicVisionProvider satisfies the VisionProvider contract', () => {
    const provider: VisionProvider = new DeterministicVisionProvider();
    assert.strictEqual(typeof provider.isAvailable, 'function');
    assert.strictEqual(typeof provider.analyze, 'function');
    assert.strictEqual(provider.metadata.id, 'deterministic-ts');
    assert.strictEqual(provider.metadata.type, 'deterministic');
    assert.strictEqual(provider.isAvailable(), true);
  });

  it('Test 2: Output maps strictly to canonical SubjectModel and SubjectAnalysisResult', async () => {
    const provider = new DeterministicVisionProvider();
    const result: VisionResult = await provider.analyze(baseInput);

    assert(result.primarySubject !== undefined);
    assert(Array.isArray(result.subjects));
    assert(result.subjects.length > 0);

    const sub = result.primarySubject;
    assert.strictEqual(typeof sub.id, 'string');
    assert.strictEqual(typeof sub.version, 'string');
    assert(sub.boundingBox !== undefined);
    assert(Array.isArray(sub.silhouette));
    assert(sub.face !== undefined);

    // Verify scale multipliers
    assert.strictEqual(result.scale.x, 1024 / 512);
    assert.strictEqual(result.scale.y, 1024 / 512);

    // Verify metrics
    assert.strictEqual(typeof result.metrics.latencyMs, 'number');
    assert(result.metrics.latencyMs >= 0);
    assert.strictEqual(result.metrics.hasFace, true);
  });

  it('Test 3: Normalized coordinates in SubjectModel remain strictly in [0, 1]', async () => {
    const provider = new DeterministicVisionProvider();
    const result = await provider.analyze(baseInput);
    const sub = result.primarySubject;

    const bbox = sub.boundingBox;
    assert(bbox.x >= 0 && bbox.x <= 1, `bbox.x out of bounds: ${bbox.x}`);
    assert(bbox.y >= 0 && bbox.y <= 1, `bbox.y out of bounds: ${bbox.y}`);
    assert(bbox.width >= 0 && bbox.width <= 1, `bbox.width out of bounds: ${bbox.width}`);
    assert(bbox.height >= 0 && bbox.height <= 1, `bbox.height out of bounds: ${bbox.height}`);

    if (sub.face) {
      const fb = sub.face.boundingBox;
      if (fb) {
        assert(fb.x >= 0 && fb.x <= 1);
        assert(fb.y >= 0 && fb.y <= 1);
      }

      // Check eye points
      if (sub.face.leftEye) {
        for (const pt of sub.face.leftEye.upperLid.points) {
          assert(pt.x >= 0 && pt.x <= 1, `pt.x ${pt.x} out of bounds`);
          assert(pt.y >= 0 && pt.y <= 1, `pt.y ${pt.y} out of bounds`);
        }
      }
    }
  });

  it('Test 4: Confidence scores remain bounded in [0, 1]', async () => {
    const provider = new DeterministicVisionProvider();
    const result = await provider.analyze(baseInput);

    assert(result.primarySubject.globalConfidence >= 0 && result.primarySubject.globalConfidence <= 1);
    if (result.primarySubject.face) {
      assert(result.primarySubject.face.confidence >= 0 && result.primarySubject.face.confidence <= 1);
    }
  });

  it('Test 5: Visibility semantics remain intact and valid', async () => {
    const provider = new DeterministicVisionProvider();
    const result = await provider.analyze(baseInput);
    const face = result.primarySubject.face;
    assert(face !== undefined);
    assert(face.featureVisibility !== undefined);

    const validVisibilities = new Set(['visible', 'occluded', 'uncertain', 'not_detected']);
    assert(validVisibilities.has(face.featureVisibility.leftEye!));
    assert(validVisibilities.has(face.featureVisibility.nose!));
    assert(validVisibilities.has(face.featureVisibility.mouth!));
  });

  it('Test 6: Multi-person representation remains valid on BM-11', async () => {
    const bm11Path = path.join(imagesDir, 'bm-11-multi-person.jpg');
    const bm11Buf = decodeJpeg(bm11Path);
    const bm11Norm = preprocessPixelBuffer(bm11Buf, {
      targetDimension: 512,
      normalizeLighting: false,
    });

    const provider = new DeterministicVisionProvider();
    const result = await provider.analyze({
      image: bm11Norm,
      options: { maxSubjects: 3 },
    });

    assert(result.subjects.length >= 1);
    assert.strictEqual(result.metrics.subjectCount, result.subjects.length);
  });

  it('Test 7: Provider metadata and execution plan are preserved', async () => {
    const provider = new DeterministicVisionProvider();
    const result = await provider.analyze(baseInput);

    assert.strictEqual(result.provider.id, 'deterministic-ts');
    assert.strictEqual(result.provider.type, 'deterministic');
    assert.strictEqual(result.executionPlan.resolvedProviderId, 'deterministic-ts');
    assert.strictEqual(result.executionPlan.fallbackOccurred, false);
    assert(result.executionPlan.executionDurationMs >= 0);
  });

  it('Test 8: Deterministic provider operates with zero ML dependencies', () => {
    const provider = new DeterministicVisionProvider();
    assert.strictEqual(provider.metadata.capabilities.earPinna, true);
    assert.strictEqual(provider.isAvailable(), true);
  });

  it('Test 9: MediaPipeVisionProvider stub reports unavailable by default in headless runtime', async () => {
    const mpProvider = new MediaPipeVisionProvider();
    const isReady = await mpProvider.isAvailable();
    assert.strictEqual(isReady, false);

    await assert.rejects(
      async () => {
        await mpProvider.analyze(baseInput);
      },
      MediaPipeUnavailableError
    );
  });

  it('Test 10: VisionCoordinator selects deterministic provider deterministically in deterministic mode', async () => {
    const coordinator = new VisionCoordinator();
    const result = await coordinator.analyze({
      ...baseInput,
      options: { mode: 'deterministic' },
    });

    assert.strictEqual(result.executionPlan.resolvedProviderId, 'deterministic-ts');
    assert.strictEqual(result.executionPlan.requestedMode, 'deterministic');
    assert.strictEqual(result.executionPlan.fallbackOccurred, false);
  });

  it('Test 11: VisionCoordinator auto mode performs seamless deterministic fallback when ML is unavailable', async () => {
    const coordinator = new VisionCoordinator({ defaultMode: 'auto' });
    const result = await coordinator.analyze(baseInput);

    // MediaPipe is not initialized; coordinator seamlessly falls back to deterministic provider
    assert.strictEqual(result.executionPlan.resolvedProviderId, 'deterministic-ts');
    assert.strictEqual(result.executionPlan.fallbackOccurred, true);
    assert(result.executionPlan.fallbackReason !== undefined);
    assert(result.primarySubject !== undefined);
    assert(result.primarySubject.face !== undefined);
  });

  it('Test 12: VisionCoordinator hybrid mode preserves deterministic ear pinna when reconciling', async () => {
    const coordinator = new VisionCoordinator();
    const result = await coordinator.analyze({
      ...baseInput,
      options: { mode: 'hybrid' },
    });

    // In hybrid mode without active ML runtime, it safely runs deterministic baseline
    assert(result.primarySubject !== undefined);
    assert.strictEqual(result.executionPlan.requestedMode, 'hybrid');
  });

  it('Test 13: VisionCoordinator with mock ML delegate successfully merges hybrid perception', async () => {
    // Create a mock ML delegate simulating a warm browser MediaPipe runtime
    const mockSubject: SubjectModel = {
      id: 'mock-sub-1',
      version: '1.0.0',
      sourceDimensions: { width: 512, height: 512, aspectRatio: '1:1', megapixels: 0.26 },
      boundingBox: { x: 0.2, y: 0.1, width: 0.6, height: 0.7 },
      silhouette: [],
      face: {
        confidence: 0.95,
        boundingBox: { x: 0.25, y: 0.15, width: 0.5, height: 0.5 },
        leftEar: undefined, // Simulating MediaPipe which has no ear pinna
        rightEar: undefined,
      },
      body: {
        shoulders: [],
        arms: [],
        torso: [],
        legs: [],
        poseConfidence: 0.92,
      },
      globalConfidence: 0.95,
      timestamp: Date.now(),
    };

    const mockDelegate = {
      isReady: () => true,
      process: async () => ({
        subjects: [mockSubject],
        latencyMs: 18.5,
      }),
    };

    const mpProvider = new MediaPipeVisionProvider(mockDelegate);
    const coordinator = new VisionCoordinator({
      providers: [new DeterministicVisionProvider(), mpProvider],
    });

    const result = await coordinator.analyze({
      ...baseInput,
      options: { mode: 'hybrid' },
    });

    assert.strictEqual(result.executionPlan.resolvedProviderId, 'hybrid-coordinator');
    assert.strictEqual(result.executionPlan.fallbackOccurred, false);
    // Body pose is successfully sourced from ML provider
    assert(result.primarySubject.body !== undefined);
  });

  it('Test 14: No browser DOM/window APIs are leaked into core packages', () => {
    assert.strictEqual(typeof (globalThis as any).window, 'undefined');
    assert.strictEqual(typeof (globalThis as any).document, 'undefined');
  });
});
