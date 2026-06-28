// The detection result is deliberately NOT a boolean. A reader gets a coarse likelihood band, an
// explicit reliability grade, and the structured reasons to hesitate — so a confident-looking wrong
// answer is structurally impossible to produce. `inconclusive` is a first-class, common answer.

export type LikelihoodBand = "unlikely" | "mixed" | "likely" | "inconclusive";
export const LIKELIHOOD_BANDS: readonly LikelihoodBand[] = [
  "unlikely",
  "mixed",
  "likely",
  "inconclusive",
];

export type Reliability = "high" | "moderate" | "low";

// Why a reader should hesitate. Each is detectable from the input or the vendor signal; the headline
// band degrades to `inconclusive` when reliability bottoms out (see normalize.ts).
export type Caveat =
  | "text-too-short"
  | "possible-paraphrase-or-humanization"
  | "non-target-language"
  | "mixed-or-edited-authorship"
  | "low-vendor-confidence";
export const CAVEATS: readonly Caveat[] = [
  "text-too-short",
  "possible-paraphrase-or-humanization",
  "non-target-language",
  "mixed-or-edited-authorship",
  "low-vendor-confidence",
];

export interface SegmentScore {
  readonly startChar: number;
  readonly endChar: number;
  readonly score: number; // normalized 0..1
  readonly band: LikelihoodBand;
}

export interface DetectionProvenance {
  readonly adapterId: string;
  readonly vendorModel?: string;
  readonly vendorVersion?: string;
  readonly detectedAt: string; // ISO 8601, passed in — never Date.now() in the pure core
  readonly egressedTo?: string; // which external service saw the text (consent provenance)
}

export interface DetectionReport {
  readonly band: LikelihoodBand; // the headline — coarse on purpose
  readonly score: number; // normalized 0..1, for provenance/audit, NOT the headline
  readonly reliability: Reliability; // derived from input + caveats, not vendor marketing
  readonly caveats: readonly Caveat[];
  readonly segments?: readonly SegmentScore[];
  readonly provenance: DetectionProvenance;
}

export function segmentScore(
  startChar: number,
  endChar: number,
  score: number,
  band: LikelihoodBand,
): SegmentScore {
  return { startChar, endChar, score, band };
}
