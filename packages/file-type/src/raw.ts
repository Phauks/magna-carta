// The Container's verbatim Magika output — raw facts, no verdict. The app maps this to a FileTypeReport.
// Engine and model versions are carried separately so a future re-identify can reason about which model
// produced a finding (the same separability the scan engine version needs).
export interface RawIdentifyResult {
  readonly label: string; // Magika content-type label, e.g. "pdf", "python"
  readonly score: number; // Magika confidence, 0..1
  readonly group: string; // Magika group, e.g. "document", "image", "code", "executable"
  readonly magikaVersion: string; // the Magika engine/crate version
  readonly modelVersion: string; // the model identifier the engine used
}

// Magika's sentinel labels for "no usable type". The app surfaces these as `unverifiable`, never a
// false mismatch.
export const UNKNOWN_LABELS: ReadonlySet<string> = new Set(["unknown", "empty", "undefined"]);
