// Bump when GENERATION LOGIC changes in a way that alters produced rows for the same profile +
// seed (new archetype, changed faker call order, …) — it participates in snapshot identity, so a
// stale cached artifact can never be measured against silently. Profile parameter changes bump
// the profile's own `version` instead.
export const GENERATOR_VERSION = 2;

// Transaction archetypes, weighted (faker.helpers.weightedArrayElement). The settlement archetype
// is the multi-line tail; the rest are two-line entries. Weights are profile PARAMETERS, never
// generator constants.
export interface ArchetypeWeights {
  readonly trustDeposit: number;
  readonly trustDisbursement: number;
  readonly feeBilled: number;
  readonly paymentReceived: number;
  readonly operatingExpense: number;
  readonly settlement: number;
}

// The practice volume the matters/locations/file-manager generator lays down on top of the ledger
// book: offices, matter
// types, the active numbering scheme, matters across the lifecycle, and the folder/file tree with
// committed clean versions. Every count/distribution is a PARAMETER here, never a generator constant —
// changing one bumps the profile `version` (the baseline file renames), so a baseline can never
// silently compare data of two different shapes. The file/file_version/storage_meter rows ARE the
// queryable shadow of the R2 blob layer: node:sqlite has no R2, so the modeled sizes and version rows
// stand in for the blobs the reads and the meter would resolve against in production.
export interface PracticeVolume {
  readonly locationCount: number;
  readonly matterTypeCount: number;
  // Matters laid down per lifecycle status. Prospective = consultations (no number); open/closed draw
  // a number through openMatter, exercising the counter.
  readonly prospectiveMatterCount: number;
  readonly openMatterCount: number;
  readonly closedMatterCount: number;
  // Folders created per matter (a flat working set under the matter root; no nesting in v1 volume).
  readonly foldersPerMatter: { readonly min: number; readonly max: number };
  // Files created per matter (each lands in a matter folder or the matter root).
  readonly filesPerMatter: { readonly min: number; readonly max: number };
  // Committed clean versions per file (≥ 1 — a file is visible only once a version commits clean).
  readonly versionsPerFile: { readonly min: number; readonly max: number };
  // Synthetic committed-version size in bytes, drawn per version (the modeled R2 blob size that also
  // feeds storage_meter). Plausible document sizes, not a stress payload.
  readonly fileSizeBytes: { readonly min: number; readonly max: number };
}

export interface LedgerVolumeProfile {
  readonly name: "ledgerVolume";
  // Profile identity: bump on ANY parameter change — baselines measured against different data
  // must never masquerade as comparable.
  readonly version: number;
  readonly trustSubledgerCount: number;
  readonly entryCount: number;
  // Entries spread their effective dates across this span via fixed-clock advances.
  readonly postingSpanDays: number;
  // Fraction of operating-expense entries immediately reversed (trust entries are never reversed —
  // keeps the generator's in-memory trust tracking one-directional and simple).
  readonly reversalRate: number;
  readonly archetypeWeights: ArchetypeWeights;
  // The practice volume laid over the ledger book (matters/locations/file-manager).
  readonly practice: PracticeVolume;
}

// A plausible established small firm: a few years of posting activity over a 200-client trust book,
// three offices, a working caseload of a few hundred matters, and a document tree of a few thousand
// files with multi-version histories.
export const ledgerVolume: LedgerVolumeProfile = {
  name: "ledgerVolume",
  version: 2,
  trustSubledgerCount: 200,
  entryCount: 25_000,
  postingSpanDays: 1_095,
  reversalRate: 0.02,
  archetypeWeights: {
    trustDeposit: 20,
    trustDisbursement: 12,
    feeBilled: 22,
    paymentReceived: 18,
    operatingExpense: 23,
    settlement: 5,
  },
  practice: {
    locationCount: 3,
    matterTypeCount: 8,
    prospectiveMatterCount: 60,
    openMatterCount: 220,
    closedMatterCount: 120,
    foldersPerMatter: { min: 2, max: 6 },
    filesPerMatter: { min: 3, max: 14 },
    versionsPerFile: { min: 1, max: 4 },
    fileSizeBytes: { min: 20_000, max: 8_000_000 },
  },
};

// One profile, every scale: CI smoke (~0.01), local working scale (1), deliberate stress runs
// (>1). Floors keep a tiny multiplier generatable (enough entries/subledgers for every archetype,
// and at least one office, type, and a handful of matters/files so every measured read has data).
export function scaleProfile(
  profile: LedgerVolumeProfile,
  multiplier: number,
): LedgerVolumeProfile {
  const scaleCount = (value: number, floor: number) =>
    Math.max(floor, Math.round(value * multiplier));
  return {
    ...profile,
    entryCount: Math.max(20, Math.round(profile.entryCount * multiplier)),
    trustSubledgerCount: Math.max(3, Math.round(profile.trustSubledgerCount * multiplier)),
    practice: {
      ...profile.practice,
      locationCount: scaleCount(profile.practice.locationCount, 2),
      matterTypeCount: scaleCount(profile.practice.matterTypeCount, 2),
      prospectiveMatterCount: scaleCount(profile.practice.prospectiveMatterCount, 2),
      openMatterCount: scaleCount(profile.practice.openMatterCount, 3),
      closedMatterCount: scaleCount(profile.practice.closedMatterCount, 2),
    },
  };
}
