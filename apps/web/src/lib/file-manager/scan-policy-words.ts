/*
 * The firm's scan settings, in the reader's words — one home, because two surfaces state them.
 *
 * The File Safety settings page WRITES them; a file's Safety tab READS them, to answer what the
 * check that graded this file ran under. Two lists of the same four settings would drift into two
 * vocabularies for one configuration, and a reader comparing the two surfaces would have no way to
 * tell a different word from a different setting. So the labels and the option words live here and
 * both surfaces take them: scan-policy-draft.svelte.ts builds its settings definitions from these,
 * and scanSettingsLines below is what the Safety tab renders.
 *
 * The engine is NOT here: it reports itself and is decomposed by $lib/versions/scan-engine-version.ts,
 * which is the home of those three words.
 */
import type { FlaggedTreatment, ScanTier } from "./scan-policy-api.ts";

export const SCAN_DEPTH_LABEL = "Scan Depth";
export const SUSPICION_THRESHOLD_LABEL = "Suspicion Threshold";
export const FLAGGED_FILES_LABEL = "Flagged Files";
export const CONFIRM_IDENTITY_LABEL = "Confirm Identity First";

/** A depth is its own word and nothing else; what it MEANS is said beneath the engine that runs it. */
export const SCAN_TIER_LABELS: Readonly<Record<ScanTier, string>> = {
  core: "Core",
  extended: "Extended",
  full: "Full",
};

/** What the firm can do with a file the scan flagged. It is never deleted, by design. */
export const FLAGGED_TREATMENT_LABELS: Readonly<Record<FlaggedTreatment, string>> = {
  block: "Block it. No one can open it.",
  "informed-access": "Ask first. It opens once the risk is accepted.",
  "allow-and-flag": "Allow it. It opens, marked as flagged.",
};

/** The settings a reading states, as the four values the server carries them as. */
export interface ScanSettingsReading {
  readonly tier: ScanTier;
  readonly suspiciousScoreFloor: number;
  readonly flaggedTreatment: FlaggedTreatment;
  readonly stepUpReauthOnFlagged: boolean;
}

/** One named value of the reading. */
export interface ScanSettingsLine {
  readonly label: string;
  readonly value: string;
}

/**
 * The four settings as named values, in the order the settings page asks them in, so a reader
 * moving between the two surfaces meets them in one order.
 */
export function scanSettingsLines(settings: ScanSettingsReading): readonly ScanSettingsLine[] {
  return [
    { label: SCAN_DEPTH_LABEL, value: SCAN_TIER_LABELS[settings.tier] },
    { label: SUSPICION_THRESHOLD_LABEL, value: String(settings.suspiciousScoreFloor) },
    { label: FLAGGED_FILES_LABEL, value: FLAGGED_TREATMENT_LABELS[settings.flaggedTreatment] },
    { label: CONFIRM_IDENTITY_LABEL, value: settings.stepUpReauthOnFlagged ? "Yes" : "No" },
  ];
}

/**
 * What the platform records about a check, said where the settings are read. Only the engine rides
 * the event itself; the depth, the threshold and the treatment are read from the firm as it stands
 * now, so a check run before somebody changed one of them cannot be shown against the setting it
 * actually ran under. Stated rather than quietly implied, because a reader auditing a verdict is
 * entitled to know which of these numbers describes their file and which describes today.
 */
export const SCAN_SETTINGS_PROVENANCE_LABEL = "Recorded Per Check";
export const SCAN_SETTINGS_PROVENANCE =
  "These settings are the firm's current ones. Settings in force for earlier checks aren't recorded.";

/** The sample values the reading takes while the real ones are read. Named by nothing real. */
export const SCAN_SETTINGS_FIXTURE: ScanSettingsReading = {
  tier: "extended",
  suspiciousScoreFloor: 0,
  flaggedTreatment: "block",
  stepUpReauthOnFlagged: false,
};
