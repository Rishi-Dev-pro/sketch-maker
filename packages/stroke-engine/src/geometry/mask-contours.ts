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
        contourGridPoints.push({ x: currX, y: currY });

        // Search for next clockwise foreground neighbor starting from backtrack direction
        const searchStartDir = (enterDir + 5) % 8;
        let foundNext = false;
        let nextX = currX;
        let nextY = currY;
        let nextDir = 0;

        for (let d = 0; d < 8; d++) {
          const dir = (searchStartDir + d) % 8;
          const nx = currX + DX[dir];
          const ny = currY + DY[dir];

          if (nx >= 0 && nx < gw && ny >= 0 && ny < gh && grid[ny * gw + nx] === 1) {
            nextX = nx;
            nextY = ny;
            nextDir = dir;
            foundNext = true;
            break;
          }
        }

        if (!foundNext) {
          break; // Isolated pixel
        }

        currX = nextX;
        currY = nextY;
        enterDir = nextDir;
        steps++;

        if (currX === startX && currY === startY && steps > 2) {
          // Closed loop completed
          break;
        }
      }

      if (contourGridPoints.length >= 4) {
        // Calculate bounding box in grid units to filter out micro-speckles
        let minGx = Infinity;
        let maxGx = -Infinity;
        let minGy = Infinity;
        let maxGy = -Infinity;

        for (let i = 0; i < contourGridPoints.length; i++) {
          const p = contourGridPoints[i];
          if (p.x < minGx) minGx = p.x;
          if (p.x > maxGx) maxGx = p.x;
          if (p.y < minGy) minGy = p.y;
          if (p.y > maxGy) maxGy = p.y;
        }

        const pixelArea = (maxGx - minGx + 1) * safeStep * (maxGy - minGy + 1) * safeStep;
        if (pixelArea >= minArea) {
          // Convert to normalized [0.0, 1.0] coordinates
          const normalized: Point2D[] = contourGridPoints.map(p => ({
            x: Math.max(0.0, Math.min(1.0, (p.x * safeStep + safeStep * 0.5) / width)),
            y: Math.max(0.0, Math.min(1.0, (p.y * safeStep + safeStep * 0.5) / height))
          }));

          // Ensure loop is explicitly closed
          if (
            normalized.length > 0 &&
            (normalized[0].x !== normalized[normalized.length - 1].x ||
              normalized[0].y !== normalized[normalized.length - 1].y)
          ) {
            normalized.push({ x: normalized[0].x, y: normalized[0].y });
          }

          contours.push(normalized);
        }
      }
    }
  }

  return contours;
}
