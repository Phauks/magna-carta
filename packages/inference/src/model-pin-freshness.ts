import { CATALOG, type CatalogEntry } from "./catalog.ts";

// A hard-coded model identifier is a fact with an expiry date that nothing in this repository observes.
// Providers ship successors and retire predecessors on their own schedule; a pin that was correct on the
// day it was written becomes wrong quietly, and the first symptom is a production failure or a firm
// running a model two generations behind the one it is paying for.
//
// This module is the observer. It reads only facts a calendar can settle against dates a human recorded
// from the provider's own reference — never prose, never a network call. That boundary is deliberate:
// a check that reaches the provider at gate time needs credentials and a network in CI and fails for
// reasons that have nothing to do with the change under test, and a check that reads English claims
// fires on correct entries far more often than on stale ones.
//
// What it therefore CANNOT see, stated so nothing above is mistaken for more than it is: a successor
// released after the last time somebody looked, or a snapshot id the provider has restated in a
// different form since. Neither is derivable from the catalog — that is why availabilityVerifiedOn dates
// them together and carries a re-check interval, so the gap is bounded by how long an entry may go
// unread rather than closed.
//
// A snapshot id that contradicts the form its own entry declares is a DIFFERENT kind of defect and is
// deliberately not checked here: it is wrong from the moment it is written rather than wrong as of some
// date, so ./catalog.ts rejects it at module load, where it fails for every consumer at import instead of
// waiting for a gate to run. This pass reports when a recorded fact is due to be re-read; the schema
// decides whether the recorded fact is internally coherent at all.

// Two severities, because they earn different responses.
//
// "expired" is a fact that is already wrong or already unsafe to rely on: a model past the retirement
// date its provider published may return an error rather than an answer. It fails the gate.
//
// "due" is a fact that needs a person's attention and no more: a successor exists, or a retirement is
// approaching, or nobody has re-read an entry in a long time. It is reported and does not fail the gate,
// because a decision that belongs to a person should not present itself as a broken build.
export type ModelPinSeverity = "due" | "expired";

export type ModelPinReason =
  | "past-published-retirement"
  | "approaching-published-retirement"
  | "successor-published"
  | "confidentiality-facts-unread"
  | "lifecycle-facts-unread";

export interface ModelPinFinding {
  readonly modelId: string;
  readonly slot: CatalogEntry["slot"];
  readonly severity: ModelPinSeverity;
  readonly reason: ModelPinReason;
  // Caller-safe explanation naming the recorded date or successor the finding rests on. Carries no
  // firm content, no prompt, and no provider response — this text is safe to print in a build log.
  readonly detail: string;
}

// A recorded fact goes unread for this long before the pass asks somebody to look at it again, and this
// much longer before it stops counting as verified at all. The soft interval is set well inside the 60
// days of notice the model provider commits to before a retirement, so an entry re-read on this cadence
// cannot have a retirement land on it unseen.
export const VERIFICATION_DUE_AFTER_DAYS = 120;
export const VERIFICATION_EXPIRED_AFTER_DAYS = 240;

// A published retirement inside this window is close enough that migrating is work to schedule rather
// than work to note.
export const RETIREMENT_WARNING_DAYS = 90;

const MILLISECONDS_PER_DAY = 86_400_000;

// Whole days from `from` to `to`, both ISO YYYY-MM-DD. Parsed as UTC midnight so the result never
// depends on the machine's zone — a gate that answers differently in two regions is not a gate.
function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    throw new Error(`model pin freshness needs ISO YYYY-MM-DD dates (got "${from}" and "${to}")`);
  }
  return Math.round((end - start) / MILLISECONDS_PER_DAY);
}

function verificationFindings(
  entry: CatalogEntry,
  today: string,
  recordedOn: string,
  reason: ModelPinReason,
  factName: string,
): readonly ModelPinFinding[] {
  const age = daysBetween(recordedOn, today);
  if (age < VERIFICATION_DUE_AFTER_DAYS) return [];
  const severity: ModelPinSeverity = age >= VERIFICATION_EXPIRED_AFTER_DAYS ? "expired" : "due";
  return [
    {
      modelId: entry.modelId,
      slot: entry.slot,
      severity,
      reason,
      detail: `${factName} last read on ${recordedOn}, ${age} days ago; re-read against the provider's reference and record the date`,
    },
  ];
}

function retirementFindings(entry: CatalogEntry, today: string): readonly ModelPinFinding[] {
  const { retirementNotBefore } = entry;
  if (retirementNotBefore === undefined) return [];
  const daysRemaining = daysBetween(today, retirementNotBefore);
  if (daysRemaining < 0) {
    return [
      {
        modelId: entry.modelId,
        slot: entry.slot,
        severity: "expired",
        reason: "past-published-retirement",
        detail: `the provider published ${retirementNotBefore} as the earliest retirement date and it has passed; requests to this model may already fail`,
      },
    ];
  }
  if (daysRemaining <= RETIREMENT_WARNING_DAYS) {
    return [
      {
        modelId: entry.modelId,
        slot: entry.slot,
        severity: "due",
        reason: "approaching-published-retirement",
        detail: `the provider's earliest published retirement date is ${retirementNotBefore}, ${daysRemaining} days away`,
      },
    ];
  }
  return [];
}

function supersessionFindings(entry: CatalogEntry): readonly ModelPinFinding[] {
  const { supersededBy } = entry;
  if (supersededBy === undefined) return [];
  return [
    {
      modelId: entry.modelId,
      slot: entry.slot,
      severity: "due",
      reason: "successor-published",
      detail: `the provider has published ${supersededBy} as the current generation; whether the platform moves to it is an owner decision and is not made here`,
    },
  ];
}

// Every finding for one entry, as of `today` (ISO YYYY-MM-DD). The date is a parameter rather than a read
// of the clock so the pass is a pure function: the same catalog and the same date always produce the same
// findings, which is what makes it testable at a fixed date rather than only on the day it happens to run.
export function modelPinFindingsFor(
  entry: CatalogEntry,
  today: string,
): readonly ModelPinFinding[] {
  return [
    ...retirementFindings(entry, today),
    ...supersessionFindings(entry),
    ...verificationFindings(
      entry,
      today,
      entry.verifiedOn,
      "confidentiality-facts-unread",
      "the zero-data-retention and no-training facts were",
    ),
    ...verificationFindings(
      entry,
      today,
      entry.availabilityVerifiedOn,
      "lifecycle-facts-unread",
      "the published-and-active lifecycle facts, including the pinned snapshot id and the form it is published in, were",
    ),
  ];
}

// Every finding across the whole catalog, as of `today`.
export function modelPinFindings(
  today: string,
  catalog: readonly CatalogEntry[] = CATALOG,
): readonly ModelPinFinding[] {
  return catalog.flatMap((entry) => modelPinFindingsFor(entry, today));
}

// The findings that fail a build, separated from the ones that only need reading.
export function expiredModelPins(
  today: string,
  catalog: readonly CatalogEntry[] = CATALOG,
): readonly ModelPinFinding[] {
  return modelPinFindings(today, catalog).filter((finding) => finding.severity === "expired");
}

// A plain-text report, for a build log or a person running the pass by hand. Caller-safe throughout:
// every line is composed from catalog data and dates.
export function formatModelPinReport(
  today: string,
  catalog: readonly CatalogEntry[] = CATALOG,
): string {
  const findings = modelPinFindings(today, catalog);
  if (findings.length === 0) return `model pins as of ${today}: nothing due.`;
  const lines = findings.map(
    (finding) =>
      `  [${finding.severity}] ${finding.modelId} (${finding.reason}) — ${finding.detail}`,
  );
  return [`model pins as of ${today}:`, ...lines].join("\n");
}
