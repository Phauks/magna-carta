import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type {
  FileId,
  MatterAssetId,
  MatterAssetValuationId,
  UserId,
} from "@magna-carta/identifiers/types";
import { readMatterAsset } from "./asset-statements.ts";
import type { MatterAssetValuationBasis } from "./types.ts";
import {
  appendMatterAssetValuationStatement,
  readMatterAssetValuation,
} from "./valuation-statements.ts";
import {
  MatterAssetValidationError,
  assertAmountShape,
  assertBasis,
  assertCivilDate,
} from "./validation.ts";

// Recording what a thing was worth, as of a date, on a stated footing.
//
// THERE IS EXACTLY ONE WRITE HERE AND IT APPENDS. No update function exists and none can be added
// without the database refusing it: matter_asset_valuation carries BEFORE UPDATE / BEFORE DELETE /
// replace-guard triggers. A typo is corrected by appending a row that names the row it corrects,
// which supersedes it in every read while both stay on the record. The cost is one extra field; the
// benefit is that the register can be handed to a court, because a schedule filed in March and a
// register read in September cannot silently disagree.

export interface MatterAssetServiceOptions {
  readonly clock: { now(): string };
  readonly actorUserId: UserId | null;
  readonly randomSource?: RandomSource;
}

export interface AppendValuationInput {
  readonly assetId: MatterAssetId;
  // The date the figure SPEAKS TO — the date of death, the date of separation, the day of the
  // appraisal. Separate from when it was typed in, because those diverge routinely and collapsing
  // them makes back-dating either impossible or indistinguishable from falsification.
  readonly asOfDate: string;
  readonly amountMinor?: number | null;
  readonly currency?: string | null;
  readonly basis: string;
  readonly sourceNote?: string | null;
  // The appraisal, statement, or bill of sale behind the figure — an already-ingested matter file.
  readonly supportingFileId?: FileId | null;
  // Set on a compensating row. The row it names stops resolving in every as-of read from the moment
  // this one commits; neither row is ever edited or removed.
  readonly correctsValuationId?: MatterAssetValuationId | null;
}

export async function appendMatterAssetValuation(
  database: SqlDatabase,
  input: AppendValuationInput,
  options: MatterAssetServiceOptions,
): Promise<{ valuationId: MatterAssetValuationId; effect: EffectWrite }> {
  assertCivilDate(input.asOfDate, "asOfDate");
  const basis: MatterAssetValuationBasis = assertBasis(input.basis);
  assertAmountShape(input.amountMinor, input.currency);

  const asset = await readMatterAsset(database, input.assetId);
  if (asset === undefined) {
    throw new MatterAssetValidationError(
      "matter-asset-unknown-asset",
      "no such asset in this firm",
    );
  }

  const corrects = input.correctsValuationId ?? null;
  if (corrects !== null) {
    const corrected = await readMatterAssetValuation(database, corrects);
    if (corrected === undefined || corrected.asset_id !== input.assetId) {
      throw new MatterAssetValidationError(
        "matter-asset-unknown-valuation",
        "a correction names a valuation on the same asset",
      );
    }
    // A correction that changed currency would leave a history that cannot be read as one series:
    // the corrected figure and its correction have to be the same kind of number.
    if (
      corrected.currency !== null &&
      input.currency !== null &&
      input.currency !== undefined &&
      corrected.currency !== input.currency
    ) {
      throw new MatterAssetValidationError(
        "matter-asset-currency-mismatch",
        "a correction restates a figure in the currency the figure was recorded in",
      );
    }
  }

  const now = options.clock.now();
  const valuationId = newIdentifier("matterAssetValuation", options.randomSource);
  const statements: SqlStatement[] = [
    appendMatterAssetValuationStatement(database, {
      id: valuationId,
      assetId: input.assetId,
      asOfDate: input.asOfDate,
      amountMinor: input.amountMinor ?? null,
      currency: input.currency ?? null,
      basis,
      sourceNote: input.sourceNote ?? null,
      supportingFileId: input.supportingFileId ?? null,
      correctsValuationId: corrects,
      recordedBy: options.actorUserId,
      recordedAt: now,
    }),
    // Identifiers and the basis only. Never an amount, a currency, a description, or a source note —
    // the audit log is not a second place a matter's numbers live.
    domainAuditStatement(database, {
      event:
        corrects === null ? "matterAsset.valuation.appended" : "matterAsset.valuation.corrected",
      subjectId: valuationId,
      actorUserId: options.actorUserId,
      clock: options.clock,
      randomSource: options.randomSource,
      metadata: {
        matterId: asset.matter_id,
        assetId: input.assetId,
        basis,
        ...(corrects === null ? {} : { correctsValuationId: corrects }),
      },
    }),
  ];
  return { valuationId, effect: { statements, outboxMessages: [] } };
}
