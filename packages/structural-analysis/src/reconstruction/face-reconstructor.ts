import {
  Point2D,
  ContourPath,
  FeatureVisibility,
  HeadPose,
  FacialFeatures,
  EyeLandmarks,
  ReconstructedEye,
  ReconstructedEyebrow,
  ReconstructedNose,
  ReconstructedMouth,
  ReconstructedJawChin,
  ReconstructedEar,
} from '@sketch-maker/shared-types';

/**
 * Utility: computes Euclidean distance between two 2D points.
 */
function dist(p1: Point2D, p2: Point2D): number {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

/**
 * Utility: linear interpolation between two points.
 */
function lerpPoint(p1: Point2D, p2: Point2D, t: number): Point2D {
  return {
    x: Number((p1.x + (p2.x - p1.x) * t).toFixed(5)),
    y: Number((p1.y + (p2.y - p1.y) * t).toFixed(5)),
  };
}

/**
 * Utility: clamps a coordinate to [0.0, 1.0].
 */
function clamp(val: number): number {
  return Math.max(0.0, Math.min(1.0, Number(val.toFixed(5))));
}

/**
 * Smooths a polyline using Gaussian 3-point weighting.
 */
function smoothPolyline(points: readonly Point2D[], closed: boolean): Point2D[] {
  if (points.length < 3) return [...points];
  const n = points.length;
  const smoothed: Point2D[] = [];
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) {
      smoothed.push({ ...points[i] });
      continue;
    }
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];
    smoothed.push({
      x: Number((prev.x * 0.22 + curr.x * 0.56 + next.x * 0.22).toFixed(5)),
      y: Number((prev.y * 0.22 + curr.y * 0.56 + next.y * 0.22).toFixed(5)),
    });
  }
  return smoothed;
}

/**
 * Reconstructs rich, artistic eye geometry from sparse or dense perception evidence.
 * Generates:
 * 1. Continuous upper eyelid curve
 * 2. Continuous lower eyelid curve
 * 3. Converging inner and outer canthus corner ticks
 * 4. Circular/elliptical iris ring contour (not just a single zero-dimensional point)
 * 5. Pupil center and contour
 * 6. Upper eyelid crease (supratarsal fold)
 */
export function reconstructEye(
  eye: EyeLandmarks | undefined,
  side: 'left' | 'right',
  pose: HeadPose,
  confidence: number,
  subjectId: string
): ReconstructedEye | undefined {
  if (!eye) return undefined;

  const isProfileOccluded =
    (side === 'right' && (pose === 'left_profile' || eye.visibility === 'occluded')) ||
    (side === 'left' && (pose === 'right_profile' || eye.visibility === 'occluded'));

  if (isProfileOccluded || eye.visibility === 'not_detected') {
    return {
      visibility: 'occluded',
      confidence: 0.0,
      upperLid: { id: `${subjectId}_${side}_eye_upper`, region: 'eyes', points: [], closed: false, confidence: 0, visibility: 'occluded' },
      lowerLid: { id: `${subjectId}_${side}_eye_lower`, region: 'eyes', points: [], closed: false, confidence: 0, visibility: 'occluded' },
    };
  }

  const upperPts = eye.upperLid?.points ?? [];
  const lowerPts = eye.lowerLid?.points ?? [];

  if (upperPts.length < 2 && lowerPts.length < 2) {
    return undefined;
  }

  // Determine canthus endpoints
  const innerCorner = side === 'left'
    ? (upperPts[0] ?? lowerPts[0])
    : (upperPts[upperPts.length - 1] ?? lowerPts[lowerPts.length - 1]);
  const outerCorner = side === 'left'
    ? (upperPts[upperPts.length - 1] ?? lowerPts[lowerPts.length - 1])
    : (upperPts[0] ?? lowerPts[0]);

  const eyeSpan = dist(innerCorner, outerCorner);
  const eyeRadius = Math.max(0.008, eyeSpan * 0.22);

  // 1. Upper Eyelid curve with subtle thickness arch
  const smoothedUpper = upperPts.length >= 3 ? smoothPolyline(upperPts, false) : upperPts;
  const upperLid: ContourPath = {
    id: `${subjectId}_${side}_eye_upper`,
    region: 'eyes',
    points: smoothedUpper.length >= 2 ? smoothedUpper : [{ ...innerCorner }, { ...outerCorner }],
    closed: false,
    confidence: eye.confidence ?? confidence,
    visibility: 'visible',
  };

  // 2. Lower Eyelid curve (delicate and soft to avoid cartoon ocular box)
  const smoothedLower = lowerPts.length >= 3 ? smoothPolyline(lowerPts, false) : lowerPts;
  const lowerLid: ContourPath = {
    id: `${subjectId}_${side}_eye_lower`,
    region: 'eyes',
    points: smoothedLower.length >= 2 ? smoothedLower : [{ ...innerCorner }, { ...outerCorner }],
    closed: false,
    confidence: (eye.confidence ?? confidence) * 0.65,
    visibility: 'visible',
  };

  // 3. Eyelid Crease (supratarsal fold)
  let upperCrease: ContourPath | undefined = eye.upperCrease && eye.upperCrease.points.length >= 2
    ? eye.upperCrease
    : undefined;

  if (!upperCrease && upperPts.length >= 2 && eyeSpan > 0.02) {
    const creaseLift = Math.max(0.005, eyeSpan * 0.18);
    const creasePts: Point2D[] = [];
    if (upperPts.length >= 3) {
      for (let i = 0; i < upperPts.length; i++) {
        const t = i / (upperPts.length - 1);
        const weight = Math.sin(t * Math.PI);
        if (weight > 0.05) {
          creasePts.push({
            x: upperPts[i].x,
            y: clamp(upperPts[i].y - creaseLift * weight),
          });
        }
      }
    }
    if (creasePts.length < 2) {
      const mid = lerpPoint(upperPts[0], upperPts[upperPts.length - 1], 0.5);
      creasePts.length = 0;
      creasePts.push(
        lerpPoint(upperPts[0], mid, 0.4),
        { x: mid.x, y: clamp(mid.y - creaseLift) },
        lerpPoint(mid, upperPts[upperPts.length - 1], 0.6)
      );
    }
    if (creasePts.length >= 2) {
      upperCrease = {
        id: `${subjectId}_${side}_eye_crease`,
        region: 'eyes',
        points: creasePts,
        closed: false,
        confidence: (eye.confidence ?? confidence) * 0.85,
        visibility: 'visible',
      };
    }
  }

  // 4. Canthi Ticks (Anatomical corner details)
  const canthusLen = Math.max(0.003, eyeSpan * 0.12);
  const innerCanthusTick: ContourPath = {
    id: `${subjectId}_${side}_eye_inner_canthus`,
    region: 'eyes',
    points: [
      { x: clamp(innerCorner.x - (side === 'left' ? canthusLen : -canthusLen)), y: clamp(innerCorner.y + canthusLen * 0.2) },
      { x: innerCorner.x, y: innerCorner.y },
    ],
    closed: false,
    confidence: (eye.confidence ?? confidence) * 0.9,
    visibility: 'visible',
  };

  const outerCanthusTick: ContourPath = {
    id: `${subjectId}_${side}_eye_outer_canthus`,
    region: 'eyes',
    points: [
      { x: outerCorner.x, y: outerCorner.y },
      { x: clamp(outerCorner.x + (side === 'left' ? canthusLen : -canthusLen)), y: clamp(outerCorner.y - canthusLen * 0.3) },
    ],
    closed: false,
    confidence: (eye.confidence ?? confidence) * 0.9,
    visibility: 'visible',
  };

  // 5. Iris Geometry: convert point center to an artistic circular iris contour or use real perception ring
  let irisContour: ContourPath | undefined;
  let irisBoundary: ContourPath | undefined;
  const irisCenter = eye.iris ?? (upperPts.length >= 3 ? upperPts[Math.floor(upperPts.length / 2)] : undefined);

  if (eye.irisContour && eye.irisContour.points.length >= 3) {
    irisContour = eye.irisContour;
    irisBoundary = eye.irisContour;
  } else if (irisCenter && eyeSpan > 0.015) {
    const segments = 10;
    const ringPts: Point2D[] = [];
    // Draw 240-degree open crescent arc (top shaded by lid)
    const startAngle = Math.PI * 0.15;
    const endAngle = Math.PI * 0.95;
    for (let i = 0; i <= segments; i++) {
      const theta = startAngle + (endAngle - startAngle) * (i / segments);
      ringPts.push({
        x: clamp(irisCenter.x + Math.cos(theta) * eyeRadius * 0.9),
        y: clamp(irisCenter.y + Math.sin(theta) * eyeRadius),
      });
    }
    irisContour = {
      id: `${subjectId}_${side}_eye_iris_ring`,
      region: 'eyes',
      points: ringPts,
      closed: false,
      confidence: (eye.confidence ?? confidence) * 0.9,
      visibility: 'visible',
    };
    irisBoundary = irisContour;
  }

  // 6. Pupil
  const pupilCenter = eye.pupil ?? irisCenter;
  let pupilContour: ContourPath | undefined;
  if (pupilCenter && eyeSpan > 0.02) {
    const pRadius = eyeRadius * 0.45;
    const pPts: Point2D[] = [];
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      pPts.push({
        x: clamp(pupilCenter.x + Math.cos(a) * pRadius),
        y: clamp(pupilCenter.y + Math.sin(a) * pRadius),
      });
    }
    pupilContour = {
      id: `${subjectId}_${side}_eye_pupil`,
      region: 'eyes',
      points: pPts,
      closed: true,
      confidence: (eye.confidence ?? confidence) * 0.98,
      visibility: 'visible',
    };
  }

  // 7. Selected High-Value Eyelash Accents
  const lashAccents: ContourPath[] = [];
  if (upperPts.length >= 3 && eyeSpan > 0.015) {
    const lashStartIdx = side === 'left' ? Math.floor(upperPts.length * 0.75) : Math.floor(upperPts.length * 0.25);
    const pLash = upperPts[lashStartIdx];
    const lashLen = eyeSpan * 0.08;
    const dir = side === 'left' ? 1 : -1;
    lashAccents.push({
      id: `${subjectId}_${side}_eye_lash_1`,
      region: 'eyes',
      points: [
        { x: pLash.x, y: pLash.y },
        { x: clamp(pLash.x + dir * lashLen * 0.5), y: clamp(pLash.y - lashLen * 0.6) },
      ],
      closed: false,
      confidence: (eye.confidence ?? confidence) * 0.8,
      visibility: 'visible',
    });
  }
  return {
    visibility: 'visible',
    confidence: eye.confidence ?? confidence,
    upperLid,
    lowerLid,
    upperCrease,
    innerCorner,
    outerCorner,
    innerCanthusTick,
    outerCanthusTick,
    irisCenter,
    irisContour,
    irisBoundary,
    pupilCenter,
    pupilContour,
    lashAccents,
  };
}

/**
 * Reconstructs expressive eyebrow geometry with directional mass and taper.
 */
export function reconstructEyebrow(
  brow: ContourPath | undefined,
  side: 'left' | 'right',
  pose: HeadPose,
  confidence: number,
  subjectId: string
): ReconstructedEyebrow | undefined {
  if (!brow) return undefined;

  const isProfileOccluded =
    (side === 'right' && (pose === 'left_profile' || brow.visibility === 'occluded')) ||
    (side === 'left' && (pose === 'right_profile' || brow.visibility === 'occluded'));

  if (isProfileOccluded || brow.visibility === 'not_detected') {
    return {
      visibility: 'occluded',
      confidence: 0.0,
      arch: { id: `${subjectId}_${side}_brow_arch`, region: 'eyebrows', points: [], closed: false, confidence: 0, visibility: 'occluded' },
    };
  }

  const rawPts = brow.points ?? [];
  if (rawPts.length < 2) return undefined;

  // Check if rawPts is a closed loop (e.g. MediaPipe 10-point eyebrow loop)
  const isLoop = rawPts.length >= 8 &&
    dist(rawPts[0], rawPts[rawPts.length - 1]) < dist(rawPts[0], rawPts[Math.floor(rawPts.length / 2)]) * 0.7;

  let archPts: Point2D[];
  let upperPts: Point2D[] = [];
  let lowerPts: Point2D[] = [];

  if (isLoop) {
    const halfN = Math.floor(rawPts.length / 2);
    upperPts = rawPts.slice(0, halfN);
    lowerPts = rawPts.slice(halfN).reverse();
    archPts = [];
    const minLen = Math.min(upperPts.length, lowerPts.length);
    for (let i = 0; i < minLen; i++) {
      archPts.push(lerpPoint(upperPts[i], lowerPts[i], 0.5));
    }
  } else {
    archPts = [...rawPts];
    const browSpan = dist(rawPts[0], rawPts[rawPts.length - 1]);
    const thickness = Math.max(0.003, browSpan * 0.08);
    for (let i = 0; i < rawPts.length; i++) {
      const p = rawPts[i];
      const t = side === 'left' ? i / (rawPts.length - 1) : 1.0 - (i / (rawPts.length - 1));
      const taper = 1.0 - t * 0.6;
      const offset = thickness * taper;
      upperPts.push({ x: p.x, y: clamp(p.y - offset) });
      lowerPts.push({ x: p.x, y: clamp(p.y + offset * 0.6) });
    }
  }

  // Primary arch trajectory (smooth single-pass midline)
  const arch: ContourPath = {
    id: `${subjectId}_${side}_brow_arch`,
    region: 'eyebrows',
    points: archPts,
    closed: false,
    confidence: brow.confidence ?? confidence,
    visibility: 'visible',
  };

  // Medial head accent (fuller hair mass at center of brow)
  let head: ContourPath | undefined;
  const medialIdx = side === 'left' ? 0 : rawPts.length - 1;
  const nextIdx = side === 'left' ? 1 : rawPts.length - 2;
  if (rawPts.length >= 3) {
    const pM = rawPts[medialIdx];
    const pN = rawPts[nextIdx];
    const dx = pN.x - pM.x;
    const dy = pN.y - pM.y;
    head = {
      id: `${subjectId}_${side}_brow_head`,
      region: 'eyebrows',
      points: [
        { x: clamp(pM.x - dy * 0.5), y: clamp(pM.y + dx * 0.5) },
        { x: pM.x, y: pM.y },
        { x: clamp(pM.x + dy * 0.5), y: clamp(pM.y - dx * 0.5) },
      ],
      closed: false,
      confidence: (brow.confidence ?? confidence) * 0.85,
      visibility: 'visible',
    };
  }

  // Lateral tail tapering accent
  let tail: ContourPath | undefined;
  const lateralIdx = side === 'left' ? rawPts.length - 1 : 0;
  const prevIdx = side === 'left' ? rawPts.length - 2 : 1;
  if (rawPts.length >= 3) {
    const pL = rawPts[lateralIdx];
    const pP = rawPts[prevIdx];
    tail = {
      id: `${subjectId}_${side}_brow_tail`,
      region: 'eyebrows',
      points: [
        lerpPoint(pP, pL, 0.5),
        { x: pL.x, y: pL.y },
      ],
      closed: false,
      confidence: (brow.confidence ?? confidence) * 0.85,
      visibility: 'visible',
    };
  }

  // Volumetric Eyebrow Mass Contours (Upper & Lower boundaries)
  const upperContour: ContourPath = {
    id: `${subjectId}_${side}_brow_upper`,
    region: 'eyebrows',
    points: upperPts,
    closed: false,
    confidence: (brow.confidence ?? confidence) * 0.9,
    visibility: 'visible',
  };

  const lowerContour: ContourPath = {
    id: `${subjectId}_${side}_brow_lower`,
    region: 'eyebrows',
    points: lowerPts,
    closed: false,
    confidence: (brow.confidence ?? confidence) * 0.9,
    visibility: 'visible',
  };

  // 5. Directional Hair Strand Strokes (Resembles drawn hair, not a flat polygon)
  const hairStrokes: ContourPath[] = [];
  if (rawPts.length >= 3) {
    const strandCount = 6;
    const browSpan = dist(rawPts[0], rawPts[rawPts.length - 1]);
    const strandLen = Math.max(0.004, browSpan * 0.14);
    for (let s = 0; s < strandCount; s++) {
      const t = s / (strandCount - 1);
      const ptIdx = Math.floor(t * (rawPts.length - 1));
      const pt = rawPts[ptIdx];
      // Hair angles upward at the medial head, flattening toward the tail
      const angle = (1.0 - t) * (Math.PI * 0.35) + t * (Math.PI * 0.06);
      const dirX = side === 'left' ? Math.cos(angle) : -Math.cos(angle);
      const dirY = -Math.sin(angle);
      hairStrokes.push({
        id: `${subjectId}_${side}_brow_hair_${s}`,
        region: 'eyebrows',
        points: [
          { x: pt.x, y: pt.y },
          { x: clamp(pt.x + dirX * strandLen), y: clamp(pt.y + dirY * strandLen) },
        ],
        closed: false,
        confidence: (brow.confidence ?? confidence) * 0.85,
        visibility: 'visible',
      });
    }
  }

  return {
    visibility: 'visible',
    confidence: brow.confidence ?? confidence,
    arch,
    head,
    tail,
    upperContour,
    lowerContour,
    hairStrokes,
  };
}

/**
 * Reconstructs meaningful nose structure (bridge, tip dome, columella, alar wings).
 * Fixes the critical bug where single-point nose tips were dropped by downstream extractors.
 */
export function reconstructNose(
  bridge: ContourPath | undefined,
  tip: ContourPath | undefined,
  nostrils: ContourPath[] | undefined,
  pose: HeadPose,
  confidence: number,
  subjectId: string,
  columellaPath?: ContourPath,
  subnasalePath?: ContourPath
): ReconstructedNose | undefined {
  if (pose === 'left_profile' || pose === 'right_profile') {
    // In profile, nose is predominantly captured by anterior contour
  }

  const bridgePts = bridge?.points ?? [];
  const tipPts = tip?.points ?? [];

  if (bridgePts.length < 2 && tipPts.length === 0) {
    return undefined;
  }

  // Synthesize apex anchor
  const tipAnchor: Point2D = tipPts.length > 0
    ? tipPts[Math.floor(tipPts.length / 2)]
    : (bridgePts.length > 0 ? bridgePts[bridgePts.length - 1] : { x: 0.5, y: 0.5 });

  // 1. Nasal dorsum bridge line:
  // In portrait sketching, DO NOT draw a harsh central wire down the nose bridge!
  // Instead, shift the bridge line slightly to the shadow side and keep it faint,
  // allowing the side wall chiaroscuro to model the nose form.
  const shadowSideOffset = pose === 'left_profile' || pose === 'three_quarter_left' ? -0.007 : 0.007;
  const dorsumPts = bridgePts.length >= 2
    ? bridgePts.map(p => ({ x: clamp(p.x + shadowSideOffset), y: p.y }))
    : [
        { x: clamp(tipAnchor.x + shadowSideOffset), y: clamp(tipAnchor.y - 0.08) },
        { x: clamp(tipAnchor.x + shadowSideOffset * 0.7), y: tipAnchor.y },
      ];

  const noseBridge: ContourPath = {
    id: `${subjectId}_nose_bridge`,
    region: 'nose',
    points: dorsumPts,
    closed: false,
    confidence: (bridge?.confidence ?? confidence) * 0.50,
    visibility: 'visible',
  };

  // 2. Nose Tip Dome: Multi-point convex apex curve (guarantees length >= 3)
  const tipSpan = 0.012;
  const tipCurvePts: Point2D[] = tipPts.length >= 2
    ? [...tipPts]
    : [
        { x: clamp(tipAnchor.x - tipSpan), y: clamp(tipAnchor.y - 0.002) },
        { x: tipAnchor.x, y: clamp(tipAnchor.y + 0.003) },
        { x: clamp(tipAnchor.x + tipSpan), y: clamp(tipAnchor.y - 0.002) },
      ];

  const noseTip: ContourPath = {
    id: `${subjectId}_nose_tip_dome`,
    region: 'nose',
    points: tipCurvePts,
    closed: false,
    confidence: tip?.confidence ?? confidence,
    visibility: 'visible',
  };

  // 3. Columella / under-nose base shadow curve
  const columellaPts: Point2D[] = [
    { x: clamp(tipAnchor.x - tipSpan * 0.8), y: clamp(tipAnchor.y + 0.005) },
    { x: tipAnchor.x, y: clamp(tipAnchor.y + 0.008) },
    { x: clamp(tipAnchor.x + tipSpan * 0.8), y: clamp(tipAnchor.y + 0.005) },
  ];
  const underside: ContourPath = {
    id: `${subjectId}_nose_underside`,
    region: 'nose',
    points: columellaPts,
    closed: false,
    confidence: confidence * 0.9,
    visibility: 'visible',
  };

  const columella = columellaPath ?? underside;
  const subnasale = subnasalePath;

  // 4. Nostril wings / alae & Dark Apertures
  let leftAla: ContourPath | undefined;
  let rightAla: ContourPath | undefined;
  let leftNostril: ContourPath | undefined;
  let rightNostril: ContourPath | undefined;

  if (nostrils && nostrils.length > 0) {
    if (nostrils[0] && nostrils[0].points.length >= 2) {
      leftAla = {
        id: `${subjectId}_nose_ala_left`,
        region: 'nose',
        points: [...nostrils[0].points],
        closed: nostrils[0].closed ?? false,
        confidence: nostrils[0].confidence,
        visibility: 'visible',
      };
    }
    if (nostrils.length >= 2 && nostrils[1] && nostrils[1].points.length >= 2) {
      if (nostrils.length >= 4) {
        leftNostril = nostrils[1];
        rightAla = nostrils[2];
        rightNostril = nostrils[3];
      } else {
        rightAla = {
          id: `${subjectId}_nose_ala_right`,
          region: 'nose',
          points: [...nostrils[1].points],
          closed: nostrils[1].closed ?? false,
          confidence: nostrils[1].confidence,
          visibility: 'visible',
        };
      }
    }
  }

  // Synthesize dark nostril apertures if not detected as distinct 4-contour set
  const nY = clamp(tipAnchor.y + 0.004);
  if (!leftNostril && pose !== 'right_profile') {
    leftNostril = {
      id: `${subjectId}_nose_nostril_left`,
      region: 'nose',
      points: [
        { x: clamp(tipAnchor.x - tipSpan * 0.75), y: nY },
        { x: clamp(tipAnchor.x - tipSpan * 0.40), y: clamp(nY + 0.003) },
        { x: clamp(tipAnchor.x - tipSpan * 0.18), y: nY },
      ],
      closed: false,
      confidence: confidence * 0.96,
      visibility: 'visible',
    };
  }

  if (!rightNostril && pose !== 'left_profile') {
    rightNostril = {
      id: `${subjectId}_nose_nostril_right`,
      region: 'nose',
      points: [
        { x: clamp(tipAnchor.x + tipSpan * 0.18), y: nY },
        { x: clamp(tipAnchor.x + tipSpan * 0.40), y: clamp(nY + 0.003) },
        { x: clamp(tipAnchor.x + tipSpan * 0.75), y: nY },
      ],
      closed: false,
      confidence: confidence * 0.96,
      visibility: 'visible',
    };
  }

  return {
    visibility: 'visible',
    confidence,
    bridge: noseBridge,
    tip: noseTip,
    underside,
    columella,
    subnasale,
    leftAla,
    rightAla,
    leftNostril,
    rightNostril,
  };
}

/**
 * Reconstructs mouth structure with oral fissure, commissure corner ticks,
 * cupid's bow vermilion, and lower lip curvature.
 */
export function reconstructMouth(
  upperLip: ContourPath | undefined,
  lowerLip: ContourPath | undefined,
  fissure: ContourPath | undefined,
  pose: HeadPose,
  confidence: number,
  subjectId: string,
  philtrumPaths?: readonly ContourPath[]
): ReconstructedMouth | undefined {
  const fissurePts = fissure?.points ?? [];
  const upperPts = upperLip?.points ?? [];
  const lowerPts = lowerLip?.points ?? [];

  if (fissurePts.length < 2 && upperPts.length < 2 && lowerPts.length < 2) {
    return undefined;
  }

  // 1. Primary expressive seam: Oral Fissure
  const rawSeam = fissurePts.length >= 2
    ? [...fissurePts]
    : (upperPts.length >= 2 ? [...upperPts] : [...lowerPts]);
  const seamPts = rawSeam.length >= 3 ? smoothPolyline(rawSeam, false) : rawSeam;

  const oralFissure: ContourPath = {
    id: `${subjectId}_mouth_fissure`,
    region: 'mouth',
    points: seamPts,
    closed: false,
    confidence: Math.max(0.50, fissure?.confidence ?? confidence),
    visibility: 'visible',
  };

  // 2. Commissure Corner ticks (expressive corner anchors)
  let leftCorner: ContourPath | undefined;
  let rightCorner: ContourPath | undefined;
  // Subtle deepening at commissure corners rather than protruding ticks
  if (seamPts.length >= 2) {
    const leftPt = seamPts[0];
    const rightPt = seamPts[seamPts.length - 1];
    if (pose !== 'right_profile') {
      leftCorner = {
        id: `${subjectId}_mouth_corner_left`,
        region: 'mouth',
        points: [
          { x: clamp(leftPt.x - 0.003), y: clamp(leftPt.y - 0.001) },
          { x: leftPt.x, y: leftPt.y },
        ],
        closed: false,
        confidence: Math.max(0.55, confidence * 0.9),
        visibility: 'visible',
      };
    }
    if (pose !== 'left_profile') {
      rightCorner = {
        id: `${subjectId}_mouth_corner_right`,
        region: 'mouth',
        points: [
          { x: rightPt.x, y: rightPt.y },
          { x: clamp(rightPt.x + 0.003), y: clamp(rightPt.y - 0.001) },
        ],
        closed: false,
        confidence: Math.max(0.55, confidence * 0.9),
        visibility: 'visible',
      };
    }
  }

  // 3. Upper Lip vermilion contour with cupid's bow
  let upperVermilion: ContourPath | undefined;
  if (upperPts.length >= 2) {
    upperVermilion = {
      id: `${subjectId}_mouth_upper_lip`,
      region: 'mouth',
      points: [...upperPts],
      closed: false,
      confidence: Math.max(0.45, upperLip?.confidence ?? confidence),
      visibility: 'visible',
    };
  }

  // 4. Lower Lip vermilion contour:
  // In portrait sketching, the lower lip is lit from above.
  // Soften the lower contour so the central highlight is preserved without a harsh black outline box.
  // Enforce a confidence floor of 0.35 so soft lower lip is not dropped by minConfidence (0.15).
  let lowerVermilion: ContourPath | undefined;
  if (lowerPts.length >= 2) {
    const rawLowerConf = (lowerLip?.confidence ?? confidence) * 0.60;
    lowerVermilion = {
      id: `${subjectId}_mouth_lower_lip`,
      region: 'mouth',
      points: [...lowerPts],
      closed: false,
      confidence: Math.max(0.35, rawLowerConf),
      visibility: 'visible',
    };
  }

  // 5. Mental crease accent below lower lip
  let mentalCrease: ContourPath | undefined;
  if (lowerPts.length >= 3) {
    const midIdx = Math.floor(lowerPts.length / 2);
    const midP = lowerPts[midIdx];
    const span = 0.015;
    mentalCrease = {
      id: `${subjectId}_mouth_mental_crease`,
      region: 'mouth',
      points: [
        { x: clamp(midP.x - span), y: clamp(midP.y + 0.012) },
        { x: midP.x, y: clamp(midP.y + 0.015) },
        { x: clamp(midP.x + span), y: clamp(midP.y + 0.012) },
      ],
      closed: false,
      confidence: confidence * 0.8,
      visibility: 'visible',
    };
  }

  return {
    visibility: 'visible',
    confidence,
    oralFissure,
    leftCorner,
    rightCorner,
    upperVermilion,
    lowerVermilion,
    mentalCrease,
    philtrum: philtrumPaths,
  };
}

/**
 * Reconstructs jawline curvature and distinct chin apex dome.
 * Fixes:
 * 1. Dropping of single-point chin in MediaPipe / hybrid
 * 2. Dropping half of bilateral jaw in deterministic
 * 3. Preserves profile anterior facial contour for BM-02
 */
export function reconstructJawChin(
  jawline: ContourPath | undefined,
  chin: ContourPath | undefined,
  pose: HeadPose,
  confidence: number,
  subjectId: string,
  malarPaths?: readonly ContourPath[]
): ReconstructedJawChin | undefined {
  const jawPts = jawline?.points ?? [];
  const chinPts = chin?.points ?? [];

  if (jawPts.length < 2 && chinPts.length === 0) {
    return undefined;
  }

  // 1. Chin apex dome curve (guarantees multi-point arc)
  let chinContour: ContourPath;
  if (chinPts.length >= 2) {
    chinContour = {
      id: `${subjectId}_face_chin_dome`,
      region: 'jawline',
      points: [...chinPts],
      closed: false,
      confidence: chin?.confidence ?? confidence,
      visibility: 'visible',
    };
  } else {
    // Synthesize chin dome from apex anchor or lowest jaw point
    const apexAnchor: Point2D = chinPts.length === 1
      ? chinPts[0]
      : (jawPts.length > 0
          ? jawPts.reduce((lowest, p) => (p.y > lowest.y ? p : lowest), jawPts[0])
          : { x: 0.5, y: 0.85 });

    const chinWidth = 0.025;
    chinContour = {
      id: `${subjectId}_face_chin_dome`,
      region: 'jawline',
      points: [
        { x: clamp(apexAnchor.x - chinWidth), y: clamp(apexAnchor.y - 0.005) },
        { x: apexAnchor.x, y: clamp(apexAnchor.y + 0.004) },
        { x: clamp(apexAnchor.x + chinWidth), y: clamp(apexAnchor.y - 0.005) },
      ],
      closed: false,
      confidence: chin?.confidence ?? confidence,
      visibility: 'visible',
    };
  }

  // 2. Mandibular Jawline: extract jaw curvature
  const rawJaw = jawPts.length >= 2 ? [...jawPts] : [...chinContour.points];
  const jawPoints = smoothPolyline(rawJaw, false);
  const reconstructedJaw: ContourPath = {
    id: `${subjectId}_face_mandibular_jaw`,
    region: 'jawline',
    points: jawPoints,
    closed: false,
    confidence: jawline?.confidence ?? confidence,
    visibility: 'visible',
  };

  // 3. Profile anterior contour in profile poses (BM-02)
  let profileContour: ContourPath | undefined;
  if (pose === 'left_profile' || pose === 'right_profile') {
    profileContour = {
      id: `${subjectId}_face_profile_anterior`,
      region: 'face_contour',
      points: jawPoints,
      closed: false,
      confidence,
      visibility: 'visible',
    };
  }

  return {
    visibility: 'visible',
    confidence,
    jawline: reconstructedJaw,
    chin: chinContour,
    profileContour,
    malarPlanes: malarPaths,
  };
}

/**
 * Reconstructs ear anatomy (helix rim, concha accent).
 */
export function reconstructEar(
  ear: ContourPath | undefined,
  side: 'left' | 'right',
  pose: HeadPose,
  confidence: number,
  subjectId: string
): ReconstructedEar | undefined {
  if (!ear) return undefined;

  const isProfileOccluded =
    (side === 'right' && (pose === 'left_profile' || ear.visibility === 'occluded')) ||
    (side === 'left' && (pose === 'right_profile' || ear.visibility === 'occluded'));

  if (isProfileOccluded || ear.visibility === 'not_detected') {
    return {
      visibility: 'occluded',
      confidence: 0.0,
      helix: { id: `${subjectId}_${side}_ear_helix`, region: 'ears', points: [], closed: false, confidence: 0, visibility: 'occluded' },
    };
  }

  const rawPts = ear.points ?? [];
  if (rawPts.length < 2) return undefined;

  // Helical outer rim
  const helix: ContourPath = {
    id: `${subjectId}_${side}_ear_helix`,
    region: 'ears',
    points: [...rawPts],
    closed: false,
    confidence: ear.confidence ?? confidence,
    visibility: 'visible',
  };

  // Conchal hollow / antihelix inner accent curve
  let concha: ContourPath | undefined;
  if (rawPts.length >= 4) {
    const innerPts: Point2D[] = [];
    const dir = side === 'left' ? 1 : -1;
    for (let i = 1; i < rawPts.length - 1; i++) {
      innerPts.push({
        x: clamp(rawPts[i].x + dir * 0.008),
        y: rawPts[i].y,
      });
    }
    if (innerPts.length >= 2) {
      concha = {
        id: `${subjectId}_${side}_ear_concha`,
        region: 'ears',
        points: innerPts,
        closed: false,
        confidence: (ear.confidence ?? confidence) * 0.85,
        visibility: 'visible',
      };
    }
  }

  return {
    visibility: 'visible',
    confidence: ear.confidence ?? confidence,
    helix,
    concha,
  };
}
