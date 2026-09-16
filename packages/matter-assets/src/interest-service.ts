import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import { guarded } from "@magna-carta/data-access/effect-batch";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { MatterAssetId, MatterAssetInterestId } from "@magna-carta/identifiers/types";
import { readMatterAsset } from "./asset-statements.ts";
import {
  endMatterAssetInterestStatement,
  insertMatterAssetInterestStatement,
  readMatterAssetInterest,
} from "./interest-statements.ts";
import { assertMatterAssetInterestRole, readMatterAssetInterestRoleCatalog } from "./settings.ts";
import type { MatterAssetServiceOptions } from "./valuation-service.ts";
import { MatterAssetValidationError, assertCivilDate, assertShare } from "./validation.ts";

// Who holds an interest in the asset. Optional by design — an asset with no recorded interest is
// simply an asset of the matter, which is the common case for an estate where everything is the
// decedent's. Interests are for the exceptions: the jointly held house, the part-owned business, the
// account with a named beneficiary.
//
// NOTHING HERE DERIVES A LEGAL CONCLUSION. An interest label does not decide an asset's estate
// treatment, and an estate treatment does not imply an interest label: whether a jointly held house
// passes outside probate turns on the form of co-ownership, which is jurisdiction-specific, and the
// register records what the firm concluded rather than concluding it.

export interface AddMatterAssetInterestInput {
  readonly assetId: MatterAssetId;
  // A directoryPerson_/directoryOrganization_ handle, carried by value.
  readonly entityId: string;
  readonly interestRole?: string | null;
  // A rational number and never a decimal: one third is not representable as one, and three siblings
  // whose shares do not sum to the whole on a court filing is a defect the schema makes impossible.
  readonly shareNumerator?: number | null;
  readonly shareDenominator?: number | null;
  readonly effectiveFrom: string;
}

export async function addMatterAssetInterest(
  database: SqlDatabase,
  input: AddMatterAssetInterestInput,
  options: MatterAssetServiceOptions,
): Promise<{ interestId: MatterAssetInterestId; effect: EffectWrite }> {
  assertCivilDate(input.effectiveFrom, "effectiveFrom");
  assertShare(input.shareNumerator, input.shareDenominator);
  const asset = await readMatterAsset(database, input.assetId);
  if (asset === undefined) {
    throw new MatterAssetValidationError(
      "matter-asset-unknown-asset",
      "no such asset in this firm",
    );
  }
  const catalog = await readMatterAssetInterestRoleCatalog(database);
  assertMatterAssetInterestRole(input.interestRole, catalog);

  const now = options.clock.now();
  const interestId = newIdentifier("matterAssetInterest", options.randomSource);
  return {
    interestId,
    effect: {
      statements: [
        insertMatterAssetInterestStatement(database, {
          id: interestId,
          assetId: input.assetId,
          entityId: input.entityId,
          interestRole: input.interestRole ?? null,
          shareNumerator: input.shareNumerator ?? null,
          shareDenominator: input.shareDenominator ?? null,
          effectiveFrom: input.effectiveFrom,
          now,
        }),
        // Identifiers only. Never the entity's name, never the share.
        domainAuditStatement(database, {
          event: "matterAsset.interest.added",
          subjectId: interestId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { matterId: asset.matter_id, assetId: input.assetId },
        }),
      ],
      outboxMessages: [],
    },
  };
}

// Ending an interest writes a date. NO ROW DISAPPEARS: who held what, and until when, is exactly the
// question a schedule read six months later has to answer.
export async function endMatterAssetInterest(
  database: SqlDatabase,
  interestId: MatterAssetInterestId,
  effectiveTo: string,
  options: MatterAssetServiceOptions,
): Promise<{ effect: EffectWrite }> {
  assertCivilDate(effectiveTo, "effectiveTo");
  const existing = await readMatterAssetInterest(database, interestId);
  if (existing === undefined) {
    throw new MatterAssetValidationError(
      "matter-asset-unknown-asset",
      "no such interest in this firm",
    );
  }
  const asset = await readMatterAsset(database, existing.asset_id);
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        guarded(
          endMatterAssetInterestStatement(database, interestId, effectiveTo, now),
          "matter-asset-interest.end",
        ),
        domainAuditStatement(database, {
          event: "matterAsset.interest.ended",
          subjectId: interestId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { matterId: asset?.matter_id ?? null, assetId: existing.asset_id },
        }),
      ],
      outboxMessages: [],
    },
  };
}
