import {
  createClassificationTypeService,
  type ClassificationTypeServiceOptions,
} from "@magna-carta/data-access/classification-type-service";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { MatterTypeId } from "@magna-carta/identifiers/types";
import {
  deactivateMatterTypeStatement,
  insertMatterTypeStatement,
  selectMatterTypeIdByCodeStatement,
  selectMatterTypeIdByNameStatement,
  selectMatterTypeStatement,
  updateMatterTypeStatement,
} from "./matter-type-statements.ts";
import { MatterValidationError, type MatterValidationCode } from "./validation.ts";

// Matter types are per-firm configuration (the custom-fields engine that enriches them is a later
// slice). They are one instance of the shared classification-type shape (an (id, name, code, active)
// table, soft-deactivate only, name/code uniqueness pre-checked) — the behavior lives in
// @magna-carta/data-access/classification-type-service; this module binds it to the matter_type table
// and the matters validation error.

export type MatterTypeServiceOptions = ClassificationTypeServiceOptions;

const service = createClassificationTypeService({
  statements: {
    select: selectMatterTypeStatement,
    selectIdByName: selectMatterTypeIdByNameStatement,
    selectIdByCode: selectMatterTypeIdByCodeStatement,
    insert: insertMatterTypeStatement,
    update: updateMatterTypeStatement,
    deactivate: deactivateMatterTypeStatement,
  },
  idEntityType: "matterType",
  eventPrefix: "matterType",
  noun: "matter type",
  errorCodes: {
    emptyName: "empty-type-name",
    nameTaken: "type-name-taken",
    codeTaken: "type-code-taken",
    unknown: "unknown-matter-type",
  },
  makeValidationError: (code, message) =>
    new MatterValidationError(code as MatterValidationCode, message),
});

export interface CreateMatterTypeInput {
  readonly name: string;
  readonly code?: string | null;
}

export async function createMatterType(
  database: SqlDatabase,
  input: CreateMatterTypeInput,
  options: MatterTypeServiceOptions,
): Promise<{ matterTypeId: MatterTypeId; effect: EffectWrite }> {
  const { id, effect } = await service.create(database, input, options);
  return { matterTypeId: id, effect };
}

export interface UpdateMatterTypeInput {
  readonly name?: string;
  readonly code?: string | null;
}

export function updateMatterType(
  database: SqlDatabase,
  matterTypeId: MatterTypeId,
  patch: UpdateMatterTypeInput,
  options: MatterTypeServiceOptions,
): Promise<{ effect: EffectWrite }> {
  return service.update(database, matterTypeId, patch, options);
}

export function deactivateMatterType(
  database: SqlDatabase,
  matterTypeId: MatterTypeId,
  options: MatterTypeServiceOptions,
): Promise<{ effect: EffectWrite }> {
  return service.deactivate(database, matterTypeId, options);
}
