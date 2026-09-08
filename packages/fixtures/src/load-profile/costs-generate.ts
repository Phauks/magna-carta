import { civilDateOf } from "@magna-carta/civil-time/civil-date";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { COST_ENTRY_TABLE } from "@magna-carta/costs/cost-entry-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { CostEntryId, MatterId, UserId } from "@magna-carta/identifiers/types";
import type { FixtureContext } from "../context.ts";
import { assertSeedingAllowed, type SeedingOptions } from "../guard.ts";
import type { CostVolume } from "./profile.ts";

// The costs volume (disbursement entries captured over the firm's matters). Each row is composed
// directly to the cost_entry schema so the generator can place it anywhere on the draft→billed
// lifecycle the CostVolume status weights call for (the WIP store's only writer hardcodes 'draft' at
// capture, then transitions one step at a time — the generator stands the resting distribution up in
// one pass). All randomness is drawn from the one FixtureContext; the module reads no wall-clock.
//
// It runs AFTER the practice generation: it binds its entries to the matters that generation laid down
// (passed in as attach points), so the disbursement WIP store points at real matters.

// Probe identifiers the costs measurement layer binds real queries to — deterministic for a given
// profile + seed, recorded alongside the generation result.
export interface CostProbes {
  readonly busiestMatterId: MatterId; // the matter with the most unbilled entries — the WIP read target
  readonly probeCostEntryId: CostEntryId; // a captured entry — the by-id (primary-key) read target
  readonly probeRecoveryRef: string; // a recovery entry's ref — the dedup-lookup target
}

export interface CostGenerationResult {
  readonly costEntryCount: number;
  readonly recoveryEntryCount: number;
  readonly probes: CostProbes;
}

// The inputs the practice generation already produced, threaded in so cost entries bind to real
// matters and carry a real captor.
export interface CostAttachPoints {
  readonly actorUserId: UserId;
  readonly matterIds: readonly MatterId[];
}

type CostStatus = "draft" | "submitted" | "approved" | "billed" | "void";

const DESCRIPTIONS = [
  "Filing fee — superior court",
  "Certified mail to opposing counsel",
  "Court reporter — deposition transcript",
  "Expert witness retainer",
  "Records retrieval — medical provider",
  "Process server fee",
] as const;

const RECOVERY_CATEGORIES = ["postage", "e-filing", "messaging"] as const;

// Add days to a civil PlainDate string (YYYY-MM-DD) without a wall-clock read — pure UTC arithmetic.
function addDays(plainDate: string, days: number): string {
  const at = new Date(`${plainDate}T00:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return civilDateOf(at);
}

// Composes the full cost_entry row directly (status included): the capture statement hardcodes 'draft',
// but the load profile needs entries resting across the lifecycle, so the generator owns the column set.
const INSERT_COST_ENTRY_SQL = `INSERT INTO ${COST_ENTRY_TABLE} (id, matter_id, vendor_id, incurred_date, amount_minor, currency, disbursement_class, billable, utbms_expense_code_id, description, receipt_file_id, status, kick_back_reason, source, recovery_category, recovery_ref, invoice_id, created_at, updated_at, created_by) VALUES (?1, ?2, NULL, ?3, ?4, 'USD', ?5, ?6, NULL, ?7, NULL, ?8, NULL, ?9, ?10, ?11, NULL, ?12, ?12, ?13)`;

export async function generateCostVolume(
  database: SqlDatabase,
  context: FixtureContext,
  volume: CostVolume,
  attach: CostAttachPoints,
  options: SeedingOptions,
): Promise<CostGenerationResult> {
  assertSeedingAllowed(options);
  const { faker, clock, randomSource } = context;
  const baseDate = clock.today();
  const createdAt = clock.now();

  const statusChoices: { weight: number; value: CostStatus }[] = [
    { weight: volume.statusWeights.draft, value: "draft" },
    { weight: volume.statusWeights.submitted, value: "submitted" },
    { weight: volume.statusWeights.approved, value: "approved" },
    { weight: volume.statusWeights.billed, value: "billed" },
    { weight: volume.statusWeights.void, value: "void" },
  ];

  let costEntryCount = 0;
  let recoveryEntryCount = 0;
  let probeCostEntryId: CostEntryId | null = null;
  let probeRecoveryRef: string | null = null;
  // The busiest matter by UNBILLED entry count (draft/submitted/approved) — the WIP read's hot case.
  const matterUnbilledTally = new Map<MatterId, number>();

  for (const matterId of attach.matterIds) {
    const entries = faker.number.int({
      min: volume.entriesPerMatter.min,
      max: volume.entriesPerMatter.max,
    });
    for (let index = 0; index < entries; index += 1) {
      const id = newIdentifier("costEntry", randomSource);
      const status = faker.helpers.weightedArrayElement(statusChoices);
      // Draw every per-row attribute so faker's call order stays uniform; the first entry is forced to
      // the recovery seam so a recovery row (and its probe ref) always exists at any scale.
      const recoveryDraw = faker.number.float({ min: 0, max: 1 }) < volume.recoveryFraction;
      const isRecovery = costEntryCount === 0 ? true : recoveryDraw;
      const disbursementClass =
        faker.number.float({ min: 0, max: 1 }) < volume.hardCostFraction ? "hard" : "soft";
      const billable = faker.number.float({ min: 0, max: 1 }) < volume.billableFraction ? 1 : 0;
      const description = faker.helpers.arrayElement(DESCRIPTIONS);
      const incurredDate = addDays(
        baseDate,
        -faker.number.int({ min: 0, max: Math.max(0, volume.spanDays - 1) }),
      );
      const amountMinor = faker.number.int({ min: 500, max: 250_000 });
      const source = isRecovery ? "recovery" : index % 3 === 0 ? "manual" : "grid";
      const recoveryCategory = isRecovery ? faker.helpers.arrayElement(RECOVERY_CATEGORIES) : null;
      // `${matterId}:${index}` is unique across the whole run (matterId is unique per matter, index
      // unique within it), so the partial-unique index on recovery_ref is never violated.
      const recoveryRef = isRecovery ? `${matterId}:${index}` : null;

      await database
        .prepare(INSERT_COST_ENTRY_SQL)
        .bind(
          id,
          matterId,
          incurredDate,
          amountMinor,
          disbursementClass,
          billable,
          description,
          status,
          source,
          recoveryCategory,
          recoveryRef,
          createdAt,
          attach.actorUserId,
        )
        .run();

      costEntryCount += 1;
      probeCostEntryId ??= id;
      if (isRecovery && recoveryRef !== null) {
        recoveryEntryCount += 1;
        probeRecoveryRef ??= recoveryRef;
      }
      if (status !== "billed" && status !== "void") {
        matterUnbilledTally.set(matterId, (matterUnbilledTally.get(matterId) ?? 0) + 1);
      }
      clock.advanceMinutes(1);
    }
  }

  if (probeCostEntryId === null || probeRecoveryRef === null) {
    throw new Error(
      "costs generator: no matters/entries to seed — needs at least one matter with a non-empty entry range",
    );
  }

  let busiestMatterId = attach.matterIds[0]!;
  let busiestCount = -1;
  for (const [matterId, count] of matterUnbilledTally) {
    if (count > busiestCount) {
      busiestCount = count;
      busiestMatterId = matterId;
    }
  }

  return {
    costEntryCount,
    recoveryEntryCount,
    probes: { busiestMatterId, probeCostEntryId, probeRecoveryRef },
  };
}
