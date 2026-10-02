/*
 * The QR code as geometry: the module matrix the encoder hands back, turned into ONE SVG path.
 *
 * One path rather than a rect per module because a two-factor URI encodes to a 45-module square,
 * and two thousand elements for one picture is a DOM a screen reader and a layout pass both walk
 * for nothing. Each run of dark modules along a row becomes a single rectangle, which is also what
 * keeps adjacent modules from showing a hairline seam between them when the square is scaled.
 *
 * Pure, so the node pool can pin it without rendering Svelte.
 */
import { encode } from "uqr";

/**
 * The light margin every side of the symbol, in modules. Four is what the QR specification
 * requires, and it is not decoration: a phone camera finds the symbol by the contrast at its edge,
 * and a narrower margin against a busy surface is the usual reason a code will not scan.
 */
export const QUIET_ZONE_MODULES = 4;

export interface QrGeometry {
  /** The side of the whole square, quiet zone included, in modules — the viewBox extent. */
  readonly extent: number;
  /** Every dark module, as one path in module units, already offset by the quiet zone. */
  readonly path: string;
}

/** The path for a matrix whose `true` cells are dark, offset by `offset` modules on both axes. */
export function darkModulePath(matrix: readonly (readonly boolean[])[], offset: number): string {
  const segments: string[] = [];
  matrix.forEach((row, rowIndex) => {
    let column = 0;
    while (column < row.length) {
      if (!row[column]) {
        column += 1;
        continue;
      }
      const start = column;
      while (column < row.length && row[column]) column += 1;
      const run = column - start;
      segments.push(`M${start + offset} ${rowIndex + offset}h${run}v1h-${run}z`);
    }
  });
  return segments.join("");
}

/**
 * Encodes `value` and lays it out.
 *
 * Error correction is M (about 15% of the symbol recoverable): the level authenticator apps are
 * written against, and enough to survive a glare spot on a laptop screen without growing a
 * two-factor URI into a denser symbol that a phone held at arm's length reads less reliably.
 */
export function qrGeometry(value: string): QrGeometry {
  const { size, data } = encode(value, { ecc: "M", border: 0 });
  return {
    extent: size + QUIET_ZONE_MODULES * 2,
    path: darkModulePath(data, QUIET_ZONE_MODULES),
  };
}
