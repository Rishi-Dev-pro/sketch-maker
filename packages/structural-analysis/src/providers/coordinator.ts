/**
 * Vision Coordinator
 * TASK-103.6 Provider Abstraction & Hybrid Vision Foundation
 *
 * Central orchestration layer managing perception backends.
 * Resolves requested execution modes ('auto', 'deterministic', 'ml', 'hybrid'),
 * enforces evidence-first provider selection, and guarantees zero-fail
 * deterministic fallback when ML runtimes are offline or unavailable.
 */

import {
  VisionProvider,
  VisionProviderMetadata,
  VisionInput,
  VisionResult,
  VisionExecutionMode,
} from './types';
import { DeterministicVisionProvider } from './deterministic-provider';
import { MediaPipeVisionProvider } from './mediapipe-provider';
import { SubjectModel } from '@sketch-maker/shared-types';

export interface VisionCoordinatorConfig {
  /** Default execution mode if not specified in per-request options (default: 'auto') */
  readonly defaultMode?: VisionExecutionMode;
  /** Custom initial providers list (default: [Deterministic, MediaPipe]) */
  readonly providers?: VisionProvider[];
}

export class VisionCoordinator {
  private readonly providers: Map<string, VisionProvider> = new Map();
  private readonly defaultMode: VisionExecutionMode;

  constructor(config?: VisionCoordinatorConfig) {
    this.defaultMode = config?.defaultMode ?? 'auto';

    if (config?.providers && config.providers.length > 0) {
      for (const p of config.providers) {
        this.registerProvider(p);
      }
    } else {
      // Register standard built-in providers
      this.registerProvider(new DeterministicVisionProvider());
      this.registerProvider(new MediaPipeVisionProvider());
    }
  }

  /**
   * Registers a new or custom vision provider.
   */
  registerProvider(provider: VisionProvider): void {
    this.providers.set(provider.metadata.id, provider);
  }

  /**
   * Retrieves a registered provider by its unique ID.
   */
  getProvider(id: string): VisionProvider | undefined {
    return this.providers.get(id);
  }

  /**
   * Returns metadata for all currently registered providers.
   */
  getAllProviders(): VisionProviderMetadata[] {
    return Array.from(this.providers.values()).map((p) => p.metadata);
  }

  /**
   * Queries and returns metadata for providers that are operational in the current environment.
   */
  async getAvailableProviders(): Promise<VisionProviderMetadata[]> {
    const available: VisionProviderMetadata[] = [];
    for (const p of this.providers.values()) {
      try {
        if (await p.isAvailable()) {
          available.push(p.metadata);
        }
      } catch {
        // Provider probe failed; omit from available list
      }
    }
    return available;
  }

  /**
   * Analyzes an input image using the resolved provider strategy.
   *
   * Mode behavior:
   * - 'deterministic': Always uses DeterministicVisionProvider (zero ML overhead).
   * - 'ml': Exclusively uses ML provider (throws if unavailable).
   * - 'auto': Uses ML provider if available; otherwise falls back to deterministic.
   * - 'hybrid': Executes deterministic baseline and augments with ML landmarks if available.
   */
  async analyze(input: VisionInput): Promise<VisionResult> {
    const t0 = performance.now();
    const mode = input.options?.mode ?? this.defaultMode;

    const deterministicProvider = this.providers.get('deterministic-ts') as DeterministicVisionProvider
      ?? new DeterministicVisionProvider();
    const mlProvider = this.providers.get('mediapipe-tasks-vision');

    switch (mode) {
      case 'deterministic': {
        return await deterministicProvider.analyze(input);
      }

      case 'ml': {
        if (!mlProvider) {
          throw new Error("Requested 'ml' execution mode, but no ML provider is registered.");
        }
        const isMlReady = await mlProvider.isAvailable();
        if (!isMlReady) {
          throw new Error(
            "Requested 'ml' execution mode, but MediaPipeVisionProvider is unavailable in this runtime environment."
          );
        }
        return await mlProvider.analyze(input);
      }

      case 'hybrid': {
        return await this.executeHybridMode(input, deterministicProvider, mlProvider, t0);
      }

      case 'auto':
      default: {
        return await this.executeAutoMode(input, deterministicProvider, mlProvider, t0);
      }
    }
  }

  /**
   * 'auto' mode: Attempts ML provider if available; seamlessly falls back to deterministic.
   */
  private async executeAutoMode(
    input: VisionInput,
    deterministicProvider: DeterministicVisionProvider,
    mlProvider: VisionProvider | undefined,
    startTime: number
  ): Promise<VisionResult> {
    if (mlProvider) {
      try {
        const isMlReady = await mlProvider.isAvailable();
        if (isMlReady) {
          const mlResult = await mlProvider.analyze(input);
          const duration = performance.now() - startTime;
          return {
            ...mlResult,
            executionPlan: {
              requestedMode: 'auto',
              resolvedProviderId: mlProvider.metadata.id,
              fallbackOccurred: false,
              executionDurationMs: duration,
            },
          };
        }
      } catch (err: any) {
        // ML execution failed; fall through to deterministic fallback
        const detResult = await deterministicProvider.analyze(input);
        const duration = performance.now() - startTime;
        return {
          ...detResult,
          executionPlan: {
            requestedMode: 'auto',
            resolvedProviderId: deterministicProvider.metadata.id,
            fallbackOccurred: true,
            fallbackReason: `ML provider encountered an error: ${err?.message ?? 'Unknown failure'}. Fell back to deterministic engine.`,
            executionDurationMs: duration,
          },
        };
      }
    }

    // ML provider not ready; execute deterministic baseline
    const detResult = await deterministicProvider.analyze(input);
    const duration = performance.now() - startTime;
    return {
      ...detResult,
      executionPlan: {
        requestedMode: 'auto',
        resolvedProviderId: deterministicProvider.metadata.id,
        fallbackOccurred: mlProvider ? true : false,
        fallbackReason: mlProvider
          ? 'MediaPipe Tasks Vision is not initialized in this environment. Seamlessly fell back to deterministic engine.'
          : undefined,
        executionDurationMs: duration,
      },
    };
  }

  /**
   * 'hybrid' mode: Reconciles dense ML landmarks with deterministic ear pinna and boundary contours.
   */
  private async executeHybridMode(
    input: VisionInput,
    deterministicProvider: DeterministicVisionProvider,
    mlProvider: VisionProvider | undefined,
    startTime: number
  ): Promise<VisionResult> {
    // 1. Always execute authoritative deterministic baseline
    const detResult = await deterministicProvider.analyze(input);

    let mlReady = false;
    if (mlProvider) {
      try {
        mlReady = await mlProvider.isAvailable();
      } catch {
        mlReady = false;
      }
    }

    if (!mlReady || !mlProvider) {
      const duration = performance.now() - startTime;
      return {
        ...detResult,
        executionPlan: {
          requestedMode: 'hybrid',
          resolvedProviderId: deterministicProvider.metadata.id,
          fallbackOccurred: true,
          fallbackReason: 'ML provider unavailable for hybrid augmentation. Used pure deterministic baseline.',
          executionDurationMs: duration,
        },
      };
    }

    // 2. ML provider is available; execute and reconcile
    try {
      const mlResult = await mlProvider.analyze(input);
      const mergedSubjects = this.reconcileHybridSubjects(detResult.subjects, mlResult.subjects);
      const duration = performance.now() - startTime;

      return {
        primarySubject: mergedSubjects[0] ?? detResult.primarySubject,
        subjects: mergedSubjects,
        scale: detResult.scale,
        metrics: {
          latencyMs: duration,
          subjectCount: mergedSubjects.length,
          hasFace: mergedSubjects.some((s) => !!s.face),
          hasBody: mergedSubjects.some((s) => !!s.body),
        },
        provider: {
          id: 'hybrid-coordinator',
          name: 'Hybrid Perception Coordinator (Deterministic + ML)',
          version: '1.0.0',
          type: 'hybrid',
          platform: 'browser',
          capabilities: {
            faceLandmarks: true,
            faceMeshDensity: 'dense_478',
            earPinna: true, // Preserved from deterministic detector
            jawlineContour: true,
            hairStructure: true,
            bodyPose: true, // Sourced from ML Pose Landmarker
            foregroundSegmentation: true,
            multiclassSegmentation: true,
          },
        },
        executionPlan: {
          requestedMode: 'hybrid',
          resolvedProviderId: 'hybrid-coordinator',
          fallbackOccurred: false,
          executionDurationMs: duration,
        },
      };
    } catch (err: any) {
      // Hybrid merge failed; return deterministic baseline
      const duration = performance.now() - startTime;
      return {
        ...detResult,
        executionPlan: {
          requestedMode: 'hybrid',
          resolvedProviderId: deterministicProvider.metadata.id,
          fallbackOccurred: true,
          fallbackReason: `ML augmentation failed (${err?.message ?? 'Unknown error'}). Fell back to deterministic baseline.`,
          executionDurationMs: duration,
        },
      };
    }
  }

  /**
   * Evidence-aware reconciliation:
   * - Adopts dense 3D ML facial landmarks when available.
   * - Preserves authoritative deterministic external ear pinna (which ML models omit).
   * - Preserves deterministic hair contours.
   * - Incorporates ML body skeletal pose.
   */
  private reconcileHybridSubjects(
    deterministicSubjects: SubjectModel[],
    mlSubjects: SubjectModel[]
  ): SubjectModel[] {
    return deterministicSubjects.map((detSub, idx) => {
      const mlSub = mlSubjects[idx];
      if (!mlSub) return detSub;

      return {
        ...detSub,
        face: mlSub.face
          ? {
              ...mlSub.face,
              // Crucial architectural reconciliation: Retain deterministic ear pinna
              leftEar: detSub.face?.leftEar ?? mlSub.face.leftEar,
              rightEar: detSub.face?.rightEar ?? mlSub.face.rightEar,
              featureVisibility: {
                ...mlSub.face.featureVisibility,
                leftEar: detSub.face?.featureVisibility?.leftEar ?? mlSub.face.featureVisibility?.leftEar ?? 'not_detected',
                rightEar: detSub.face?.featureVisibility?.rightEar ?? mlSub.face.featureVisibility?.rightEar ?? 'not_detected',
              },
            }
          : detSub.face,
        // Sourced from ML body pose
        body: mlSub.body ?? detSub.body,
        // Sourced from deterministic hair detector
        hair: detSub.hair ?? mlSub.hair,
      };
    });
  }
}
