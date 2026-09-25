import { Point2D, SemanticMask } from '@sketch-maker/shared-types';

/**
 * Directional offsets for 8-neighborhood tracing (clockwise from East):
 * 0: E (+1, 0)
 * 1: SE (+1, +1)
 * 2: S (0, +1)
 * 3: SW (-1, +1)
 * 4: W (-1, 0)
 * 5: NW (-1, -1)
 * 6: N (0, -1)
 * 7: NE (+1, -1)
 */
const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, 1, 1, 1, 0, -1, -1, -1];

/**
 * Extracts closed vector polygon contours from a raster SemanticMask
 * using Moore-neighborhood boundary following.
 *
 * @param mask Semantic mask containing binary data.
 * @param step Downsample step size for grid tracing (default: 2 for speed and smoothness).
 * @param minArea Minimum bounding box area in pixels to filter speckles (default: 50).
 * @returns Array of closed polylines in normalized [0.0, 1.0] coordinates.
 */
export function extractMaskContours(
  mask: SemanticMask,
  step: number = 2,
  minArea: number = 50
): Point2D[][] {
  const { width, height, data } = mask;
  if (!data || width < 4 || height < 4) {
    return [];
  }

  const safeStep = Math.max(1, Math.floor(step));
  const gw = Math.floor(width / safeStep);
  const gh = Math.floor(height / safeStep);

  // Build downsampled binary grid
  const grid = new Uint8Array(gw * gh);
  let foregroundCount = 0;

  for (let gy = 0; gy < gh; gy++) {
    const srcY = Math.min(height - 1, gy * safeStep);
    const rowOffset = srcY * width;
    const gridOffset = gy * gw;

    for (let gx = 0; gx < gw; gx++) {
      const srcX = Math.min(width - 1, gx * safeStep);
      if (data[rowOffset + srcX] >= 128) {
        grid[gridOffset + gx] = 1;
        foregroundCount++;
      }
    }
  }

  if (foregroundCount < Math.floor(minArea / (safeStep * safeStep))) {
    return [];
  }

  const visited = new Uint8Array(gw * gh);
  const contours: Point2D[][] = [];

  // Scan raster to find starting boundary pixels
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const idx = gy * gw + gx;
      if (grid[idx] === 0 || visited[idx] === 1) {
        continue;
      }

      // Check if it's a boundary pixel (has an empty 4-neighbor or is at border)
      const isBoundary =
        gx === 0 ||
        gx === gw - 1 ||
        gy === 0 ||
        gy === gh - 1 ||
        grid[idx - 1] === 0 ||
        grid[idx + 1] === 0 ||
        grid[idx - gw] === 0 ||
        grid[idx + gw] === 0;

      if (!isBoundary) {
        continue;
      }

      // Trace outer perimeter using Moore neighborhood
      const contourGridPoints: Point2D[] = [];
      let currX = gx;
      let currY = gy;
      let enterDir = 6; // Started scanning from top
      const maxSteps = gw * gh * 2;
      let steps = 0;

      const startX = gx;
      const startY = gy;

      while (steps < maxSteps) {
        visited[currY * gw + currX] = 1;
        contourGridPoints.push({
          x: Number(((currX * safeStep + safeStep * 0.5) / width).toFixed(5)),
          y: Number(((currY * safeStep + safeStep * 0.5) / height).toFixed(5))
        });

        // Search 8-neighborhood starting counterclockwise from entry direction
        let foundNext = false;
        const searchStartDir = (enterDir + 5) % 8; // Backtrack slightly

        for (let d = 0; d < 8; d++) {
          const checkDir = (searchStartDir + d) % 8;
          const nx = currX + DX[checkDir];
          const ny = currY + DY[checkDir];

          if (nx >= 0 && nx < gw && ny >= 0 && ny < gh && grid[ny * gw + nx] === 1) {
            currX = nx;
            currY = ny;
            enterDir = checkDir;
            foundNext = true;
            break;
          }
        }

        if (!foundNext) {
          break; // Isolated single pixel
        }

        steps++;
        if (currX === startX && currY === startY) {
          break; // Closed perimeter reached
        }
      }

      // Filter small speckles/loops and guarantee explicit closed loop
      if (contourGridPoints.length >= 3) {
        const first = contourGridPoints[0];
        const last = contourGridPoints[contourGridPoints.length - 1];
        if (first.x !== last.x || first.y !== last.y) {
          contourGridPoints.push({ x: first.x, y: first.y });
        }
        if (contourGridPoints.length >= 4) {
          contours.push(contourGridPoints);
        }
      }
    }
  }

  // Sort loops by point count descending (largest outer boundary first)
  contours.sort((a, b) => b.length - a.length);

  return contours;
}
