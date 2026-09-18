/**
 * MediaPipe Tasks Vision Web Integration Module
 * TASK-103.7 MediaPipe Integration
 *
 * Provides factory functions, configuration contracts, landmark mappers,
 * and the lazy-loaded web runtime delegate.
 */

import { MediaPipeVisionProvider } from '@sketch-maker/structural-analysis';
import { MediaPipeWebDelegate } from './mediapipe-delegate';
import { MediaPipeModelConfig, DEFAULT_MEDIAPIPE_CONFIG } from './model-config';

export * from './model-config';
export * from './landmark-mapper';
export * from './pose-mapper';
export * from './face-pose-associator';
export * from './mediapipe-delegate';

/**
 * Creates an instance of MediaPipeVisionProvider configured with the
 * lazy-loaded MediaPipeWebDelegate for web runtime execution.
 */
export function createMediaPipeWebProvider(
  config?: Partial<MediaPipeModelConfig>
): {
  provider: MediaPipeVisionProvider;
  delegate: MediaPipeWebDelegate;
} {
  const delegate = new MediaPipeWebDelegate(config);
  const provider = new MediaPipeVisionProvider(delegate);

  return { provider, delegate };
}
