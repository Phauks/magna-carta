import { claimedExtensionOf } from "./filename.ts";
import { canonicalExtensions, humanLabel } from "./labels.ts";
import { UNKNOWN_LABELS, type RawIdentifyResult } from "./raw.ts";

export type ExtensionMatch = "match" | "mismatch" | "unverifiable" | "no-extension";

export interface FileTypeReport {
  readonly detected: string | null; // null when Magika returned no usable type
  readonly detectedLabel: string;
  readonly group: string;
  readonly confidence: number;
  readonly claimedExtension: string | null;
  readonly extensionMatch: ExtensionMatch;
  readonly recommendedExtensions: readonly string[];
  readonly note: string;
}

// Map raw Magika facts + the filename to the report. Deterministic given its inputs; no detection here.
export function buildFileTypeReport(raw: RawIdentifyResult, filename: string): FileTypeReport {
  const claimedExtension = claimedExtensionOf(filename);

  // No usable type: report honestly, never a false mismatch.
  if (UNKNOWN_LABELS.has(raw.label)) {
    return {
      detected: null,
      detectedLabel: humanLabel(raw.label),
      group: raw.group,
      confidence: raw.score,
      claimedExtension,
      extensionMatch: "unverifiable",
      recommendedExtensions: [],
      note: "The file's content did not match a known type, so its extension cannot be verified.",
    };
  }

  const detectedLabel = humanLabel(raw.label);
  const recommendedExtensions = canonicalExtensions(raw.label);

  let extensionMatch: ExtensionMatch;
  let note: string;
  if (claimedExtension === null) {
    extensionMatch = "no-extension";
    note =
      recommendedExtensions.length > 0
        ? `No extension on the filename; content is ${detectedLabel}. Suggested extension: .${recommendedExtensions[0]}`
        : `No extension on the filename; content is ${detectedLabel}.`;
  } else if (recommendedExtensions.length === 0) {
    // Detected, but we hold no canonical extension to compare against.
    extensionMatch = "unverifiable";
    note = `Content is ${detectedLabel}; no canonical extension is known to compare against ".${claimedExtension}".`;
  } else if (recommendedExtensions.includes(claimedExtension)) {
    extensionMatch = "match";
    note = `Extension ".${claimedExtension}" matches the content (${detectedLabel}).`;
  } else {
    extensionMatch = "mismatch";
    note = `Named ".${claimedExtension}", but the content is ${detectedLabel}. Consider .${recommendedExtensions[0]}`;
  }

  return {
    detected: raw.label,
    detectedLabel,
    group: raw.group,
    confidence: raw.score,
    claimedExtension,
    extensionMatch,
    recommendedExtensions,
    note,
  };
}
