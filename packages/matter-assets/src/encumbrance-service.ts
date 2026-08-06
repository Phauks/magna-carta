import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { MatterAssetEncumbranceId, MatterAssetId } from "@magna-carta/identifiers/types";
import { readMatterAsset } from "./asset-statements.ts";
import {
  insertMatterAssetEncumbranceStatement,
  readMatterAssetEncumbrance,
  releaseMatterAssetEncumbranceStatement,
} from "./encumbrance-statements.ts";
import type { MatterAssetServiceOptions } from "./valuation-service.ts";
import {
  MatterAssetValidationError,
  assertCivilDate,
  assertEncumbranceKind,
} from "./validation.ts";

// What is secured against an asset. Recording one, and releasing one.
//
// THERE IS NO BALANCE ARGUMENT ON EITHER CALL, and that absence is the design: a balance is a dated
// assertion on the append-only valuation history naming this encumbrance, appended through
// `appendMatterAssetValuation` like any other figure. So a charge whose balance moved has a history
// rather than a column somebody last overwrote, and the correction discipline that governs a
// property's value governs a mortgage's balance without a second implementation of anything.

export interface RecordMatterAssetEncumbranceRequest {
  readonly assetId: MatterAssetId;
  readonly kind: string;
  readonly holderEntityId?: string | null;
  readonly holderName?: string | null;
  readonly recordedReference?: string | null;
  readonly notes?: string | null;
}

export async function recordMatterAssetEncumbrance(
  database: SqlDatabase,
  request: RecordMatterAssetEncumbranceRequest,
  options: MatterAssetServiceOptions,
): Promise<{ encumbranceId: MatterAssetEncumbranceId; effect: EffectWrite }> {
  const asset = await readMatterAsset(database, request.assetId);
  if (asset === undefined) {
    throw new MatterAssetValidationError(
      "matter-asset-unknown-asset",
      "no such asset in this firm",
    );
  }
  const kind = assertEncumbranceKind(request.kind);
  const now = options.clock.now();
  const encumbranceId = newIdentifier("matterAssetEncumbrance", options.randomSource);
  return {
    encumbranceId,
    effect: {
      statements: [
        insertMatterAssetEncumbranceStatement(database, {
          id: encumbranceId,
          assetId: request.assetId,
          kind,
          holderEntityId: request.holderEntityId ?? null,
          holderName: request.holderName ?? null,
          recordedReference: request.recordedReference ?? null,
          notes: request.notes ?? null,
          createdBy: options.actorUserId,
          now,
        }),
        // Identifiers and the kind. Never the holder's name, never a reference, never an amount —
        // the audit log is not a second place a matter's content lives.
        domainAuditStatement(database, {
          event: "matterAssetEncumbrance.recorded",
          subjectId: encumbranceId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { assetId: request.assetId, matterId: asset.matter_id, kind },
        }),
      ],
      outboxMessages: [],
    },
  };
}

// Releasing writes a DATE. The row stays, its balances stay, and a schedule as of a date before the
// release still shows the charge — which is the only way "was this property clear at the date of
// death" can be answered honestly after the lien has been discharged.
export async function releaseMatterAssetEncumbrance(
  database: SqlDatabase,
  encumbranceId: MatterAssetEncumbranceId,
  releasedOn: string,
  options: MatterAssetServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const existing = await readMatterAssetEncumbrance(database, encumbranceId);
  if (existing === undefined) {
    throw new MatterAssetValidationError(
      "matter-asset-unknown-encumbrance",
      "no such encumbrance in this firm",
    );
  }
  assertCivilDate(releasedOn, "releasedOn");
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        releaseMatterAssetEncumbranceStatement(database, encumbranceId, releasedOn, now),
        domainAuditStatement(database, {
          event: "matterAssetEncumbrance.released",
          subjectId: encumbranceId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { assetId: existing.asset_id, kind: existing.kind },
        }),
      ],
      outboxMessages: [],
    },
  };
}
