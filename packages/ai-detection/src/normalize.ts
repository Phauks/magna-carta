import type { DetectionInput, RawDetection } from "./port.ts";
import {
  type Caveat,
  type DetectionReport,
  type LikelihoodBand,
  type Reliability,
  segmentScore,
} from "./report.ts";

// Below this many characters (~50 words) detection is unreliable regardless of the vendor's claim.
export const MIN_RELIABLE_CHARACTERS = 280;
// Score thresholds. The band is coarse on purpose; the wide mid-zone is `mixed`, not a forced binary.
export const UNLIKELY_MAX = 0.2;
export const LIKELY_MIN = 0.8;
// A vendor-reported confidence at or below this is treated as a low-confidence signal.
export const LOW_VENDOR_CONFIDENCE_MAX = 0.5;

export function bandForScore(score: number): LikelihoodBand {
  if (!Number.isFinite(score)) return "inconclusive";
  if (score < UNLIKELY_MAX) return "unlikely";
  if (score >= LIKELY_MIN) return "likely";
  return "mixed";
}

export function caveatsFor(input: DetectionInput, raw: RawDetection): Caveat[] {
  const caveats: Caveat[] = [];
  if (input.text.length < MIN_RELIABLE_CHARACTERS) caveats.push("text-too-short");
  const languageHint = input.languageHint?.trim();
  if (
    languageHint !== undefined &&
    languageHint !== "" &&
    !languageHint.toLowerCase().startsWith("en")
  ) {
    caveats.push("non-target-language");
  }
  if (raw.vendorConfidence !== undefined && raw.vendorConfidence <= LOW_VENDOR_CONFIDENCE_MAX) {
    caveats.push("low-vendor-confidence");
  }
  if (raw.signals?.paraphraseSuspected === true)
    caveats.push("possible-paraphrase-or-humanization");
  if (raw.signals?.mixedAuthorship === true) caveats.push("mixed-or-edited-authorship");
  return caveats;
}

// Every spec-§0 accuracy-collapse vector is fatal: a result on short, non-target-language,
// paraphrased/humanized, or mixed/edited text never asserts a direction. `low-vendor-confidence`
// is fatal too. (All currently-defined caveats are fatal, so `reliabilityFor` returns only
// high/low today; the `moderate` tier is reserved for any future non-fatal caveat.)
const FATAL_CAVEATS: ReadonlySet<Caveat> = new Set([
  "text-too-short",
  "non-target-language",
  "possible-paraphrase-or-humanization",
  "mixed-or-edited-authorship",
  "low-vendor-confidence",
]);

export function reliabilityFor(caveats: readonly Caveat[]): Reliability {
  if (caveats.some((caveat) => FATAL_CAVEATS.has(caveat))) return "low";
  if (caveats.length > 0) return "moderate";
  return "high";
}

export interface NormalizeMetadata {
  readonly adapterId: string;
  readonly detectedAt: string;
  readonly egressedTo: string;
}

// The agnostic heart: a vendor's raw score becomes OUR framed report. A low-reliability result never
// asserts a direction — its headline band is forced to `inconclusive`.
export function normalize(
  input: DetectionInput,
  raw: RawDetection,
  metadata: NormalizeMetadata,
): DetectionReport {
  const caveats = caveatsFor(input, raw);
  const reliability = reliabilityFor(caveats);
  const band: LikelihoodBand = reliability === "low" ? "inconclusive" : bandForScore(raw.score);
  const segments = raw.segments?.map((segment) =>
    segmentScore(
      segment.startCharacter,
      segment.endCharacter,
      segment.score,
      reliability === "low" ? "inconclusive" : bandForScore(segment.score),
    ),
  );
  return {
    band,
    score: raw.score,
    reliability,
    caveats,
    ...(segments !== undefined ? { segments } : {}),
    provenance: {
      adapterId: metadata.adapterId,
      ...(raw.vendorModel !== undefined ? { vendorModel: raw.vendorModel } : {}),
      ...(raw.vendorVersion !== undefined ? { vendorVersion: raw.vendorVersion } : {}),
      detectedAt: metadata.detectedAt,
      egressedTo: metadata.egressedTo,
    },
  };
}
