import type { RandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";

// The closed vocabulary and the bounds of a matter's Bates numbers. The vocabulary matches the CHECK
// on `bates_range` (packages/database/src/per-firm-schema.ts) and the bounds sit inside its CHECKs.

/** What took a range: a stamp in the PDF Editor, or an exhibit package. */
export const BATES_PURPOSES = ["pdfEditor", "exhibitPackage"] as const;
export type BatesPurpose = (typeof BATES_PURPOSES)[number];

export const MAX_PREFIX_LENGTH = 40;
export const MIN_DIGITS = 1;
export const MAX_DIGITS = 12;
export const DEFAULT_DIGITS = 6;

/** The first number under a prefix nothing has stamped yet. */
export const DEFAULT_FIRST_NUMBER = 1;

/** The most pages one range covers. A trial package of several thousand pages fits. */
export const MAX_PAGES_PER_RANGE = 100_000;

/** The highest number a range may reach: twelve digits, the most a stamp pads to. */
export const MAX_BATES_NUMBER = 999_999_999_999;

/** What every service is handed: a clock, the acting member, and optionally a seeded id source. */
export interface BatesServiceOptions {
  readonly clock: { now(): string };
  readonly actorUserId: UserId | null;
  readonly randomSource?: RandomSource;
}
