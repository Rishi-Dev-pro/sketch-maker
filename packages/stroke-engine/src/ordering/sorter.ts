import {
  StrokeCandidate,
  StrokeCandidateSet,
  OrderedStroke,
  OrderedStrokeSequence,
  StrokeOrderingMetrics,
  CompositionPhase,
  StrokeOrderingConfig,
  DEFAULT_STROKE_ORDERING_CONFIG
} from './types';
import { assignCompositionPhase, PhaseInfo } from './phases';
import { analyzeDependencies } from './dependencies';
import { createStrokeComparator, SortableStrokeItem } from './comparator';

/**
 * Generates an explanatory reason string for a stroke's assigned sequence position.
 */
function generateOrderingReason(
  candidate: StrokeCandidate,
  phaseInfo: PhaseInfo,
  dependencyLevel: number
): string {
  const depStr = dependencyLevel === 0 ? 'root' : `dep-L${dependencyLevel}`;
  return `${phaseInfo.phaseName} [Phase ${phaseInfo.phaseIndex}] > ${candidate.semanticRole} (${depStr}) > imp: ${candidate.importance.toFixed(2)}`;
}

/**
 * Transforms an unordered StrokeCandidateSet into a deterministic, artistically
 * sequenced OrderedStrokeSequence.
 *
 * Guaranteed Properties:
 * 1. 100% Deterministic: identical inputs yield identical ordered sequence indices.
 * 2. Profile Occlusion: occluded far-side features (BM-02) are strictly excluded from the drawable sequence.
 * 3. Multi-Subject Isolation: subject IDs (BM-11) are strictly preserved with coordinated composition.
 * 4. Geometry Immutability: input StrokeCandidate instances are preserved without mutation.
 * 5. Pure TypeScript: zero browser or DOM runtime dependencies.
 */
export function orderStrokeCandidates(
  candidateSet: StrokeCandidateSet,
  config?: Partial<StrokeOrderingConfig>
): OrderedStrokeSequence {
  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

  const effectiveConfig: Required<StrokeOrderingConfig> = {
    ...DEFAULT_STROKE_ORDERING_CONFIG,
    ...config
  };

  const rawCandidates = candidateSet?.candidates ?? [];
  const filteredStrokes: StrokeCandidate[] = [];
  const drawableCandidates: StrokeCandidate[] = [];

  // 1. Separate drawable candidates from filtered / occluded candidates
  for (const c of rawCandidates) {
    if (!c.drawable || c.visibility === 'occluded' || c.filteredReason === 'occluded') {
      filteredStrokes.push(c);
    } else {
      drawableCandidates.push(c);
    }
  }

  // 2. Assign composition phases and map for dependency analysis
  const phaseMap = new Map<string, CompositionPhase>();
  const phaseInfoMap = new Map<string, PhaseInfo>();

  for (const c of drawableCandidates) {
    const info = assignCompositionPhase(c);
    phaseMap.set(c.id, info.phase);
    phaseInfoMap.set(c.id, info);
  }

  // 3. Analyze structural dependencies
  const { dependencyLevels, totalEdges, maxDepth } = analyzeDependencies(
    drawableCandidates,
    phaseMap
  );

  // 4. Wrap candidates into sortable items
  const sortableItems: SortableStrokeItem[] = drawableCandidates.map((c) => {
    const info = phaseInfoMap.get(c.id)!;
    const depLevel = effectiveConfig.enableDependencies
      ? (dependencyLevels.get(c.id) ?? 0)
      : 0;

    return {
      candidate: c,
      phaseIndex: info.phaseIndex,
      dependencyLevel: depLevel
    };
  });

  // 5. Multi-Subject Strategy Handling
  const comparator = createStrokeComparator(effectiveConfig);

  if (effectiveConfig.multiSubjectStrategy === 'sequential_subject') {
    // Group by subject, sort each subject individually, then concatenate in stable subject order
    const subjectsMap = new Map<string, SortableStrokeItem[]>();
    for (const item of sortableItems) {
      const sId = item.candidate.subjectId || 'subject_default';
      let list = subjectsMap.get(sId);
      if (!list) {
        list = [];
        subjectsMap.set(sId, list);
      }
      list.push(item);
    }

    const sortedSubjects = Array.from(subjectsMap.keys()).sort();
    sortableItems.length = 0;

    for (const sId of sortedSubjects) {
      const list = subjectsMap.get(sId)!;
      list.sort(comparator);
      for (const item of list) {
        sortableItems.push(item);
      }
    }
  } else {
    // Harmonized Phase Strategy (Default): Sort globally across all subjects
    sortableItems.sort(comparator);
  }

  // 6. Map to OrderedStroke array with contiguous 0-based sequenceIndex
  const orderedStrokes: OrderedStroke[] = [];
  const phaseCounts: Record<CompositionPhase, number> = {
    foundation: 0,
    primary_structure: 0,
    expressive_features: 0,
    secondary_anatomy: 0,
    refinement: 0,
    texture_accent: 0
  };
  const subjectCounts: Record<string, number> = {};

  for (let idx = 0; idx < sortableItems.length; idx++) {
    const item = sortableItems[idx];
    const candidate = item.candidate;
    const info = phaseInfoMap.get(candidate.id)!;
    const depLevel = item.dependencyLevel;

    const orderedStroke: OrderedStroke = {
      stroke: candidate,
      sequenceIndex: idx,
      phase: info.phase,
      phaseIndex: info.phaseIndex,
      phaseName: info.phaseName,
      dependencyLevel: depLevel,
      orderingReason: generateOrderingReason(candidate, info, depLevel)
    };

    orderedStrokes.push(orderedStroke);

    phaseCounts[info.phase] = (phaseCounts[info.phase] || 0) + 1;
    const sId = candidate.subjectId || 'subject_default';
    subjectCounts[sId] = (subjectCounts[sId] || 0) + 1;
  }

  const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const orderingLatencyMs = Math.round((endTime - startTime) * 100) / 100;

  const metrics: StrokeOrderingMetrics = {
    totalCandidates: rawCandidates.length,
    drawableCandidates: drawableCandidates.length,
    orderedCount: orderedStrokes.length,
    filteredCount: filteredStrokes.length,
    phaseCounts,
    subjectCounts,
    dependencyCount: totalEdges,
    maxDependencyDepth: maxDepth,
    orderingLatencyMs
  };

  return {
    version: candidateSet?.version || '0.1.0',
    strokes: orderedStrokes,
    totalStrokes: rawCandidates.length,
    drawableStrokes: orderedStrokes.length,
    filteredStrokes,
    bounds: candidateSet?.bounds || { minX: 0, minY: 0, maxX: 1, maxY: 1, width: 1, height: 1 },
    metrics,
    timestamp: Date.now()
  };
}
