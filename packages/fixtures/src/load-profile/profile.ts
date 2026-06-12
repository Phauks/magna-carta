// Bump when GENERATION LOGIC changes in a way that alters produced rows for the same profile +
// seed (new archetype, changed faker call order, …) — it participates in snapshot identity, so a
// stale cached artifact can never be measured against silently. Profile parameter changes bump
// the profile's own `version` instead.
export const GENERATOR_VERSION = 1;

// Transaction archetypes, weighted (faker.helpers.weightedArrayElement). The settlement archetype
// is the multi-line tail; the rest are two-line entries. Weights are profile PARAMETERS, never
// generator constants (ADR-0083).
export interface ArchetypeWeights {
  readonly trustDeposit: number;
  readonly trustDisbursement: number;
  readonly feeBilled: number;
  readonly paymentReceived: number;
  readonly operatingExpense: number;
  readonly settlement: number;
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
}

// A plausible established small firm: a few years of posting activity over a 200-client trust book.
export const ledgerVolume: LedgerVolumeProfile = {
  name: "ledgerVolume",
  version: 1,
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
};

// One profile, every scale: CI smoke (~0.01), local working scale (1), deliberate stress runs
// (>1). Floors keep a tiny multiplier generatable (enough entries/subledgers for every archetype).
export function scaleProfile(
  profile: LedgerVolumeProfile,
  multiplier: number,
): LedgerVolumeProfile {
  return {
    ...profile,
    entryCount: Math.max(20, Math.round(profile.entryCount * multiplier)),
    trustSubledgerCount: Math.max(3, Math.round(profile.trustSubledgerCount * multiplier)),
  };
}
