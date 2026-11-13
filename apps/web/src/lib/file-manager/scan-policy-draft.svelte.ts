/*
 * The firm's scan policy as a settings draft — the four settings the File Safety page renders, and
 * what each staged value means as a change to send.
 *
 * The staging, counting, confirming and saving are the shared server-backed draft's
 * ($lib/settings/server-backed-draft.svelte.ts); this module is the field mapping and the words.
 *
 * WHAT IS DELIBERATELY NOT HERE: a rejected-or-deleted treatment. The server's vocabulary has three
 * values and none of them destroys a file, which is the design rather than an omission — a firm
 * that loses a client's document to a false positive has lost the document.
 */
import type { SettingDefinition, SettingValue } from "$lib/settings/settings-definitions.ts";
import {
  ServerBackedSettingsDraft,
  type ServerBackedField,
} from "$lib/settings/server-backed-draft.svelte.ts";
import {
  readScanPolicy,
  updateScanPolicy,
  type FlaggedTreatment,
  type ScanPolicyPatch,
  type ScanPolicySettings,
  type ScanTier,
} from "./scan-policy-api.ts";
import {
  CONFIRM_IDENTITY_LABEL,
  FLAGGED_FILES_LABEL,
  FLAGGED_TREATMENT_LABELS,
  SCAN_DEPTH_LABEL,
  SCAN_TIER_LABELS,
  SUSPICION_THRESHOLD_LABEL,
} from "./scan-policy-words.ts";

/** The settings section this draft belongs to (settings-sections.ts). */
export const FILE_SAFETY_SECTION_ID = "file-safety";

export const SCAN_TIER_DEFINITION: SettingDefinition = {
  id: "file-safety.scan-tier",
  sectionId: FILE_SAFETY_SECTION_ID,
  plateLabel: "What Is Scanned",
  label: SCAN_DEPTH_LABEL,
  description: "How many malware rules each upload is checked against.",
  kind: "select",
  // The option is its word and nothing else (owner ruling): what a depth MEANS is said beneath the
  // engine that runs it, revealed by the choice — scanTierMeaning below — never welded into the
  // label a person has to read in a one-line field. The words are scan-policy-words.ts's, because
  // a file's Safety tab reads the same setting back and the two must not name it differently.
  options: [
    { value: "core", label: SCAN_TIER_LABELS.core },
    { value: "extended", label: SCAN_TIER_LABELS.extended },
    { value: "full", label: SCAN_TIER_LABELS.full },
  ],
  defaultValue: "extended",
  sensitivity: "open",
  audited: true,
};

/**
 * What choosing a depth means, in one line — only what can be stated honestly from this codebase.
 *
 * The engine bakes the YARA Forge rule packages, which nest (core within extended within full —
 * containers/scan/src/forge.rs), and a firm's depth decides which of those packages' matches
 * COUNT (packages/file-manager/src/verdict.ts: a match beyond the chosen tier is ignored, and a
 * heuristic "suspicious" rule counts only at or above the suspicion threshold). The antivirus
 * signatures and the structural checks on PDF, Office and ZIP files are outside the tiers and
 * count at every depth. The rule FAMILIES inside each package are the upstream release's, which
 * nothing here lists — so this states the meaning, and scanTierRulesDefinition marks the family
 * list as what it waits on rather than inventing names.
 */
export function scanTierMeaning(tier: ScanTier): string {
  switch (tier) {
    case "core":
      return "The high-confidence rules that catch known malware.";
    case "extended":
      return "Core, plus thousands more high-confidence malware rules and suspicious-pattern rules above the threshold.";
    case "full":
      return "Every rule, including the noisiest.";
  }
}

/** True at every depth, said once beneath the tiers. */
export const SCAN_TIER_ALWAYS_COUNTS =
  "Antivirus signatures and the structural checks on PDF, Office and ZIP files count at every depth.";

/** The tier a staged or committed value names, or the default where the value is not one. */
export function scanTierFromValue(value: SettingValue): ScanTier {
  return tierFromValue(value) ?? "extended";
}

/**
 * The engraved row beneath the engine reading: the chosen depth's meaning as its description,
 * carrying the Soon device for the rule families the engine does not yet report.
 */
export function scanTierRulesDefinition(tier: ScanTier): SettingDefinition {
  return {
    id: "file-safety.scan-tier-rules",
    sectionId: FILE_SAFETY_SECTION_ID,
    plateLabel: "What Is Scanned",
    label: "Rules At This Depth",
    description: `${scanTierMeaning(tier)} ${SCAN_TIER_ALWAYS_COUNTS}`,
    kind: "text",
    defaultValue: "",
    sensitivity: "open",
  };
}

/** What the rule-family list waits on, said beside its Soon mark. */
export const SCAN_TIER_RULES_SOON_LINE =
  "The rule groups for each level appear here once the scanner reports them.";

/** The engraved row for the engine itself: what every upload is scanned by, as it reports itself. */
export const SCAN_ENGINE_DEFINITION: SettingDefinition = {
  id: "file-safety.scan-engine",
  sectionId: FILE_SAFETY_SECTION_ID,
  plateLabel: "What Is Scanned",
  label: "Scan Engine",
  description: "The scanner that checks every upload, and its version.",
  kind: "text",
  defaultValue: "",
  sensitivity: "open",
};

export const SCORE_FLOOR_DEFINITION: SettingDefinition = {
  id: "file-safety.suspicious-score-floor",
  sectionId: FILE_SAFETY_SECTION_ID,
  plateLabel: "What Is Scanned",
  label: SUSPICION_THRESHOLD_LABEL,
  description:
    "How confident a suspicious match must be to count, from 0 to 100. Lower flags more files.",
  kind: "text",
  defaultValue: "75",
  sensitivity: "open",
  audited: true,
};

export const FLAGGED_TREATMENT_DEFINITION: SettingDefinition = {
  id: "file-safety.flagged-treatment",
  sectionId: FILE_SAFETY_SECTION_ID,
  plateLabel: "What Happens To A Flagged File",
  label: FLAGGED_FILES_LABEL,
  description: "What the firm can do with a file the scan flagged. It is never deleted.",
  kind: "select",
  options: [
    { value: "block", label: FLAGGED_TREATMENT_LABELS.block },
    { value: "informed-access", label: FLAGGED_TREATMENT_LABELS["informed-access"] },
    { value: "allow-and-flag", label: FLAGGED_TREATMENT_LABELS["allow-and-flag"] },
  ],
  defaultValue: "block",
  sensitivity: "open",
  // Consequential: loosening this is the firm deciding that a file its own scanner distrusts may
  // be opened, so the save flow asks once before it lands.
  confirm: true,
  audited: true,
};

export const STEP_UP_DEFINITION: SettingDefinition = {
  id: "file-safety.step-up-reauth",
  sectionId: FILE_SAFETY_SECTION_ID,
  plateLabel: "What Happens To A Flagged File",
  label: CONFIRM_IDENTITY_LABEL,
  description: "Ask a member to sign in again before they open a flagged file.",
  kind: "switch",
  defaultValue: false,
  sensitivity: "open",
  audited: true,
};

/** Every definition the page renders, in reading order. */
export const FILE_SAFETY_DEFINITIONS: readonly SettingDefinition[] = [
  SCAN_TIER_DEFINITION,
  SCORE_FLOOR_DEFINITION,
  FLAGGED_TREATMENT_DEFINITION,
  STEP_UP_DEFINITION,
];

const SCAN_TIERS: readonly ScanTier[] = ["core", "extended", "full"];
const FLAGGED_TREATMENTS: readonly FlaggedTreatment[] = [
  "block",
  "informed-access",
  "allow-and-flag",
];

function tierFromValue(value: SettingValue): ScanTier | null {
  return SCAN_TIERS.find((tier) => tier === value) ?? null;
}

function treatmentFromValue(value: SettingValue): FlaggedTreatment | null {
  return FLAGGED_TREATMENTS.find((treatment) => treatment === value) ?? null;
}

/**
 * The typed threshold, or null for anything that is not a whole number in range. The bound is the
 * server's own (0-100); refusing here as well is what lets the page say so beside the field rather
 * than sending a value it knows will come back a 422.
 */
export function scoreFloorFromValue(value: SettingValue): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return parsed >= 0 && parsed <= 100 ? parsed : null;
}

/** The policy object a change to either of its two settings has to send whole. */
function policyWith(
  patch: ScanPolicyPatch,
  settings: ScanPolicySettings,
): { tier: ScanTier; suspiciousScoreFloor: number } {
  // Whatever an earlier field already folded in, else what the firm holds — the wire shape carries
  // the tier and the floor together, so neither may be sent without the other's current value.
  return patch.policy ?? { ...settings.policy };
}

const FIELDS: readonly ServerBackedField<ScanPolicySettings, ScanPolicyPatch>[] = [
  {
    definition: SCAN_TIER_DEFINITION,
    valueOf: (settings) => settings.policy.tier,
    applyTo: (patch, value, settings) => {
      const tier = tierFromValue(value);
      if (tier === null) return null;
      return { ...patch, policy: { ...policyWith(patch, settings), tier } };
    },
  },
  {
    definition: SCORE_FLOOR_DEFINITION,
    valueOf: (settings) => String(settings.policy.suspiciousScoreFloor),
    applyTo: (patch, value, settings) => {
      const suspiciousScoreFloor = scoreFloorFromValue(value);
      if (suspiciousScoreFloor === null) return null;
      return { ...patch, policy: { ...policyWith(patch, settings), suspiciousScoreFloor } };
    },
    // The one field on this page somebody types into, so the one that can hold a value the server
    // would refuse. Said at the Save button rather than sent and reported back as a 422.
    refusalFor: (value) =>
      scoreFloorFromValue(value) === null
        ? "The suspicion threshold is a whole number from 0 to 100."
        : undefined,
  },
  {
    definition: FLAGGED_TREATMENT_DEFINITION,
    valueOf: (settings) => settings.flaggedTreatment,
    applyTo: (patch, value) => {
      const flaggedTreatment = treatmentFromValue(value);
      if (flaggedTreatment === null) return null;
      return { ...patch, flaggedTreatment };
    },
  },
  {
    definition: STEP_UP_DEFINITION,
    valueOf: (settings) => settings.stepUpReauthOnFlagged,
    applyTo: (patch, value) =>
      typeof value === "boolean" ? { ...patch, stepUpReauthOnFlagged: value } : null,
  },
];

export function createScanPolicyDraft(
  fetchImpl: typeof fetch,
): ServerBackedSettingsDraft<ScanPolicySettings, ScanPolicyPatch> {
  return new ServerBackedSettingsDraft({
    sectionId: FILE_SAFETY_SECTION_ID,
    fields: FIELDS,
    read: () => readScanPolicy(fetchImpl),
    write: (patch, idempotencyKey) => updateScanPolicy(fetchImpl, patch, idempotencyKey),
  });
}
