import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { MatterTypeId } from "@magna-carta/identifiers/types";
import { matterAuditStatement, type AuditContext } from "./audit.ts";
import {
  deactivateMatterTypeStatement,
  insertMatterTypeStatement,
  selectMatterTypeIdByCodeStatement,
  selectMatterTypeIdByNameStatement,
  selectMatterTypeStatement,
  updateMatterTypeStatement,
} from "./matter-type-statements.ts";
import { MatterValidationError } from "./validation.ts";

// Matter types are per-firm configuration (the custom-fields engine that enriches them is a later
// slice). create/update/deactivate produce effects the caller commits — there is no number draw, so
// no internal retry. Name/code uniqueness is pre-checked for a named code; the UNIQUE indexes back
// it up. Soft-deactivate only (a type is never deleted — historical matters keep their type).

export type MatterTypeServiceOptions = AuditContext;

interface StoredMatterType {
  readonly id: MatterTypeId;
  readonly name: string;
  readonly code: string | null;
  readonly active: number;
}

async function loadMatterType(
  database: SqlDatabase,
  id: MatterTypeId,
): Promise<StoredMatterType | undefined> {
  const { results } = await selectMatterTypeStatement(database, id).all<StoredMatterType>();
  return results[0];
}

async function assertNameAvailable(
  database: SqlDatabase,
  name: string,
  excludeId?: MatterTypeId,
): Promise<void> {
  const { results } = await selectMatterTypeIdByNameStatement(database, name).all<{
    id: MatterTypeId;
  }>();
  const taken = results.find((row) => row.id !== excludeId);
  if (taken !== undefined) {
    throw new MatterValidationError("type-name-taken", `matter type name already in use: ${name}`);
  }
}

async function assertCodeAvailable(
  database: SqlDatabase,
  code: string,
  excludeId?: MatterTypeId,
): Promise<void> {
  const { results } = await selectMatterTypeIdByCodeStatement(database, code).all<{
    id: MatterTypeId;
  }>();
  const taken = results.find((row) => row.id !== excludeId);
  if (taken !== undefined) {
    throw new MatterValidationError("type-code-taken", `matter type code already in use: ${code}`);
  }
}

export interface CreateMatterTypeInput {
  readonly name: string;
  readonly code?: string | null;
}

export async function createMatterType(
  database: SqlDatabase,
  input: CreateMatterTypeInput,
  options: MatterTypeServiceOptions,
): Promise<{ matterTypeId: MatterTypeId; effect: EffectWrite }> {
  if (input.name.trim().length === 0) {
    throw new MatterValidationError("empty-type-name", "a matter type needs a name");
  }
  const code = input.code ?? null;
  await assertNameAvailable(database, input.name);
  if (code !== null) await assertCodeAvailable(database, code);
  const matterTypeId = newIdentifier("matterType", options.randomSource);
  return {
    matterTypeId,
    effect: {
      statements: [
        insertMatterTypeStatement(database, {
          id: matterTypeId,
          name: input.name,
          code,
          createdAt: options.clock.now(),
        }),
        matterAuditStatement(database, options, "matterType.created", matterTypeId),
      ],
      outboxMessages: [],
    },
  };
}

export interface UpdateMatterTypeInput {
  readonly name?: string;
  readonly code?: string | null;
}

export async function updateMatterType(
  database: SqlDatabase,
  matterTypeId: MatterTypeId,
  patch: UpdateMatterTypeInput,
  options: MatterTypeServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const existing = await loadMatterType(database, matterTypeId);
  if (existing === undefined) {
    throw new MatterValidationError("unknown-matter-type", `no such matter type: ${matterTypeId}`);
  }
  const name = patch.name ?? existing.name;
  if (name.trim().length === 0) {
    throw new MatterValidationError("empty-type-name", "a matter type needs a name");
  }
  const code = patch.code !== undefined ? patch.code : existing.code;
  // Exclude self so a no-op rename / re-save does not collide with the row it is updating.
  if (name !== existing.name) await assertNameAvailable(database, name, matterTypeId);
  if (code !== null && code !== existing.code) {
    await assertCodeAvailable(database, code, matterTypeId);
  }
  return {
    effect: {
      statements: [
        updateMatterTypeStatement(database, matterTypeId, name, code, options.clock.now()),
        matterAuditStatement(database, options, "matterType.updated", matterTypeId),
      ],
      outboxMessages: [],
    },
  };
}

export async function deactivateMatterType(
  database: SqlDatabase,
  matterTypeId: MatterTypeId,
  options: MatterTypeServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const existing = await loadMatterType(database, matterTypeId);
  if (existing === undefined) {
    throw new MatterValidationError("unknown-matter-type", `no such matter type: ${matterTypeId}`);
  }
  return {
    effect: {
      statements: [
        deactivateMatterTypeStatement(database, matterTypeId, options.clock.now()),
        matterAuditStatement(database, options, "matterType.deactivated", matterTypeId),
      ],
      outboxMessages: [],
    },
  };
}
