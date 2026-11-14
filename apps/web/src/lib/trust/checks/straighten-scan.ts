/*
 * A photograph or scan of a blank check, straightened. The person marks the check's four corners on
 * what they uploaded; this maps that quadrilateral onto a flat 8.5 by 3.5 inch rectangle at 100
 * pixels to the inch, so the stock editor can lay fields over it at true positions. A phone held at
 * an angle gives a trapezoid, which an affine stretch cannot undo, so it is a perspective transform:
 * the homography from the output rectangle back to the source quadrilateral, sampled bilinearly.
 *
 * Pure arithmetic over RGBA bytes, so it runs the same in a test as in the page. 850 by 350 is under
 * 300,000 pixels, a few milliseconds on the main thread.
 */

export const STRAIGHTENED_WIDTH = 850;
export const STRAIGHTENED_HEIGHT = 350;

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** The four corners, clockwise from the top left. */
export type Corners = readonly [Point, Point, Point, Point];

export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/** Solve the 8 by 8 system by Gaussian elimination with partial pivoting; null when singular. */
function solve(matrix: number[][], vector: number[]): number[] | null {
  const size = vector.length;
  const rows = matrix.map((row, index) => [...row, vector[index] as number]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row]![column]!) > Math.abs(rows[pivot]![column]!)) pivot = row;
    }
    if (Math.abs(rows[pivot]![column]!) < 1e-12) return null;
    [rows[column], rows[pivot]] = [rows[pivot]!, rows[column]!];
    for (let row = column + 1; row < size; row += 1) {
      const factor = rows[row]![column]! / rows[column]![column]!;
      for (let entry = column; entry <= size; entry += 1) {
        rows[row]![entry]! -= factor * rows[column]![entry]!;
      }
    }
  }
  const solution = new Array<number>(size).fill(0);
  for (let row = size - 1; row >= 0; row -= 1) {
    let sum = rows[row]![size]!;
    for (let column = row + 1; column < size; column += 1) sum -= rows[row]![column]! * solution[column]!;
    solution[row] = sum / rows[row]![row]!;
  }
  return solution;
}

/**
 * The homography taking each `from` point to its `to` point, as the eight coefficients of
 * [a b c; d e f; g h 1]. Null when the points are degenerate (three in a line).
 */
export function homography(from: Corners, to: Corners): readonly number[] | null {
  const matrix: number[][] = [];
  const vector: number[] = [];
  for (let index = 0; index < 4; index += 1) {
    const { x, y } = from[index]!;
    const { x: u, y: v } = to[index]!;
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    vector.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    vector.push(v);
  }
  return solve(matrix, vector);
}

export function applyHomography(coefficients: readonly number[], point: Point): Point {
  const [a, b, c, d, e, f, g, h] = coefficients as [number, number, number, number, number, number, number, number];
  const w = g * point.x + h * point.y + 1;
  return { x: (a * point.x + b * point.y + c) / w, y: (d * point.x + e * point.y + f) / w };
}

/** Corners a reasonable way in from the edges, where the editor starts them. */
export function startingCorners(width: number, height: number): Corners {
  const insetX = width * 0.05;
  const insetY = height * 0.05;
  return [
    { x: insetX, y: insetY },
    { x: width - insetX, y: insetY },
    { x: width - insetX, y: height - insetY },
    { x: insetX, y: height - insetY },
  ];
}

/**
 * The check inside `corners`, flattened to 850 by 350. Null when the corners do not make a
 * quadrilateral a check could be.
 */
export function straightenScan(source: RgbaImage, corners: Corners): RgbaImage | null {
  const output: Corners = [
    { x: 0, y: 0 },
    { x: STRAIGHTENED_WIDTH, y: 0 },
    { x: STRAIGHTENED_WIDTH, y: STRAIGHTENED_HEIGHT },
    { x: 0, y: STRAIGHTENED_HEIGHT },
  ];
  // Map each OUTPUT pixel back to where it came from, so every output pixel gets exactly one value.
  const coefficients = homography(output, corners);
  if (coefficients === null) return null;
  const data = new Uint8ClampedArray(STRAIGHTENED_WIDTH * STRAIGHTENED_HEIGHT * 4);
  const sample = (x: number, y: number, channel: number): number => {
    const clampedX = Math.min(Math.max(x, 0), source.width - 1);
    const clampedY = Math.min(Math.max(y, 0), source.height - 1);
    return source.data[(clampedY * source.width + clampedX) * 4 + channel] ?? 255;
  };
  for (let row = 0; row < STRAIGHTENED_HEIGHT; row += 1) {
    for (let column = 0; column < STRAIGHTENED_WIDTH; column += 1) {
      const { x, y } = applyHomography(coefficients, { x: column + 0.5, y: row + 0.5 });
      const left = Math.floor(x - 0.5);
      const top = Math.floor(y - 0.5);
      const fractionX = x - 0.5 - left;
      const fractionY = y - 0.5 - top;
      const offset = (row * STRAIGHTENED_WIDTH + column) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const upper =
          sample(left, top, channel) * (1 - fractionX) + sample(left + 1, top, channel) * fractionX;
        const lower =
          sample(left, top + 1, channel) * (1 - fractionX) +
          sample(left + 1, top + 1, channel) * fractionX;
        data[offset + channel] = upper * (1 - fractionY) + lower * fractionY;
      }
    }
  }
  return { width: STRAIGHTENED_WIDTH, height: STRAIGHTENED_HEIGHT, data };
}
