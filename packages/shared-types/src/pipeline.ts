import { SubjectModel } from './subject';
import { StrokeModel } from './stroke';
import { StyleConfig } from './style';

/**
 * Pipeline processing stage status.
 */
export type PipelineStage =
  | 'idle'
  | 'preprocessing'
  | 'segmenting'
  | 'extracting_landmarks'
  | 'vectorizing_contours'
  | 'synthesizing_strokes'
  | 'rendering_animation'
  | 'completed'
  | 'failed';

export interface PipelineProgress {
  readonly stage: PipelineStage;
  readonly progress: number; // [0.0 - 1.0]
  readonly message?: string;
}

export interface RenderFrame {
  readonly currentStrokeIndex: number;
  readonly strokeProgress: number; // [0.0 - 1.0] along the current stroke
  readonly timestamp: number;
}
