import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  VisionCoordinator,
  DeterministicVisionProvider,
  VisionResult,
  VisionExecutionMode,
} from '@sketch-maker/structural-analysis';
import { preprocessPixelBuffer, PixelBuffer } from '@sketch-maker/image-processing';
import {
  extractAllVectorGeometry,
  VectorGeometry,
  generateStrokeCandidates,
  StrokeCandidateSet,
  orderStrokeCandidates,
  OrderedStrokeSequence,
  OrderedStroke,
  CompositionPhase,
  createStrokeTimeline,
  StrokeTimeline,
  getTimelineState,
  TimelineState,
} from '@sketch-maker/stroke-engine';
import { createMediaPipeWebProvider, MediaPipeWebDelegate } from './vision/mediapipe';

interface BenchmarkItem {
  id: string;
  filename: string;
  title?: string;
  name?: string;
  category: string;
  aspectRatio?: string;
  challengeFactors?: string[];
}

interface BenchmarkRunResult {
  id: string;
  name: string;
  mode: VisionExecutionMode;
  providerId: string;
  durationMs: number;
  faceDetected: boolean;
  poseDetected: boolean;
  poseJointCount: number;
  pose: string;
  earCount: number;
  segmentationDetected: boolean;
  segmentationCategories: number;
  vectorPathsCount: number;
  vectorReductionPct: number;
  strokeCandidatesCount: number;
  strokeDrawableCount: number;
  orderedStrokesCount: number;
  timelineStrokesCount: number;
  timelineDurationS: number;
  fallback: boolean;
}


export const App: React.FC = () => {
  const [benchmarks, setBenchmarks] = useState<BenchmarkItem[]>([]);
  const [selectedBenchmarkId, setSelectedBenchmarkId] = useState<string>('bm-01');
  const [mode, setMode] = useState<VisionExecutionMode>('hybrid');
  const [perceptionScope, setPerceptionScope] = useState<'all' | 'face_only' | 'pose_only' | 'segment_only'>('all');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [currentResult, setCurrentResult] = useState<VisionResult | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('Ready for analysis');
  const [delegateState, setDelegateState] = useState<string>('uninitialized');

  // Visualization toggles
  const [showFaceMesh, setShowFaceMesh] = useState<boolean>(true);
  const [showEarPinna, setShowEarPinna] = useState<boolean>(true);
  const [showHair, setShowHair] = useState<boolean>(true);
  const [showFacialContours, setShowFacialContours] = useState<boolean>(true);
  const [showPoseSkeleton, setShowPoseSkeleton] = useState<boolean>(true);
  const [showPoseLandmarks, setShowPoseLandmarks] = useState<boolean>(true);
  const [showSemanticMasks, setShowSemanticMasks] = useState<boolean>(true);
  const [showSemanticHair, setShowSemanticHair] = useState<boolean>(true);
  const [showSemanticSkin, setShowSemanticSkin] = useState<boolean>(true);
  const [showSemanticClothing, setShowSemanticClothing] = useState<boolean>(true);
  const [showVectorGeometry, setShowVectorGeometry] = useState<boolean>(false);
  const [showVectorCurves, setShowVectorCurves] = useState<boolean>(true);
  const [showImportanceHeatmap, setShowImportanceHeatmap] = useState<boolean>(false);
  const [showStrokeCandidates, setShowStrokeCandidates] = useState<boolean>(false);
  const [strokeDrawableOnly, setStrokeDrawableOnly] = useState<boolean>(false);
  const [strokeColorMode, setStrokeColorMode] = useState<'role' | 'importance' | 'width'>('role');
  const [showStrokeOrdering, setShowStrokeOrdering] = useState<boolean>(true);
  const [orderingColorMode, setOrderingColorMode] = useState<'phase' | 'gradient' | 'dependency'>('phase');
  const [orderingSubjectFilter, setOrderingSubjectFilter] = useState<string>('all');
  const [showSequenceIndices, setShowSequenceIndices] = useState<boolean>(false);
  const [showTimeline, setShowTimeline] = useState<boolean>(true);
  const [timelineScrubPct, setTimelineScrubPct] = useState<number>(100);

  // Derive Vector Geometry Intermediate Representation (TASK-104)
  const currentGeometry: VectorGeometry | null = useMemo(() => {
    if (!currentResult || !currentResult.subjects || currentResult.subjects.length === 0) {
      return null;
    }
    return extractAllVectorGeometry(currentResult.subjects);
  }, [currentResult]);

  // Derive Procedural Stroke Candidates (TASK-105)
  const currentStrokeCandidates: StrokeCandidateSet | null = useMemo(() => {
    if (!currentGeometry) {
      return null;
    }
    return generateStrokeCandidates(currentGeometry);
  }, [currentGeometry]);

  // Derive Ordered Stroke Sequence (TASK-106)
  const currentOrderedSequence: OrderedStrokeSequence | null = useMemo(() => {
    if (!currentStrokeCandidates) {
      return null;
    }
    return orderStrokeCandidates(currentStrokeCandidates);
  }, [currentStrokeCandidates]);

  // Derive Progressive Stroke Timeline (TASK-107)
  const currentTimeline: StrokeTimeline | null = useMemo(() => {
    if (!currentOrderedSequence || currentOrderedSequence.drawableStrokes === 0) {
      return null;
    }
    return createStrokeTimeline(currentOrderedSequence, {
      targetDurationMs: 15000 // Standard 15-second animation baseline
    });
  }, [currentOrderedSequence]);

  // Derive Real-Time Scrub State (TASK-107)
  const currentTimelineState: TimelineState | null = useMemo(() => {
    if (!currentTimeline) {
      return null;
    }
    const queryTime = (currentTimeline.totalDurationMs * timelineScrubPct) / 100;
    return getTimelineState(currentTimeline, queryTime);
  }, [currentTimeline, timelineScrubPct]);


  // Batch benchmark results
  const [batchResults, setBatchResults] = useState<BenchmarkRunResult[]>([]);
  const [isBatchRunning, setIsBatchRunning] = useState<boolean>(false);

  // Canvas refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const currentImageRef = useRef<HTMLImageElement | null>(null);

  // Persistent coordinator and delegate references
  const coordinatorRef = useRef<VisionCoordinator | null>(null);
  const delegateRef = useRef<MediaPipeWebDelegate | null>(null);

  // Initialize coordinator on mount
  useEffect(() => {
    const { provider: mpProvider, delegate: mpDelegate } = createMediaPipeWebProvider({
      delegate: 'GPU',
      maxFaces: 4,
    });
    delegateRef.current = mpDelegate;

    const coordinator = new VisionCoordinator({
      defaultMode: 'hybrid',
      providers: [new DeterministicVisionProvider(), mpProvider],
    });
    coordinatorRef.current = coordinator;

    // Load dataset manifest
    fetch('/benchmark-images/dataset.json')
      .then((res) => res.json())
      .then((data) => {
        if (data.categories) {
          setBenchmarks(data.categories);
        }
      })
      .catch((err) => {
        console.warn('Could not load benchmark manifest from public directory:', err);
      });
  }, []);

  // Update delegate state display periodically
  useEffect(() => {
    const interval = setInterval(() => {
      if (delegateRef.current) {
        setDelegateState(delegateRef.current.getState());
      }
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Render visualization onto canvas whenever result or toggles change
  useEffect(() => {
    if (!canvasRef.current || !currentImageRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = currentImageRef.current;
    canvas.width = img.naturalWidth || 800;
    canvas.height = img.naturalHeight || 800;

    // Draw base photograph
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    if (!currentResult || !currentResult.primarySubject) return;

    const subject = currentResult.primarySubject;
    const W = canvas.width;
    const H = canvas.height;

    // Dim background slightly to enhance vector visibility
    ctx.fillStyle = 'rgba(10, 11, 16, 0.35)';
    ctx.fillRect(0, 0, W, H);

    // 0. Draw Semantic Segmentation Masks (Alpha Blend Overlay)
    if (showSemanticMasks && subject.semanticSegmentation?.masks) {
      const masks = subject.semanticSegmentation.masks;
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = W;
      maskCanvas.height = H;
      const mCtx = maskCanvas.getContext('2d');

      if (mCtx) {
        const mImgData = mCtx.createImageData(W, H);
        const mPixels = mImgData.data;

        for (const sMask of masks) {
          if (sMask.category === 'background') continue;
          if (sMask.category === 'hair' && !showSemanticHair) continue;
          if ((sMask.category === 'face_skin' || sMask.category === 'body_skin') && !showSemanticSkin) continue;
          if (sMask.category === 'clothing' && !showSemanticClothing) continue;

          let r = 255, g = 255, b = 255, a = 110;
          if (sMask.category === 'hair') { r = 168; g = 85; b = 247; a = 115; }
          else if (sMask.category === 'face_skin') { r = 251; g = 146; b = 60; a = 95; }
          else if (sMask.category === 'body_skin') { r = 245; g = 158; b = 11; a = 95; }
          else if (sMask.category === 'clothing') { r = 6; g = 182; b = 212; a = 105; }
          else if (sMask.category === 'accessories') { r = 16; g = 185; b = 129; a = 110; }

          const maskData = sMask.data;
          const maskW = sMask.width;
          const maskH = sMask.height;

          if (maskW === W && maskH === H) {
            for (let i = 0; i < maskData.length; i++) {
              if (maskData[i] > 0) {
                const pIdx = i * 4;
                mPixels[pIdx] = r;
                mPixels[pIdx + 1] = g;
                mPixels[pIdx + 2] = b;
                mPixels[pIdx + 3] = a;
              }
            }
          }
        }

        mCtx.putImageData(mImgData, 0, 0);
        ctx.drawImage(maskCanvas, 0, 0);
      }
    }

    // 1. Draw Hair & Silhouette Contours
    if (showHair && subject.hair) {
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#c084fc'; // Purple / Magenta
      ctx.fillStyle = 'rgba(192, 132, 252, 0.08)';

      for (const path of subject.hair) {
        if (path.points.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(path.points[0].x * W, path.points[0].y * H);
        for (let i = 1; i < path.points.length; i++) {
          ctx.lineTo(path.points[i].x * W, path.points[i].y * H);
        }
        if (path.closed) ctx.closePath();
        ctx.stroke();
        if (path.closed) ctx.fill();
      }
    }

    // 2. Draw Facial Contours
    const face = subject.face;
    if (face) {
      // Draw Jawline / Face Oval
      if (showFacialContours && face.jawline) {
        ctx.lineWidth = 2.0;
        ctx.strokeStyle = '#38bdf8'; // Sky Blue
        ctx.beginPath();
        const pts = face.jawline.points;
        if (pts.length > 1) {
          ctx.moveTo(pts[0].x * W, pts[0].y * H);
          for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i].x * W, pts[i].y * H);
          }
          if (face.jawline.closed) ctx.closePath();
          ctx.stroke();
        }
      }

      // Draw Eyes and Irises
      if (showFacialContours) {
        const drawEye = (upper?: any, lower?: any, iris?: any) => {
          ctx.lineWidth = 2.0;
          ctx.strokeStyle = '#00f0ff'; // Cyan
          if (upper && upper.points.length > 1) {
            ctx.beginPath();
            ctx.moveTo(upper.points[0].x * W, upper.points[0].y * H);
            for (let i = 1; i < upper.points.length; i++) {
              ctx.lineTo(upper.points[i].x * W, upper.points[i].y * H);
            }
            ctx.stroke();
          }
          if (lower && lower.points.length > 1) {
            ctx.beginPath();
            ctx.moveTo(lower.points[0].x * W, lower.points[0].y * H);
            for (let i = 1; i < lower.points.length; i++) {
              ctx.lineTo(lower.points[i].x * W, lower.points[i].y * H);
            }
            ctx.stroke();
          }
          if (iris) {
            ctx.fillStyle = '#00f0ff';
            ctx.beginPath();
            ctx.arc(iris.x * W, iris.y * H, 3.5, 0, Math.PI * 2);
            ctx.fill();
          }
        };

        if (face.leftEye?.visibility === 'visible') {
          drawEye(face.leftEye.upperLid, face.leftEye.lowerLid, face.leftEye.iris);
        }
        if (face.rightEye?.visibility === 'visible') {
          drawEye(face.rightEye.upperLid, face.rightEye.lowerLid, face.rightEye.iris);
        }

        // Draw Eyebrows
        const drawContour = (c?: any, stroke = '#818cf8', width = 2.0) => {
          if (!c || c.points.length < 2) return;
          ctx.lineWidth = width;
          ctx.strokeStyle = stroke;
          ctx.beginPath();
          ctx.moveTo(c.points[0].x * W, c.points[0].y * H);
          for (let i = 1; i < c.points.length; i++) {
            ctx.lineTo(c.points[i].x * W, c.points[i].y * H);
          }
          ctx.stroke();
        };

        if (face.leftEyebrow?.visibility === 'visible') drawContour(face.leftEyebrow, '#818cf8');
        if (face.rightEyebrow?.visibility === 'visible') drawContour(face.rightEyebrow, '#818cf8');

        // Draw Nose
        drawContour(face.noseBridge, '#34d399');
        if (face.noseTip) {
          ctx.fillStyle = '#34d399';
          ctx.beginPath();
          ctx.arc(face.noseTip.points[0].x * W, face.noseTip.points[0].y * H, 4, 0, Math.PI * 2);
          ctx.fill();
        }
        if (face.nostrils) {
          face.nostrils.forEach((n) => drawContour(n, '#10b981'));
        }

        // Draw Lips
        drawContour(face.upperLip, '#f43f5e');
        drawContour(face.lowerLip, '#f43f5e');
        drawContour(face.lipSeparation, '#fb7185', 2.5);
      }

      // 3. Draw Deterministic Ear Pinna (Gold Highlight)
      if (showEarPinna) {
        const drawEar = (ear?: any, label = 'Ear Pinna') => {
          if (!ear || ear.points.length < 2) return;
          ctx.lineWidth = 3.5;
          ctx.strokeStyle = '#f59e0b'; // Amber / Gold
          ctx.fillStyle = 'rgba(245, 158, 11, 0.15)';
          ctx.beginPath();
          ctx.moveTo(ear.points[0].x * W, ear.points[0].y * H);
          for (let i = 1; i < ear.points.length; i++) {
            ctx.lineTo(ear.points[i].x * W, ear.points[i].y * H);
          }
          ctx.stroke();
          ctx.fill();

          // Label
          ctx.font = '11px monospace';
          ctx.fillStyle = '#fbbf24';
          ctx.fillText(label, ear.points[0].x * W - 10, ear.points[0].y * H - 6);
        };

        if (face.leftEar && face.featureVisibility?.leftEar !== 'occluded') {
          drawEar(face.leftEar, 'Left Ear Pinna');
        }
        if (face.rightEar && face.featureVisibility?.rightEar !== 'occluded') {
          drawEar(face.rightEar, 'Right Ear Pinna');
        }
      }
    }

    // 4. Draw Body Pose Skeleton & Articulated Joints
    if (subject.body?.pose) {
      const pose = subject.body.pose;

      // Draw Skeletal Bones
      if (showPoseSkeleton && pose.connections) {
        ctx.lineWidth = 3.5;
        for (const conn of pose.connections) {
          ctx.beginPath();
          ctx.moveTo(conn.from.x * W, conn.from.y * H);
          ctx.lineTo(conn.to.x * W, conn.to.y * H);

          if (conn.name.includes('arm')) {
            ctx.strokeStyle = '#38bdf8'; // Sky Blue for arms
          } else if (conn.name.includes('leg') || conn.name.includes('thigh') || conn.name.includes('shin')) {
            ctx.strokeStyle = '#fbbf24'; // Amber for legs
          } else if (conn.name.includes('torso') || conn.name.includes('pelvis') || conn.name === 'shoulders') {
            ctx.strokeStyle = '#a855f7'; // Purple for torso
          } else {
            ctx.strokeStyle = '#10b981'; // Emerald for spine/head
          }
          ctx.stroke();
        }
      }

      // Draw Joint Keypoints
      if (showPoseLandmarks && pose.landmarks) {
        for (const lm of pose.landmarks) {
          if (lm.visibility === 'occluded') continue;
          ctx.beginPath();
          const isMajor = lm.id.includes('shoulder') || lm.id.includes('hip') || lm.id === 'neck';
          const radius = isMajor ? 6.0 : 4.0;
          ctx.arc(lm.point.x * W, lm.point.y * H, radius, 0, Math.PI * 2);
          ctx.fillStyle = lm.visibility === 'visible' ? '#ffffff' : '#f59e0b';
          ctx.fill();
          ctx.lineWidth = 2.0;
          ctx.strokeStyle = '#00f0ff';
          ctx.stroke();
        }
      }
    }

    // 5. Draw TASK-104 Vector Geometry
    if (showVectorGeometry && currentGeometry && currentGeometry.paths.length > 0) {
      for (const vpath of currentGeometry.paths) {
        ctx.save();

        if (showImportanceHeatmap) {
          const imp = vpath.importance;
          const r = Math.round(Math.min(255, Math.max(0, (imp - 0.35) * 2.0 * 255)));
          const g = Math.round(Math.min(255, Math.max(0, (1.0 - Math.abs(imp - 0.5) * 2.0) * 255)));
          const b = Math.round(Math.min(255, Math.max(0, (0.65 - imp) * 2.5 * 255)));
          ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
          ctx.lineWidth = 2.2;
        } else {
          switch (vpath.level) {
            case 0: // Silhouette
              ctx.strokeStyle = '#00f0ff';
              ctx.lineWidth = 3.2;
              break;
            case 1: // Structure
              ctx.strokeStyle = '#38bdf8';
              ctx.lineWidth = 2.4;
              break;
            case 2: // Anatomy
              ctx.strokeStyle = '#fbbf24';
              ctx.lineWidth = 2.0;
              break;
            case 3: // Semantic
              ctx.strokeStyle = '#c084fc';
              ctx.lineWidth = 1.8;
              break;
            case 4: // Fine detail
              ctx.strokeStyle = '#f43f5e';
              ctx.lineWidth = 1.5;
              break;
            default:
              ctx.strokeStyle = '#94a3b8';
              ctx.lineWidth = 1.5;
          }
        }

        if (showVectorCurves && vpath.curves && vpath.curves.length > 0) {
          ctx.beginPath();
          const first = vpath.curves[0];
          ctx.moveTo(first.start.x * W, first.start.y * H);
          for (const curve of vpath.curves) {
            ctx.bezierCurveTo(
              curve.cp1.x * W,
              curve.cp1.y * H,
              curve.cp2 ? curve.cp2.x * W : curve.cp1.x * W,
              curve.cp2 ? curve.cp2.y * H : curve.cp1.y * H,
              curve.end.x * W,
              curve.end.y * H
            );
          }
          if (vpath.closed) {
            ctx.closePath();
          }
          ctx.stroke();
        } else if (vpath.points.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(vpath.points[0].x * W, vpath.points[0].y * H);
          for (let i = 1; i < vpath.points.length; i++) {
            ctx.lineTo(vpath.points[i].x * W, vpath.points[i].y * H);
          }
          if (vpath.closed) {
            ctx.closePath();
          }
          ctx.stroke();
        } else if (vpath.points.length === 1) {
          ctx.beginPath();
          ctx.arc(vpath.points[0].x * W, vpath.points[0].y * H, 3, 0, Math.PI * 2);
          ctx.fillStyle = ctx.strokeStyle;
          ctx.fill();
        }

        ctx.restore();
      }
    }

    // 6. Draw TASK-105 Procedural Stroke Candidates
    if (showStrokeCandidates && currentStrokeCandidates && currentStrokeCandidates.candidates.length > 0) {
      for (const candidate of currentStrokeCandidates.candidates) {
        if (strokeDrawableOnly && !candidate.drawable) {
          continue;
        }

        ctx.save();

        if (!candidate.drawable) {
          ctx.setLineDash([4, 4]);
          ctx.globalAlpha = 0.35;
        } else {
          ctx.globalAlpha = 0.92;
        }

        // Color coding based on mode
        if (strokeColorMode === 'importance') {
          const imp = candidate.importance;
          const r = Math.round(Math.min(255, Math.max(0, (imp - 0.35) * 2.0 * 255)));
          const g = Math.round(Math.min(255, Math.max(0, (1.0 - Math.abs(imp - 0.5) * 2.0) * 255)));
          const b = Math.round(Math.min(255, Math.max(0, (0.65 - imp) * 2.5 * 255)));
          ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
        } else if (strokeColorMode === 'width') {
          const normW = Math.min(1.0, candidate.width / 3.0);
          const r = Math.round(normW * 255);
          const g = Math.round((1.0 - normW) * 200 + 55);
          const b = 240;
          ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
        } else {
          // Semantic role color
          switch (candidate.semanticRole) {
            case 'eye':
              ctx.strokeStyle = '#00f0ff'; // cyan
              break;
            case 'eyebrow':
              ctx.strokeStyle = '#38bdf8'; // light blue
              break;
            case 'nose':
              ctx.strokeStyle = '#10b981'; // emerald
              break;
            case 'mouth':
              ctx.strokeStyle = '#f43f5e'; // rose
              break;
            case 'ear':
              ctx.strokeStyle = '#fbbf24'; // amber
              break;
            case 'facial_contour':
              ctx.strokeStyle = '#a855f7'; // purple
              break;
            case 'hair':
              ctx.strokeStyle = '#ec4899'; // pink
              break;
            case 'silhouette':
              ctx.strokeStyle = '#f8fafc'; // white/silver
              break;
            case 'body_structure':
              ctx.strokeStyle = '#6366f1'; // indigo
              break;
            case 'clothing_boundary':
              ctx.strokeStyle = '#14b8a6'; // teal
              break;
            case 'semantic_boundary':
              ctx.strokeStyle = '#eab308'; // yellow
              break;
            case 'texture':
            case 'detail':
              ctx.strokeStyle = '#94a3b8'; // slate
              break;
            case 'background':
              ctx.strokeStyle = '#64748b'; // dark slate
              break;
            default:
              ctx.strokeStyle = '#cbd5e1';
          }
        }

        ctx.lineWidth = candidate.width * 1.5;

        // Draw Bézier curves or polyline
        if (candidate.curves && candidate.curves.length > 0) {
          ctx.beginPath();
          const first = candidate.curves[0];
          ctx.moveTo(first.start.x * W, first.start.y * H);
          for (const curve of candidate.curves) {
            ctx.bezierCurveTo(
              curve.cp1.x * W,
              curve.cp1.y * H,
              curve.cp2 ? curve.cp2.x * W : curve.cp1.x * W,
              curve.cp2 ? curve.cp2.y * H : curve.cp1.y * H,
              curve.end.x * W,
              curve.end.y * H
            );
          }
          if (candidate.closed) ctx.closePath();
          ctx.stroke();
        } else if (candidate.points.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(candidate.points[0].x * W, candidate.points[0].y * H);
          for (let i = 1; i < candidate.points.length; i++) {
            ctx.lineTo(candidate.points[i].x * W, candidate.points[i].y * H);
          }
          if (candidate.closed) ctx.closePath();
          ctx.stroke();
        } else if (candidate.points.length === 1) {
          ctx.beginPath();
          ctx.arc(candidate.points[0].x * W, candidate.points[0].y * H, candidate.width * 2, 0, Math.PI * 2);
          ctx.fillStyle = ctx.strokeStyle;
          ctx.fill();
        }

        ctx.restore();
      }
    }

    // 7. Draw TASK-106 Ordered Stroke Sequence
    if (showStrokeOrdering && currentOrderedSequence && currentOrderedSequence.strokes.length > 0) {
      const totalOrdered = currentOrderedSequence.strokes.length;

      for (const ordered of currentOrderedSequence.strokes) {
        const candidate = ordered.stroke;
        if (orderingSubjectFilter !== 'all' && candidate.subjectId !== orderingSubjectFilter) {
          continue;
        }

        ctx.save();
        ctx.globalAlpha = 0.95;

        // Progressive timeline state evaluation (TASK-107)
        let strokeProgress = 1.0;
        let isDrawing = false;
        if (showTimeline && currentTimelineState) {
          const tState = currentTimelineState.strokes[ordered.sequenceIndex];
          if (!tState || tState.state === 'pending') {
            ctx.restore();
            continue; // Not yet visible at current scrub timestamp
          }
          if (tState.state === 'drawing') {
            strokeProgress = Math.max(0.01, tState.progress);
            isDrawing = true;
          }
        }

        // Color coding based on orderingColorMode
        if (orderingColorMode === 'gradient') {
          // Progressive rainbow hue: 260 (violet/blue) down to 0 (red)
          const progress = totalOrdered > 1 ? ordered.sequenceIndex / (totalOrdered - 1) : 0;
          const hue = Math.round((1.0 - progress) * 260);
          ctx.strokeStyle = `hsl(${hue}, 95%, 60%)`;
        } else if (orderingColorMode === 'dependency') {
          switch (ordered.dependencyLevel) {
            case 0:
              ctx.strokeStyle = '#00f0ff'; // Cyan (Root / Container)
              break;
            case 1:
              ctx.strokeStyle = '#fbbf24'; // Amber (Feature child)
              break;
            case 2:
            default:
              ctx.strokeStyle = '#f43f5e'; // Rose (Nested detail)
              break;
          }
        } else {
          // Composition Phase Colors
          switch (ordered.phase) {
            case 'foundation':
              ctx.strokeStyle = '#10b981'; // Emerald
              break;
            case 'primary_structure':
              ctx.strokeStyle = '#00f0ff'; // Cyan
              break;
            case 'expressive_features':
              ctx.strokeStyle = '#f43f5e'; // Rose
              break;
            case 'secondary_anatomy':
              ctx.strokeStyle = '#c084fc'; // Purple
              break;
            case 'refinement':
              ctx.strokeStyle = '#fbbf24'; // Amber
              break;
            case 'texture_accent':
            default:
              ctx.strokeStyle = '#94a3b8'; // Slate
              break;
          }
        }

        ctx.lineWidth = Math.max(1.0, candidate.width * 1.5);

        // Draw Bézier curves or polyline with progressive progress clipping
        if (candidate.curves && candidate.curves.length > 0) {
          const totalCurves = candidate.curves.length;
          const visibleCurvesCount = isDrawing
            ? Math.max(1, Math.ceil(totalCurves * strokeProgress))
            : totalCurves;

          ctx.beginPath();
          const first = candidate.curves[0];
          ctx.moveTo(first.start.x * W, first.start.y * H);
          for (let cIdx = 0; cIdx < visibleCurvesCount; cIdx++) {
            const curve = candidate.curves[cIdx];
            ctx.bezierCurveTo(
              curve.cp1.x * W,
              curve.cp1.y * H,
              curve.cp2 ? curve.cp2.x * W : curve.cp1.x * W,
              curve.cp2 ? curve.cp2.y * H : curve.cp1.y * H,
              curve.end.x * W,
              curve.end.y * H
            );
          }
          if (candidate.closed && !isDrawing) ctx.closePath();
          ctx.stroke();
        } else if (candidate.points.length >= 2) {
          const totalPts = candidate.points.length;
          const visiblePtsCount = isDrawing
            ? Math.max(2, Math.ceil(totalPts * strokeProgress))
            : totalPts;

          ctx.beginPath();
          ctx.moveTo(candidate.points[0].x * W, candidate.points[0].y * H);
          for (let i = 1; i < visiblePtsCount; i++) {
            ctx.lineTo(candidate.points[i].x * W, candidate.points[i].y * H);
          }
          if (candidate.closed && !isDrawing) ctx.closePath();
          ctx.stroke();
        } else if (candidate.points.length === 1) {
          ctx.beginPath();
          ctx.arc(candidate.points[0].x * W, candidate.points[0].y * H, candidate.width * 2, 0, Math.PI * 2);
          ctx.fillStyle = ctx.strokeStyle;
          ctx.fill();
        }

        // Active drawing tip glow indicator
        if (isDrawing && candidate.points.length > 0) {
          const tipIdx = Math.min(candidate.points.length - 1, Math.floor(candidate.points.length * strokeProgress));
          const tipPt = candidate.points[tipIdx];
          ctx.beginPath();
          ctx.arc(tipPt.x * W, tipPt.y * H, Math.max(3, candidate.width * 2.5), 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.shadowColor = '#00f0ff';
          ctx.shadowBlur = 10;
          ctx.fill();
        }

        // Draw sequence index badge if enabled
        if (showSequenceIndices && candidate.points.length > 0) {
          const startPt = candidate.points[0];
          const badgeX = startPt.x * W;
          const badgeY = startPt.y * H;

          ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
          ctx.beginPath();
          ctx.arc(badgeX, badgeY, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          ctx.stroke();

          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 8px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${ordered.sequenceIndex + 1}`, badgeX, badgeY);
        }

        ctx.restore();
      }
    }
  }, [
    currentResult,
    currentGeometry,
    currentStrokeCandidates,
    currentOrderedSequence,
    showFaceMesh,
    showEarPinna,
    showHair,
    showFacialContours,
    showPoseSkeleton,
    showPoseLandmarks,
    showSemanticMasks,
    showSemanticHair,
    showSemanticSkin,
    showSemanticClothing,
    showVectorGeometry,
    showVectorCurves,
    showImportanceHeatmap,
    showStrokeCandidates,
    strokeDrawableOnly,
    strokeColorMode,
    showStrokeOrdering,
    orderingColorMode,
    orderingSubjectFilter,
    showSequenceIndices,
    showTimeline,
    timelineScrubPct,
    currentTimeline,
    currentTimelineState,
  ]);



  // Execute perception analysis on the active image
  const analyzeActiveImage = async () => {
    if (!currentImageRef.current || !coordinatorRef.current) return;
    setIsProcessing(true);
    setStatusMessage(`Running perception pipeline in '${mode}' mode...`);

    try {
      const img = currentImageRef.current;
      const W = img.naturalWidth || 512;
      const H = img.naturalHeight || 512;

      // Extract pixel buffer from offscreen canvas
      const offscreen = document.createElement('canvas');
      offscreen.width = W;
      offscreen.height = H;
      const offCtx = offscreen.getContext('2d');
      if (!offCtx) throw new Error('Could not get 2D canvas context.');

      offCtx.drawImage(img, 0, 0, W, H);
      const imgData = offCtx.getImageData(0, 0, W, H);
      const pixelBuffer: PixelBuffer = {
        width: W,
        height: H,
        data: new Uint8ClampedArray(imgData.data),
      };

      const normalized = preprocessPixelBuffer(pixelBuffer, {
        maxDimension: 1024,
      });

      const res = await coordinatorRef.current.analyze({
        image: normalized,
        sourceDimensions: { width: W, height: H },
        options: {
          mode,
          includeFacialLandmarks: perceptionScope !== 'pose_only' && perceptionScope !== 'segment_only',
          includeBodyPose: perceptionScope !== 'face_only' && perceptionScope !== 'segment_only',
        },
      });

      // If in ML or Hybrid mode and segmentation requested, run MediaPipe Image Segmenter
      if (
        (mode === 'hybrid' || mode === 'ml') &&
        perceptionScope !== 'face_only' &&
        perceptionScope !== 'pose_only' &&
        delegateRef.current
      ) {
        const segOutput = await delegateRef.current.segmentImage({
          image: normalized,
          sourceDimensions: { width: W, height: H },
        });

        if (segOutput && res.primarySubject) {
          (res.primarySubject as any).semanticSegmentation = segOutput.semanticSegmentation;
        }
      }

      setCurrentResult(res);
      setStatusMessage(
        `Perception completed in ${res.metrics.latencyMs.toFixed(1)} ms via '${res.executionPlan?.resolvedProviderId ?? res.provider.id}'.`
      );
    } catch (err: any) {
      setStatusMessage(`Error: ${err?.message ?? 'Analysis failed'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Run batch benchmark over all 12 images
  const runBatchBenchmark = async () => {
    if (!coordinatorRef.current || isBatchRunning) return;
    setIsBatchRunning(true);
    setBatchResults([]);
    setStatusMessage('Starting batch evaluation across all 12 benchmark images...');

    const runs: BenchmarkRunResult[] = [];

    for (let i = 0; i < benchmarks.length; i++) {
      const bm = benchmarks[i];
      const bmName = bm.title || bm.name || bm.id;
      setStatusMessage(`Evaluating ${bm.id} (${bmName})... [${i + 1}/${benchmarks.length}]`);

      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = `/benchmark-images/${bm.filename}`;
        });

        const W = img.naturalWidth;
        const H = img.naturalHeight;
        const offscreen = document.createElement('canvas');
        offscreen.width = W;
        offscreen.height = H;
        const offCtx = offscreen.getContext('2d')!;
        offCtx.drawImage(img, 0, 0, W, H);
        const imgData = offCtx.getImageData(0, 0, W, H);

        const normalized = preprocessPixelBuffer(
          { width: W, height: H, data: new Uint8ClampedArray(imgData.data) },
          { maxDimension: 1024 }
        );

        const res = await coordinatorRef.current.analyze({
          image: normalized,
          sourceDimensions: { width: W, height: H },
          options: {
            mode,
            includeFacialLandmarks: perceptionScope !== 'pose_only' && perceptionScope !== 'segment_only',
            includeBodyPose: perceptionScope !== 'face_only' && perceptionScope !== 'segment_only',
          },
        });

        let segCategories = 0;
        let segDetected = false;
        if ((mode === 'hybrid' || mode === 'ml') && delegateRef.current) {
          const segOutput = await delegateRef.current.segmentImage({
            image: normalized,
            sourceDimensions: { width: W, height: H },
          });
          if (segOutput) {
            segDetected = true;
            segCategories = segOutput.semanticSegmentation.categories.length;
          }
        }

        const subject = res.primarySubject;
        let earCount = 0;
        if (subject?.face?.leftEar) earCount++;
        if (subject?.face?.rightEar) earCount++;

        const poseDetected = !!subject?.body?.pose;
        const poseJointCount = subject?.body?.pose?.landmarks.length ?? 0;

        // Extract Vector Geometry for batch audit
        const vectorGeom = res.subjects ? extractAllVectorGeometry(res.subjects) : null;
        const vectorPathsCount = vectorGeom?.metrics.totalPaths ?? 0;
        const vectorReductionPct = Math.round((vectorGeom?.metrics.pointReductionRatio ?? 0) * 100);

        // Generate Procedural Stroke Candidates for batch audit
        const strokeSet = vectorGeom ? generateStrokeCandidates(vectorGeom) : null;
        const strokeCandidatesCount = strokeSet?.metrics.totalCandidates ?? 0;
        const strokeDrawableCount = strokeSet?.metrics.drawableCandidates ?? 0;

        // Sequence stroke ordering for batch audit (TASK-106)
        const orderedSeq = strokeSet ? orderStrokeCandidates(strokeSet) : null;
        const orderedStrokesCount = orderedSeq?.drawableStrokes ?? 0;

        // Progressive stroke timeline for batch audit (TASK-107)
        const timeline = orderedSeq ? createStrokeTimeline(orderedSeq, { targetDurationMs: 15000 }) : null;
        const timelineStrokesCount = timeline?.strokes.length ?? 0;
        const timelineDurationS = Number(((timeline?.totalDurationMs ?? 0) / 1000).toFixed(1));

        runs.push({
          id: bm.id,
          name: bmName,
          mode,
          providerId: res.executionPlan?.resolvedProviderId ?? res.provider.id,
          durationMs: Number(res.metrics.latencyMs.toFixed(1)),
          faceDetected: !!subject?.face,
          poseDetected,
          poseJointCount,
          pose: subject?.face?.pose ?? (poseDetected ? 'body_detected' : 'unknown'),
          earCount,
          segmentationDetected: segDetected,
          segmentationCategories: segCategories,
          vectorPathsCount,
          vectorReductionPct,
          strokeCandidatesCount,
          strokeDrawableCount,
          orderedStrokesCount,
          timelineStrokesCount,
          timelineDurationS,
          fallback: !!res.executionPlan?.fallbackOccurred,
        });

        setBatchResults([...runs]);
      } catch (err: any) {
        runs.push({
          id: bm.id,
          name: bmName,
          mode,
          providerId: 'error',
          durationMs: 0,
          faceDetected: false,
          poseDetected: false,
          poseJointCount: 0,
          pose: 'error',
          earCount: 0,
          segmentationDetected: false,
          segmentationCategories: 0,
          vectorPathsCount: 0,
          vectorReductionPct: 0,
          strokeCandidatesCount: 0,
          strokeDrawableCount: 0,
          orderedStrokesCount: 0,
          timelineStrokesCount: 0,
          timelineDurationS: 0,
          fallback: true,
        });
        setBatchResults([...runs]);
      }
    }

    setIsBatchRunning(false);
    setStatusMessage('Batch evaluation complete for all 12 benchmark categories.');
  };

  const activeBm = benchmarks.find((b) => b.id === selectedBenchmarkId) ?? benchmarks[0];

  return (
    <div className="app-container">
      <header>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div className="logo-badge">Photo-to-Procedural-Art</div>
          <span className="phase-pill">TASK-107 Stroke Timeline</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.82rem' }}>
          <span style={{ color: 'var(--text-secondary)' }}>MediaPipe Runtime:</span>
          <span
            style={{
              padding: '0.2rem 0.6rem',
              borderRadius: '999px',
              fontFamily: 'var(--font-mono)',
              fontWeight: 600,
              backgroundColor:
                delegateState === 'ready'
                  ? 'rgba(16, 185, 129, 0.2)'
                  : delegateState === 'loading'
                  ? 'rgba(245, 158, 11, 0.2)'
                  : 'rgba(100, 116, 139, 0.2)',
              color:
                delegateState === 'ready'
                  ? '#10b981'
                  : delegateState === 'loading'
                  ? '#f59e0b'
                  : '#94a3b8',
              border: `1px solid ${
                delegateState === 'ready'
                  ? 'rgba(16, 185, 129, 0.4)'
                  : delegateState === 'loading'
                  ? 'rgba(245, 158, 11, 0.4)'
                  : 'rgba(100, 116, 139, 0.4)'
              }`,
            }}
          >
            {delegateState.toUpperCase()}
          </span>
        </div>
      </header>

      <main>
        {/* Controls Ribbon */}
        <section
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-lg)',
            padding: '1.25rem 1.5rem',
            marginBottom: '1.5rem',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '1.5rem',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          {/* Mode Selector */}
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Execution Strategy
            </label>
            <div style={{ display: 'flex', gap: '0.4rem', background: 'var(--bg-primary)', padding: '0.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
              {(['deterministic', 'ml', 'auto', 'hybrid'] as VisionExecutionMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  style={{
                    padding: '0.4rem 0.8rem',
                    borderRadius: 'var(--radius-sm)',
                    border: 'none',
                    fontSize: '0.8rem',
                    fontWeight: mode === m ? 600 : 400,
                    cursor: 'pointer',
                    background: mode === m ? 'linear-gradient(135deg, var(--accent-indigo), var(--accent-violet))' : 'transparent',
                    color: mode === m ? '#ffffff' : 'var(--text-secondary)',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {m === 'ml' ? 'MediaPipe ML' : m === 'deterministic' ? 'Deterministic CV' : m === 'auto' ? 'Auto Fallback' : 'Hybrid (Reconciled)'}
                </button>
              ))}
            </div>
          </div>

          {/* Perception Scope */}
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Perception Targets
            </label>
            <div style={{ display: 'flex', gap: '0.3rem', background: 'var(--bg-primary)', padding: '0.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
              {(['all', 'face_only', 'pose_only', 'segment_only'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setPerceptionScope(s)}
                  style={{
                    padding: '0.4rem 0.65rem',
                    borderRadius: 'var(--radius-sm)',
                    border: 'none',
                    fontSize: '0.78rem',
                    fontWeight: perceptionScope === s ? 600 : 400,
                    cursor: 'pointer',
                    background: perceptionScope === s ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                    color: perceptionScope === s ? '#38bdf8' : 'var(--text-secondary)',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {s === 'all' ? 'All (Face+Pose+Seg)' : s === 'face_only' ? 'Face Only' : s === 'pose_only' ? 'Pose Only' : 'Segment Only'}
                </button>
              ))}
            </div>
          </div>

          {/* Benchmark Image Selector */}
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Benchmark Image
            </label>
            <select
              value={selectedBenchmarkId}
              onChange={(e) => {
                setSelectedBenchmarkId(e.target.value);
                setCurrentResult(null);
              }}
              style={{
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
                padding: '0.45rem 0.8rem',
                borderRadius: 'var(--radius-md)',
                fontFamily: 'inherit',
                fontSize: '0.85rem',
                minWidth: '220px',
              }}
            >
              {benchmarks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.id.toUpperCase()}: {b.title || b.name}
                </option>
              ))}
            </select>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}>
            <button
              onClick={analyzeActiveImage}
              disabled={isProcessing || isBatchRunning}
              style={{
                padding: '0.55rem 1.25rem',
                borderRadius: 'var(--radius-md)',
                border: 'none',
                background: 'linear-gradient(135deg, var(--accent-cyan), var(--accent-indigo))',
                color: '#ffffff',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: isProcessing ? 'wait' : 'pointer',
                opacity: isProcessing ? 0.7 : 1,
                boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)',
              }}
            >
              {isProcessing ? 'Analyzing...' : 'Run Perception'}
            </button>

            <button
              onClick={runBatchBenchmark}
              disabled={isBatchRunning || isProcessing}
              style={{
                padding: '0.55rem 1rem',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-surface-hover)',
                color: 'var(--text-primary)',
                fontWeight: 500,
                fontSize: '0.85rem',
                cursor: isBatchRunning ? 'wait' : 'pointer',
              }}
            >
              {isBatchRunning ? 'Evaluating Suite...' : 'Evaluate All 12'}
            </button>
          </div>
        </section>

        {/* Live Status Banner */}
        <div
          style={{
            padding: '0.6rem 1rem',
            borderRadius: 'var(--radius-md)',
            marginBottom: '1.5rem',
            fontSize: '0.85rem',
            fontFamily: 'var(--font-mono)',
            background: 'rgba(30, 41, 59, 0.4)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--accent-cyan)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{statusMessage}</span>
          {activeBm && (
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
              Challenge: {activeBm.challengeFactors?.join(', ')}
            </span>
          )}
        </div>

        {/* Main Work Area: Canvas + Telemetry */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.8fr) minmax(0, 1.2fr)', gap: '1.5rem' }}>
          {/* Left Column: Canvas Viewport */}
          <div
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-lg)',
              padding: '1rem',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            {/* Visualization Toggles */}
            <div
              style={{
                display: 'flex',
                gap: '1rem',
                marginBottom: '1rem',
                fontSize: '0.78rem',
                color: 'var(--text-secondary)',
                width: '100%',
                justifyContent: 'center',
                flexWrap: 'wrap',
              }}
            >
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showFacialContours}
                  onChange={(e) => setShowFacialContours(e.target.checked)}
                />
                <span style={{ color: '#00f0ff' }}>●</span> Face Landmarks
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showEarPinna}
                  onChange={(e) => setShowEarPinna(e.target.checked)}
                />
                <span style={{ color: '#f59e0b' }}>●</span> Ear Pinna (Deterministic)
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showHair}
                  onChange={(e) => setShowHair(e.target.checked)}
                />
                <span style={{ color: '#c084fc' }}>●</span> Hair Silhouette
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showPoseSkeleton}
                  onChange={(e) => setShowPoseSkeleton(e.target.checked)}
                />
                <span style={{ color: '#10b981' }}>●</span> Pose Skeleton
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showPoseLandmarks}
                  onChange={(e) => setShowPoseLandmarks(e.target.checked)}
                />
                <span style={{ color: '#38bdf8' }}>●</span> Pose Joints (33)
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showSemanticMasks}
                  onChange={(e) => setShowSemanticMasks(e.target.checked)}
                />
                <span style={{ color: '#ec4899' }}>■</span> Semantic Masks
              </label>

              {showSemanticMasks && (
                <>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={showSemanticHair}
                      onChange={(e) => setShowSemanticHair(e.target.checked)}
                    />
                    <span style={{ color: '#a855f7' }}>■</span> Hair
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={showSemanticSkin}
                      onChange={(e) => setShowSemanticSkin(e.target.checked)}
                    />
                    <span style={{ color: '#fb923c' }}>■</span> Skin
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={showSemanticClothing}
                      onChange={(e) => setShowSemanticClothing(e.target.checked)}
                    />
                    <span style={{ color: '#06b6d4' }}>■</span> Clothes
                  </label>
                </>
              )}

              <span style={{ color: 'var(--border-subtle)' }}>|</span>

              {/* TASK-104 Vector Geometry Toggles */}
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showVectorGeometry}
                  onChange={(e) => setShowVectorGeometry(e.target.checked)}
                />
                <span style={{ color: '#00f0ff' }}>⚡</span> Vectors (TASK-104)
              </label>

              {showVectorGeometry && (
                <>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={showVectorCurves}
                      onChange={(e) => setShowVectorCurves(e.target.checked)}
                    />
                    <span style={{ color: 'var(--text-secondary)' }}>Bézier Curves</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={showImportanceHeatmap}
                      onChange={(e) => setShowImportanceHeatmap(e.target.checked)}
                    />
                    <span style={{ color: 'var(--text-secondary)' }}>Importance Heatmap</span>
                  </label>
                </>
              )}

              <span style={{ color: 'var(--border-subtle)' }}>|</span>

              {/* TASK-105 Stroke Candidates Toggles */}
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showStrokeCandidates}
                  onChange={(e) => setShowStrokeCandidates(e.target.checked)}
                />
                <span style={{ color: '#10b981' }}>🖌️</span> Stroke Candidates (TASK-105)
              </label>

              {showStrokeCandidates && (
                <>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={strokeDrawableOnly}
                      onChange={(e) => setStrokeDrawableOnly(e.target.checked)}
                    />
                    <span style={{ color: 'var(--text-secondary)' }}>Drawable Only</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Color:</span>
                    <select
                      value={strokeColorMode}
                      onChange={(e) => setStrokeColorMode(e.target.value as any)}
                      style={{
                        background: 'var(--bg-card)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '4px',
                        padding: '0.1rem 0.3rem',
                        fontSize: '0.75rem',
                      }}
                    >
                      <option value="role">Semantic Role</option>
                      <option value="importance">Importance</option>
                      <option value="width">Line Weight</option>
                    </select>
                  </label>
                </>
              )}

              <span style={{ color: 'var(--border-subtle)' }}>|</span>

              {/* TASK-106 Stroke Ordering Toggles */}
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showStrokeOrdering}
                  onChange={(e) => setShowStrokeOrdering(e.target.checked)}
                />
                <span style={{ color: '#38bdf8' }}>🔢</span> Stroke Ordering (TASK-106)
              </label>

              {showStrokeOrdering && (
                <>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Color:</span>
                    <select
                      value={orderingColorMode}
                      onChange={(e) => setOrderingColorMode(e.target.value as any)}
                      style={{
                        background: 'var(--bg-card)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '4px',
                        padding: '0.1rem 0.3rem',
                        fontSize: '0.75rem',
                      }}
                    >
                      <option value="phase">Composition Phase</option>
                      <option value="gradient">Sequence Gradient</option>
                      <option value="dependency">Dependency Level</option>
                    </select>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={showSequenceIndices}
                      onChange={(e) => setShowSequenceIndices(e.target.checked)}
                    />
                    <span style={{ color: 'var(--text-secondary)' }}># Badges</span>
                  </label>
                </>
              )}

              <span style={{ color: 'var(--border-subtle)' }}>|</span>

              {/* TASK-107 Timeline Scrubber Toggle */}
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showTimeline}
                  onChange={(e) => setShowTimeline(e.target.checked)}
                />
                <span style={{ color: '#a855f7' }}>⏱️</span> Timeline (TASK-107)
              </label>

              {showTimeline && currentTimeline && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(168, 85, 247, 0.1)', padding: '0.15rem 0.5rem', borderRadius: '4px', border: '1px solid rgba(168, 85, 247, 0.3)' }}>
                  <span style={{ fontSize: '0.75rem', color: '#c084fc', fontFamily: 'var(--font-mono)' }}>
                    {((currentTimeline.totalDurationMs * timelineScrubPct) / 100000).toFixed(1)}s / {(currentTimeline.totalDurationMs / 1000).toFixed(1)}s
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={timelineScrubPct}
                    onChange={(e) => setTimelineScrubPct(Number(e.target.value))}
                    style={{ width: '90px', accentColor: '#a855f7', cursor: 'pointer' }}
                    title={`Timeline scrub: ${timelineScrubPct}%`}
                  />
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                    ({currentTimelineState?.activeCount ?? 0} active, {currentTimelineState?.completedCount ?? 0} done)
                  </span>
                </div>
              )}
            </div>

            {/* Viewport Canvas */}
            <div
              style={{
                position: 'relative',
                maxWidth: '100%',
                maxHeight: '560px',
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden',
                border: '1px solid var(--border-subtle)',
                background: '#000000',
              }}
            >
              <img
                ref={currentImageRef}
                src={activeBm ? `/benchmark-images/${activeBm.filename}` : undefined}
                alt={activeBm ? (activeBm.title || activeBm.name || activeBm.id) : undefined}
                onLoad={() => {
                  if (canvasRef.current && currentImageRef.current) {
                    const canvas = canvasRef.current;
                    canvas.width = currentImageRef.current.naturalWidth;
                    canvas.height = currentImageRef.current.naturalHeight;
                    const ctx = canvas.getContext('2d');
                    ctx?.drawImage(currentImageRef.current, 0, 0);
                  }
                }}
                style={{ display: 'none' }}
              />
              <canvas
                ref={canvasRef}
                style={{
                  display: 'block',
                  maxWidth: '100%',
                  maxHeight: '560px',
                  objectFit: 'contain',
                }}
              />
            </div>
          </div>

          {/* Right Column: Telemetry & Structural Findings */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* Metrics Cards Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem' }}>
              <div
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1rem',
                }}
              >
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Latency</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.2rem' }}>
                  {currentResult ? `${currentResult.metrics.latencyMs.toFixed(1)} ms` : '--'}
                </div>
              </div>

              <div
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1rem',
                }}
              >
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Resolved Provider</div>
                <div
                  style={{
                    fontSize: '0.95rem',
                    fontWeight: 600,
                    color: 'var(--accent-cyan)',
                    marginTop: '0.4rem',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {currentResult?.executionPlan?.resolvedProviderId ?? currentResult?.provider.id ?? '--'}
                </div>
              </div>

              <div
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1rem',
                }}
              >
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Head Pose</div>
                <div
                  style={{
                    fontSize: '1rem',
                    fontWeight: 600,
                    color: currentResult?.primarySubject?.face?.pose === 'left_profile' ? '#f59e0b' : 'var(--text-primary)',
                    marginTop: '0.3rem',
                  }}
                >
                  {currentResult?.primarySubject?.face?.pose?.replace('_', ' ').toUpperCase() ?? '--'}
                </div>
              </div>

              <div
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1rem',
                }}
              >
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Fallback Status</div>
                <div
                  style={{
                    fontSize: '0.95rem',
                    fontWeight: 600,
                    color: currentResult?.executionPlan?.fallbackOccurred ? '#f59e0b' : '#10b981',
                    marginTop: '0.3rem',
                  }}
                >
                  {currentResult?.executionPlan?.fallbackOccurred ? 'Fallback Used' : 'Direct Target'}
                </div>
              </div>

              <div
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1rem',
                }}
              >
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Body Pose (BlazePose)</div>
                <div
                  style={{
                    fontSize: '0.95rem',
                    fontWeight: 600,
                    color: currentResult?.primarySubject?.body?.pose ? '#10b981' : 'var(--text-muted)',
                    marginTop: '0.3rem',
                  }}
                >
                  {currentResult?.primarySubject?.body?.pose
                    ? `✓ ${currentResult.primarySubject.body.pose.landmarks.length} Joints`
                    : 'None'}
                </div>
              </div>

              <div
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1rem',
                }}
              >
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Semantic Segmentation</div>
                <div
                  style={{
                    fontSize: '0.95rem',
                    fontWeight: 600,
                    color: currentResult?.primarySubject?.semanticSegmentation ? '#ec4899' : 'var(--text-muted)',
                    marginTop: '0.3rem',
                  }}
                >
                  {currentResult?.primarySubject?.semanticSegmentation
                    ? `✓ ${currentResult.primarySubject.semanticSegmentation.categories.length} Classes`
                    : 'None'}
                </div>
              </div>

              <div
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1rem',
                }}
              >
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Subject Count</div>
                <div
                  style={{
                    fontSize: '0.95rem',
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    marginTop: '0.3rem',
                  }}
                >
                  {currentResult ? `${currentResult.subjects.length} Subject(s)` : '--'}
                </div>
              </div>

              <div
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1rem',
                }}
              >
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Vector Paths (TASK-104)</div>
                <div
                  style={{
                    fontSize: '0.95rem',
                    fontWeight: 600,
                    color: currentGeometry ? '#00f0ff' : 'var(--text-muted)',
                    marginTop: '0.3rem',
                  }}
                >
                  {currentGeometry
                    ? `⚡ ${currentGeometry.metrics.totalPaths} Paths (${(currentGeometry.metrics.pointReductionRatio * 100).toFixed(0)}% red)`
                    : '--'}
                </div>
              </div>

              <div
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1rem',
                }}
              >
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Stroke Candidates (TASK-105)</div>
                <div
                  style={{
                    fontSize: '0.95rem',
                    fontWeight: 600,
                    color: currentStrokeCandidates ? '#10b981' : 'var(--text-muted)',
                    marginTop: '0.3rem',
                  }}
                >
                  {currentStrokeCandidates
                    ? `🖌️ ${currentStrokeCandidates.metrics.drawableCandidates} / ${currentStrokeCandidates.metrics.totalCandidates} Drw`
                    : '--'}
                </div>
              </div>

              <div
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1rem',
                }}
              >
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Stroke Ordering (TASK-106)</div>
                <div
                  style={{
                    fontSize: '0.95rem',
                    fontWeight: 600,
                    color: currentOrderedSequence ? '#38bdf8' : 'var(--text-muted)',
                    marginTop: '0.3rem',
                  }}
                >
                  {currentOrderedSequence
                    ? `🔢 ${currentOrderedSequence.drawableStrokes} Ordered (${currentOrderedSequence.metrics.orderingLatencyMs.toFixed(1)}ms)`
                    : '--'}
                </div>
              </div>

              <div
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1rem',
                }}
              >
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Timeline (TASK-107)</div>
                <div
                  style={{
                    fontSize: '0.95rem',
                    fontWeight: 600,
                    color: currentTimeline ? '#c084fc' : 'var(--text-muted)',
                    marginTop: '0.3rem',
                  }}
                >
                  {currentTimeline
                    ? `⏱️ ${(currentTimeline.totalDurationMs / 1000).toFixed(1)}s (${currentTimeline.metrics.generationLatencyMs.toFixed(1)}ms)`
                    : '--'}
                </div>
              </div>
            </div>

            {/* Stroke Candidates Audit Card (TASK-105) */}
            {currentStrokeCandidates && (
              <div
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1.25rem',
                  marginBottom: '1rem',
                }}
              >
                <h3 style={{ fontSize: '0.95rem', marginBottom: '0.75rem', fontWeight: 600, color: '#10b981' }}>
                  🖌️ Procedural Stroke Candidates (TASK-105)
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem', fontSize: '0.8rem' }}>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Drawable / Total: </span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: '#10b981', fontWeight: 600 }}>
                      {currentStrokeCandidates.metrics.drawableCandidates} / {currentStrokeCandidates.metrics.totalCandidates}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Generation Latency: </span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: '#00f0ff', fontWeight: 600 }}>
                      {currentStrokeCandidates.metrics.generationLatencyMs.toFixed(2)} ms
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Filtered Candidates: </span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: '#f59e0b' }}>
                      {currentStrokeCandidates.metrics.filteredCandidates}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Avg Arc Length: </span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>
                      {currentStrokeCandidates.metrics.averageLength.toFixed(3)}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Avg Importance: </span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>
                      {currentStrokeCandidates.metrics.averageImportance.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Avg Line Weight: </span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>
                      {currentStrokeCandidates.metrics.averageWidth.toFixed(2)}px
                    </span>
                  </div>
                </div>

                {/* Role Breakdown */}
                <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--text-secondary)', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.5rem' }}>
                  <span style={{ fontWeight: 600 }}>Role Distribution: </span>
                  {Object.entries(currentStrokeCandidates.metrics.strokesBySemanticRole).map(([role, cnt]) => (
                    <span key={role} style={{ marginRight: '0.6rem', fontFamily: 'var(--font-mono)' }}>
                      {role}: <strong style={{ color: 'var(--text-primary)' }}>{cnt}</strong>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Stroke Ordering & Composition Audit Card (TASK-106) */}
            {currentOrderedSequence && (
              <div
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1.25rem',
                  marginBottom: '1rem',
                }}
              >
                <h3 style={{ fontSize: '0.95rem', marginBottom: '0.75rem', fontWeight: 600, color: '#38bdf8' }}>
                  🔢 Procedural Stroke Ordering & Composition (TASK-106)
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem', fontSize: '0.8rem' }}>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Ordered Drawable Strokes: </span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: '#38bdf8', fontWeight: 600 }}>
                      {currentOrderedSequence.drawableStrokes} / {currentOrderedSequence.totalStrokes}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Ordering Latency: </span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: '#00f0ff', fontWeight: 600 }}>
                      {currentOrderedSequence.metrics.orderingLatencyMs.toFixed(2)} ms
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Dependency Edges / Depth: </span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: '#fbbf24' }}>
                      {currentOrderedSequence.metrics.dependencyCount} edges (Depth {currentOrderedSequence.metrics.maxDependencyDepth})
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Filtered / Occluded: </span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: '#94a3b8' }}>
                      {currentOrderedSequence.filteredStrokes.length} candidates
                    </span>
                  </div>
                </div>

                {/* Phase Breakdown */}
                <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--text-secondary)', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.5rem' }}>
                  <span style={{ fontWeight: 600 }}>Phase Breakdown: </span>
                  {Object.entries(currentOrderedSequence.metrics.phaseCounts).map(([phase, cnt]) => (
                    <span key={phase} style={{ marginRight: '0.6rem', fontFamily: 'var(--font-mono)' }}>
                      {phase}: <strong style={{ color: 'var(--text-primary)' }}>{cnt}</strong>
                    </span>
                  ))}
                </div>

                {/* Sequence Preview */}
                <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--text-secondary)', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.5rem' }}>
                  <div style={{ fontWeight: 600, marginBottom: '0.3rem' }}>Drawing Sequence Preview (First 5 Strokes):</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontFamily: 'var(--font-mono)' }}>
                    {currentOrderedSequence.strokes.slice(0, 5).map((s) => (
                      <div key={s.sequenceIndex} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <span style={{ color: '#38bdf8', fontWeight: 600 }}>#{s.sequenceIndex + 1}</span>
                        <span style={{ color: 'var(--text-muted)' }}>[{s.phase}]</span>
                        <span style={{ color: 'var(--text-primary)' }}>{s.stroke.semanticRole}</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>({s.orderingReason})</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Progressive Stroke Timeline Audit Card (TASK-107) */}
            {currentTimeline && (
              <div
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1.25rem',
                  marginBottom: '1rem',
                }}
              >
                <h3 style={{ fontSize: '0.95rem', marginBottom: '0.75rem', fontWeight: 600, color: '#c084fc' }}>
                  ⏱️ Progressive Stroke Timeline & Animation Scheduling (TASK-107)
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem', fontSize: '0.8rem' }}>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Total Duration: </span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: '#c084fc', fontWeight: 600 }}>
                      {(currentTimeline.totalDurationMs / 1000).toFixed(2)} s {currentTimeline.targetDurationMs ? `(Target: ${(currentTimeline.targetDurationMs / 1000).toFixed(1)}s)` : ''}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Scheduling Latency: </span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: '#00f0ff', fontWeight: 600 }}>
                      {currentTimeline.metrics.generationLatencyMs.toFixed(2)} ms
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Natural Physical Duration: </span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>
                      {(currentTimeline.naturalDurationMs / 1000).toFixed(2)} s
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Avg Stroke Duration: </span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>
                      {currentTimeline.metrics.averageStrokeDurationMs} ms ({currentTimeline.metrics.minStrokeDurationMs} - {currentTimeline.metrics.maxStrokeDurationMs}ms)
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Max Concurrency: </span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: '#10b981', fontWeight: 600 }}>
                      {currentTimeline.metrics.maxConcurrency} simultaneous strokes
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Average Overlap Window: </span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>
                      {currentTimeline.metrics.averageOverlapMs} ms
                    </span>
                  </div>
                </div>

                {/* Real-time scrub state preview */}
                {currentTimelineState && (
                  <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--text-secondary)', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.5rem' }}>
                    <div style={{ fontWeight: 600, marginBottom: '0.3rem', color: '#c084fc' }}>
                      Scrub State at {timelineScrubPct}% ({((currentTimeline.totalDurationMs * timelineScrubPct) / 100000).toFixed(2)}s):
                    </div>
                    <div style={{ display: 'flex', gap: '1rem', fontFamily: 'var(--font-mono)' }}>
                      <span>Drawing: <strong style={{ color: '#00f0ff' }}>{currentTimelineState.activeCount}</strong></span>
                      <span>Completed: <strong style={{ color: '#10b981' }}>{currentTimelineState.completedCount}</strong></span>
                      <span>Pending: <strong style={{ color: '#64748b' }}>{currentTimelineState.pendingCount}</strong></span>
                    </div>
                  </div>
                )}

                {/* Timeline Strokes Preview */}
                <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--text-secondary)', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.5rem' }}>
                  <div style={{ fontWeight: 600, marginBottom: '0.3rem' }}>Timeline Schedule Preview (First 5 Strokes):</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontFamily: 'var(--font-mono)' }}>
                    {currentTimeline.strokes.slice(0, 5).map((ts) => (
                      <div key={ts.timelineIndex} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <span style={{ color: '#c084fc', fontWeight: 600 }}>#{ts.timelineIndex + 1}</span>
                        <span style={{ color: 'var(--text-muted)' }}>[{ts.phase}]</span>
                        <span style={{ color: 'var(--text-primary)' }}>{ts.stroke.stroke.semanticRole}</span>
                        <span style={{ color: '#38bdf8' }}>{ts.startTimeMs}ms → {ts.endTimeMs}ms ({ts.durationMs}ms)</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>[{ts.easing}]</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Vector Geometry Audit Card */}
            {currentGeometry && (
              <div
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1.25rem',
                  marginBottom: '1rem',
                }}
              >
                <h3 style={{ fontSize: '0.95rem', marginBottom: '0.75rem', fontWeight: 600, color: '#00f0ff' }}>
                  ⚡ Vector Geometry & Simplification (TASK-104)
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem', fontSize: '0.8rem' }}>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Total Paths: </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                      {currentGeometry.metrics.totalPaths}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Extraction Latency: </span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: '#00f0ff', fontWeight: 600 }}>
                      {currentGeometry.metrics.processingTimeMs.toFixed(2)} ms
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Raw Vertices: </span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>
                      {currentGeometry.metrics.totalRawPoints}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Simplified Vertices: </span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: '#10b981', fontWeight: 600 }}>
                      {currentGeometry.metrics.totalSimplifiedPoints} ({(currentGeometry.metrics.pointReductionRatio * 100).toFixed(1)}% reduced)
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Semantic Segmentation Audit Card */}
            {currentResult?.primarySubject?.semanticSegmentation && (
              <div
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1.25rem',
                  marginBottom: '1rem',
                }}
              >
                <h3 style={{ fontSize: '0.95rem', marginBottom: '0.75rem', fontWeight: 600, color: '#ec4899' }}>
                  ✓ Semantic Segmentation (Selfie Multiclass)
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Categories: </span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>
                      {currentResult.primarySubject.semanticSegmentation.categories.join(', ')}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Confidence: </span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: '#10b981' }}>
                      {(currentResult.primarySubject.semanticSegmentation.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Mask Count: </span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>
                      {currentResult.primarySubject.semanticSegmentation.masks.length} discrete masks
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Provider: </span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>
                      {currentResult.primarySubject.semanticSegmentation.provider}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {currentResult.primarySubject.semanticSegmentation.masks.map((m) => (
                    <span
                      key={m.category}
                      style={{
                        padding: '0.2rem 0.5rem',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '0.72rem',
                        fontFamily: 'var(--font-mono)',
                        background: 'rgba(236, 72, 153, 0.15)',
                        border: '1px solid rgba(236, 72, 153, 0.3)',
                        color: '#f472b6',
                      }}
                    >
                      {m.category}: {m.pixelArea}px ({(m.confidence * 100).toFixed(0)}%)
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Detailed Structural Audit Card */}
            {currentResult?.primarySubject?.face && (
              <div
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1.25rem',
                  marginBottom: '1rem',
                }}
              >
                <h3 style={{ fontSize: '0.95rem', marginBottom: '0.75rem', fontWeight: 600 }}>
                  Feature Visibility & Occlusion Audit
                </h3>

                <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-secondary)' }}>
                      <th style={{ paddingBottom: '0.4rem' }}>Feature</th>
                      <th style={{ paddingBottom: '0.4rem' }}>Visibility</th>
                      <th style={{ paddingBottom: '0.4rem' }}>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(currentResult.primarySubject.face.featureVisibility ?? {}).map(
                      ([feat, vis]) => {
                        const isEar = feat.toLowerCase().includes('ear');
                        return (
                          <tr key={feat} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                            <td style={{ padding: '0.4rem 0', fontFamily: 'var(--font-mono)' }}>{feat}</td>
                            <td style={{ padding: '0.4rem 0' }}>
                              <span
                                style={{
                                  color:
                                    vis === 'visible'
                                      ? '#10b981'
                                      : vis === 'occluded'
                                      ? '#f59e0b'
                                      : '#94a3b8',
                                  fontWeight: 500,
                                }}
                              >
                                {vis}
                              </span>
                            </td>
                            <td style={{ padding: '0.4rem 0', color: isEar ? '#fbbf24' : 'var(--text-secondary)' }}>
                              {isEar ? 'Deterministic (Reconciled)' : 'MediaPipe ML'}
                            </td>
                          </tr>
                        );
                      }
                    )}
                  </tbody>
                </table>

                {/* Profile Occlusion Guarantee Note */}
                {selectedBenchmarkId === 'bm-02' && (
                  <div
                    style={{
                      marginTop: '0.75rem',
                      padding: '0.5rem 0.75rem',
                      borderRadius: 'var(--radius-sm)',
                      background: 'rgba(245, 158, 11, 0.1)',
                      border: '1px solid rgba(245, 158, 11, 0.3)',
                      fontSize: '0.75rem',
                      color: '#fbbf24',
                    }}
                  >
                    ✓ <strong>BM-02 Side Profile Guarantee:</strong> Hidden right eye, eyebrow, and ear are strictly marked <code>occluded</code> without phantom coordinate fabrication. Authoritative left ear pinna preserved from deterministic detector.
                  </div>
                )}
              </div>
            )}

            {/* Body Pose Skeleton Audit Card */}
            {currentResult?.primarySubject?.body?.pose && (
              <div
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1.25rem',
                }}
              >
                <h3 style={{ fontSize: '0.95rem', marginBottom: '0.75rem', fontWeight: 600, color: '#10b981' }}>
                  ✓ Body Pose Articulation (BlazePose 33 Joints)
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem', fontSize: '0.8rem' }}>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Shoulder Span: </span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>
                      {currentResult.primarySubject.body.pose.leftShoulder && currentResult.primarySubject.body.pose.rightShoulder
                        ? `${Math.abs(currentResult.primarySubject.body.pose.rightShoulder.point.x - currentResult.primarySubject.body.pose.leftShoulder.point.x).toFixed(3)} screen width`
                        : '--'}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Neck Midpoint: </span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>
                      {currentResult.primarySubject.body.pose.neck
                        ? `(${currentResult.primarySubject.body.pose.neck.point.x.toFixed(2)}, ${currentResult.primarySubject.body.pose.neck.point.y.toFixed(2)})`
                        : '--'}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Skeletal Links: </span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>
                      {currentResult.primarySubject.body.pose.connections.length} bones
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Pose Confidence: </span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: '#10b981' }}>
                      {(currentResult.primarySubject.body.pose.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Batch Benchmark Table */}
        {batchResults.length > 0 && (
          <section
            style={{
              marginTop: '2rem',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-lg)',
              padding: '1.25rem 1.5rem',
            }}
          >
            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', fontWeight: 600 }}>
              12-Category Suite Benchmark Evaluation ({mode.toUpperCase()} Mode)
            </h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
                    <th style={{ padding: '0.6rem' }}>ID</th>
                    <th style={{ padding: '0.6rem' }}>Benchmark Name</th>
                    <th style={{ padding: '0.6rem' }}>Resolved Provider</th>
                    <th style={{ padding: '0.6rem' }}>Latency (ms)</th>
                    <th style={{ padding: '0.6rem' }}>Face Pose</th>
                    <th style={{ padding: '0.6rem' }}>Body Pose</th>
                    <th style={{ padding: '0.6rem' }}>Semantic Seg</th>
                    <th style={{ padding: '0.6rem' }}>Vectors (TASK-104)</th>
                    <th style={{ padding: '0.6rem' }}>Strokes (TASK-105)</th>
                    <th style={{ padding: '0.6rem' }}>Ordered (TASK-106)</th>
                    <th style={{ padding: '0.6rem' }}>Timeline (TASK-107)</th>
                    <th style={{ padding: '0.6rem' }}>Ears Preserved</th>
                    <th style={{ padding: '0.6rem' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {batchResults.map((r) => (
                    <tr key={r.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                      <td style={{ padding: '0.6rem', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                        {r.id.toUpperCase()}
                      </td>
                      <td style={{ padding: '0.6rem' }}>{r.name}</td>
                      <td style={{ padding: '0.6rem', fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>
                        {r.providerId}
                      </td>
                      <td style={{ padding: '0.6rem', fontWeight: 600 }}>{r.durationMs} ms</td>
                      <td style={{ padding: '0.6rem' }}>{r.pose}</td>
                      <td style={{ padding: '0.6rem', color: r.poseDetected ? '#10b981' : 'var(--text-muted)' }}>
                        {r.poseDetected ? `✓ ${r.poseJointCount} joints` : '--'}
                      </td>
                      <td style={{ padding: '0.6rem', color: r.segmentationDetected ? '#ec4899' : 'var(--text-muted)' }}>
                        {r.segmentationDetected ? `✓ ${r.segmentationCategories} classes` : '--'}
                      </td>
                      <td style={{ padding: '0.6rem', color: '#00f0ff', fontFamily: 'var(--font-mono)' }}>
                        {r.vectorPathsCount > 0 ? `${r.vectorPathsCount} paths (${r.vectorReductionPct}% red)` : '--'}
                      </td>
                      <td style={{ padding: '0.6rem', color: '#10b981', fontFamily: 'var(--font-mono)' }}>
                        {r.strokeCandidatesCount > 0 ? `${r.strokeDrawableCount}/${r.strokeCandidatesCount} drw` : '--'}
                      </td>
                      <td style={{ padding: '0.6rem', color: '#38bdf8', fontFamily: 'var(--font-mono)' }}>
                        {r.orderedStrokesCount > 0 ? `${r.orderedStrokesCount} ordered` : '--'}
                      </td>
                      <td style={{ padding: '0.6rem', color: '#c084fc', fontFamily: 'var(--font-mono)' }}>
                        {r.timelineStrokesCount > 0 ? `${r.timelineDurationS}s (${r.timelineStrokesCount} str)` : '--'}
                      </td>
                      <td style={{ padding: '0.6rem', color: r.earCount > 0 ? '#fbbf24' : 'var(--text-muted)' }}>
                        {r.earCount} ear(s)
                      </td>
                      <td style={{ padding: '0.6rem' }}>
                        <span style={{ color: r.faceDetected ? '#10b981' : r.poseDetected ? '#38bdf8' : '#f59e0b' }}>
                          {r.faceDetected ? '✓ Face' : ''} {r.poseDetected ? '✓ Pose' : ''} {r.segmentationDetected ? '✓ Seg' : ''} {!r.faceDetected && !r.poseDetected && !r.segmentationDetected ? 'None' : ''}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
};
