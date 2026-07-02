/**
 * Minimal local declarations for apca-w3, which ships no TypeScript types (0.1.9).
 * Only the surface the contrast gate (test/contrast.test.ts) uses is declared.
 */
declare module "apca-w3" {
  /** Relative screen luminance Y of an 8-bit sRGB triplet (each channel 0–255). */
  export function sRGBtoY(rgb: readonly [number, number, number]): number;

  /**
   * APCA lightness contrast Lc from text and background luminances (sRGBtoY outputs).
   * Returns a number when `places` is -1 (the default), a rounded string otherwise.
   */
  export function APCAcontrast(
    textY: number,
    backgroundY: number,
    places?: number,
  ): number | string;
}
