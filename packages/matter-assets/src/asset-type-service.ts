import {
  createClassificationTypeService,
  type ClassificationTypeServiceOptions,
} from "@magna-carta/data-access/classification-type-service";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { MatterAssetTypeId } from "@magna-carta/identifiers/types";
import {
  deactivateMatterAssetTypeStatement,
  insertMatterAssetTypeStatement,
  readMatterAssetType,
  selectMatterAssetTypeIdByCodeStatement,
  selectMatterAssetTypeIdByNameStatement,
  selectMatterAssetTypeStatement,
  setMatterAssetTypeClassStatement,
  updateMatterAssetTypeStatement,
} from "./asset-type-statements.ts";
import type { MatterAssetClass } from "./types.ts";
import { MatterAssetValidationError, type MatterAssetValidationCode } from "./validation.ts";

// The per-firm asset-type catalog under a platform class — single-family residence, condominium,
// timeshare, brokerage account, and whatever else a firm actually files. It is one instance of the
// shared classification-type shape (an (id, name, code, active) table, soft-deactivate only,
// name/code uniqueness pre-checked), so the behavior comes from
// @magna-carta/data-access/classification-type-service and this module only binds it to the
// matter_asset_type table. The one extra column — the class the type is declared under — rides a
// follow-up statement in the same effect batch.

export type MatterAssetTypeServiceOptions = ClassificationTypeServiceOptions;

const service = createClassificationTypeService({
  statements: {
    select: selectMatterAssetTypeStatement,
    selectIdByName: selectMatterAssetTypeIdByNameStatement,
    selectIdByCode: selectMatterAssetTypeIdByCodeStatement,
    insert: insertMatterAssetTypeStatement,
    update: updateMatterAssetTypeStatement,
    deactivate: deactivateMatterAssetTypeStatement,
  },
  idEntityType: "matterAssetType",
  eventPrefix: "matterAssetType",
  noun: "matter asset type",
  errorCodes: {
    emptyName: "matter-asset-empty-type-name",
    nameTaken: "matter-asset-type-name-taken",
    codeTaken: "matter-asset-type-code-taken",
    unknown: "matter-asset-unknown-asset-type",
  },
  makeValidationError: (code, message) =>
    new MatterAssetValidationError(code as MatterAssetValidationCode, message),
});

export interface CreateMatterAssetTypeInput {
  readonly name: string;
  readonly code?: string | null;
  // The platform class this kind of thing sits under. Required, because a type with no class cannot
  // be offered on any asset — the write path checks that an asset's type belongs to its class.
  readonly assetClass: MatterAssetClass;
  readonly position?: number;
}

export async function createMatterAssetType(
  database: SqlDatabase,
  input: CreateMatterAssetTypeInput,
  options: MatterAssetTypeServiceOptions,
): Promise<{ assetTypeId: MatterAssetTypeId; effect: EffectWrite }> {
  const { id, effect } = await service.create(database, input, options);
  return {
    assetTypeId: id,
    effect: {
      statements: [
        ...effect.statements,
        setMatterAssetTypeClassStatement(
          database,
          id,
          input.assetClass,
          input.position ?? 0,
          options.clock.now(),
        ),
      ],
      outboxMessages: effect.outboxMessages,
    },
  };
}

export interface UpdateMatterAssetTypeInput {
  readonly name?: string;
  readonly code?: string | null;
  readonly position?: number;
}

// A type's NAME, code, and position are editable; its CLASS is not. An asset already carries the
// class, so moving a type between classes would break the type-class agreement on every asset
// already filed under it — silently, and only visible on the next schedule.
export async function updateMatterAssetType(
  database: SqlDatabase,
  assetTypeId: MatterAssetTypeId,
  patch: UpdateMatterAssetTypeInput,
  options: MatterAssetTypeServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const existing = await readMatterAssetType(database, assetTypeId);
  const { effect } = await service.update(database, assetTypeId, patch, options);
  if (patch.position === undefined || existing === undefined) return { effect };
  return {
    effect: {
      statements: [
        ...effect.statements,
        setMatterAssetTypeClassStatement(
          database,
          assetTypeId,
          // The class is re-asserted from the stored row, never taken from the patch: the same
          // statement carries the position, and reading the class back is what keeps a reorder from
          // becoming a class move.
          existing.class,
          patch.position,
          options.clock.now(),
        ),
      ],
      outboxMessages: effect.outboxMessages,
    },
  };
}

// A type is deactivated, never deleted: every asset already classified under it keeps its meaning.
export function deactivateMatterAssetType(
  database: SqlDatabase,
  assetTypeId: MatterAssetTypeId,
  options: MatterAssetTypeServiceOptions,
): Promise<{ effect: EffectWrite }> {
  return service.deactivate(database, assetTypeId, options);
}
