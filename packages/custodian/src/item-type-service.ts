import {
  createClassificationTypeService,
  type ClassificationTypeServiceOptions,
} from "@magna-carta/data-access/classification-type-service";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { CustodyItemTypeId } from "@magna-carta/identifiers/types";
import {
  deactivateCustodyItemTypeStatement,
  insertCustodyItemTypeStatement,
  selectCustodyItemTypeIdByCodeStatement,
  selectCustodyItemTypeIdByNameStatement,
  selectCustodyItemTypeStatement,
  setCustodyItemTypeIntrinsicDefaultStatement,
  updateCustodyItemTypeStatement,
} from "./item-type-statements.ts";
import { CustodyValidationError, type CustodyValidationCode } from "./validation.ts";

// The per-firm item-type catalog — original will, codicil, deed, keys, and whatever else a firm
// holds. It is one instance of the shared classification-type shape (an (id, name, code, active)
// table, soft-deactivate only, name/code uniqueness pre-checked), so the behavior comes from
// @magna-carta/data-access/classification-type-service and this module only binds it to the
// custody_item_type table. Custodian's one extra column, the intrinsic-value default, rides a
// follow-up statement in the same effect batch.

export type CustodyItemTypeServiceOptions = ClassificationTypeServiceOptions;

const service = createClassificationTypeService({
  statements: {
    select: selectCustodyItemTypeStatement,
    selectIdByName: selectCustodyItemTypeIdByNameStatement,
    selectIdByCode: selectCustodyItemTypeIdByCodeStatement,
    insert: insertCustodyItemTypeStatement,
    update: updateCustodyItemTypeStatement,
    deactivate: deactivateCustodyItemTypeStatement,
  },
  idEntityType: "custodyItemType",
  eventPrefix: "custodyItemType",
  noun: "custody item type",
  errorCodes: {
    emptyName: "custody-empty-name",
    nameTaken: "custody-item-type-name-taken",
    codeTaken: "custody-item-type-code-taken",
    unknown: "custody-unknown-item-type",
  },
  makeValidationError: (code, message) =>
    new CustodyValidationError(code as CustodyValidationCode, message),
});

export interface CreateCustodyItemTypeInput {
  readonly name: string;
  readonly code?: string | null;
  // Seeds the intrinsic-value flag on items of this type. It is a default and never a derivation:
  // the flag the destruction path reads has to be a fact a person asserted about a specific object.
  readonly intrinsicValueDefault?: boolean;
}

export async function createCustodyItemType(
  database: SqlDatabase,
  input: CreateCustodyItemTypeInput,
  options: CustodyItemTypeServiceOptions,
): Promise<{ itemTypeId: CustodyItemTypeId; effect: EffectWrite }> {
  const { id, effect } = await service.create(database, input, options);
  if (input.intrinsicValueDefault !== true) return { itemTypeId: id, effect };
  return {
    itemTypeId: id,
    effect: {
      statements: [
        ...effect.statements,
        setCustodyItemTypeIntrinsicDefaultStatement(database, id, true, options.clock.now()),
      ],
      outboxMessages: effect.outboxMessages,
    },
  };
}

export interface UpdateCustodyItemTypeInput {
  readonly name?: string;
  readonly code?: string | null;
  readonly intrinsicValueDefault?: boolean;
}

export async function updateCustodyItemType(
  database: SqlDatabase,
  itemTypeId: CustodyItemTypeId,
  patch: UpdateCustodyItemTypeInput,
  options: CustodyItemTypeServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const { effect } = await service.update(database, itemTypeId, patch, options);
  if (patch.intrinsicValueDefault === undefined) return { effect };
  return {
    effect: {
      statements: [
        ...effect.statements,
        setCustodyItemTypeIntrinsicDefaultStatement(
          database,
          itemTypeId,
          patch.intrinsicValueDefault,
          options.clock.now(),
        ),
      ],
      outboxMessages: effect.outboxMessages,
    },
  };
}

// A type is deactivated, never deleted: every item already classified under it keeps its meaning.
export function deactivateCustodyItemType(
  database: SqlDatabase,
  itemTypeId: CustodyItemTypeId,
  options: CustodyItemTypeServiceOptions,
): Promise<{ effect: EffectWrite }> {
  return service.deactivate(database, itemTypeId, options);
}
