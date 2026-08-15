import type { CustodyReminder, CustodyReminderReason } from "@magna-carta/custodian/reminders";

// THE EMISSION POINTS WITH NO PRODUCING-PACKAGE CONSTANT, and why each one is named here instead.
//
// A registry type names its emission point by imported constant wherever the producing package
// exports one, so a producer and its subscriber cannot spell the same thing two ways. Three raisers
// export no such constant, for reasons that are properties of those raisers rather than oversights:
//
//   * The CUSTODY REMINDERS are a query, not a producer. `collectCustodyReminders` returns findings
//     tagged with a reason and schedules nothing; the register deliberately holds no cron, no queue,
//     and no delivery. Its vocabulary is the `CustodyReminderReason` union, which is what the map
//     below is keyed on — exhaustively, so a new reason is a compile error here rather than a
//     reminder that quietly stops reaching anybody.
//   * The JOB COORDINATORS live in the Worker, which no package may import. The Worker's own tests
//     pin these spellings against the coordinators, which is the same guarantee by a different
//     route.
//
// Naming them in one module rather than scattering literals through the registry keeps the
// exception written down instead of being an unexplained gap.

// One emission point per reason the custody register can surface a reminder for. Exhaustive over
// the union by construction: `Record<CustodyReminderReason, string>` refuses to compile if the
// register grows a reason nothing here answers.
export const CUSTODY_EMISSION_POINT_BY_REASON: Readonly<Record<CustodyReminderReason, string>> =
  Object.freeze({
    "review-due": "custody.review.due",
    "checkout-overdue": "custody.checkout.overdue",
  });

export const CUSTODY_REVIEW_DUE_EMISSION_POINT = CUSTODY_EMISSION_POINT_BY_REASON["review-due"];
export const CUSTODY_CHECKOUT_OVERDUE_EMISSION_POINT =
  CUSTODY_EMISSION_POINT_BY_REASON["checkout-overdue"];

// The coarse age band a custody reminder reports, as runtime labels the facts grammar can validate
// against. The register declares the same set as a union on `CustodyReminder["bucket"]`; the
// assignment below is what holds the two together — a band added there and not here stops
// compiling, rather than reaching a row as a label the type never declared.
export const CUSTODY_OVERDUE_BUCKETS = Object.freeze([
  "0-7d",
  "8-30d",
  "31-90d",
  "over-90d",
] as const);

const CUSTODY_BUCKETS_COVER_THE_REGISTER: readonly CustodyReminder["bucket"][] =
  CUSTODY_OVERDUE_BUCKETS;
void CUSTODY_BUCKETS_COVER_THE_REGISTER;

// A document assembly reached a terminal state. Not a topic: the coordinator is a Durable Object
// and its transition rides no firm-database batch, so there is nothing to commit a row alongside.
export const DOCUMENT_ASSEMBLY_COMPLETED_EMISSION_POINT = "jobs.documentAssembly.completed";

// A password-recovery job reached a terminal state.
export const RECOVERY_JOB_COMPLETED_EMISSION_POINT = "jobs.recovery.completed";

// The terminal states a recovery job can end in. `found` says a secret was recovered and says
// nothing about what it is — the job state surrenders that once, to the member who started it, and
// a notification row is not that read.
export const RECOVERY_JOB_OUTCOMES = Object.freeze([
  "found",
  "exhausted",
  "needsGpu",
  "cancelled",
] as const);

export type RecoveryJobOutcome = (typeof RECOVERY_JOB_OUTCOMES)[number];

// Every emission point named here, for the fitness test that proves the registry subscribes to
// nothing it cannot account for.
export const LOCALLY_NAMED_EMISSION_POINTS: readonly string[] = Object.freeze([
  ...Object.values(CUSTODY_EMISSION_POINT_BY_REASON),
  DOCUMENT_ASSEMBLY_COMPLETED_EMISSION_POINT,
  RECOVERY_JOB_COMPLETED_EMISSION_POINT,
]);
