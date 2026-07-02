import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { EntityType } from "@magna-carta/identifiers/registry";
import type { BrandFor } from "@magna-carta/identifiers/types";
import { domainAuditStatement } from "./audit-statements.ts";
import type { EffectWrite } from "./effect-batch.ts";
import type { SqlDatabase, SqlStatement } from "./idempotency-statements.ts";
import type { UserId } from "@magna-carta/identifiers/types";

// A classification type is per-firm configuration over a (id, name, code, active) table:
// soft-deactivate only (a type is never deleted — historical records keep their type), name/code
// uniqueness pre-checked for a named code with the table's UNIQUE indexes as backstop. There is no
// number draw, so the create/update/deactivate operations produce effects the caller commits — no
// internal retry. Matter types and document types are two instances of this shape; this factory is
// the one home for the behavior, parameterized by the table-bound statement builders, the id entity
// type, the audit event prefix, and the domain's validation-error factory + noun.

// The clock + actor the caller supplies (the service reads no clock and trusts no ambient identity);
// randomSource lets fixtures mint byte-deterministic ids.
export interface ClassificationTypeServiceOptions {
  readonly clock: { now(): string };
  readonly actorUserId: UserId | null;
  readonly randomSource?: RandomSource;
}

// The (id, name, code, active) row the select statement returns.
export interface StoredClassificationType<Id extends string> {
  readonly id: Id;
  readonly name: string;
  readonly code: string | null;
  readonly active: number;
}

// The table-bound SQL the domain package supplies — the only per-table piece, kept in each package's
// own statements module so no domain package depends on another.
export interface ClassificationTypeStatements<Id extends string> {
  select(database: SqlDatabase, id: Id): SqlStatement;
  selectIdByName(database: SqlDatabase, name: string): SqlStatement;
  selectIdByCode(database: SqlDatabase, code: string): SqlStatement;
  insert(
    database: SqlDatabase,
    row: { id: Id; name: string; code: string | null; createdAt: string },
  ): SqlStatement;
  update(
    database: SqlDatabase,
    id: Id,
    name: string,
    code: string | null,
    updatedAt: string,
  ): SqlStatement;
  deactivate(database: SqlDatabase, id: Id, updatedAt: string): SqlStatement;
}

// The four failure codes the domain raises, plus the human noun woven into the messages and the
// audit-event prefix. makeValidationError builds the domain's own error class so callers and tests
// match on the domain-specific code.
export interface ClassificationTypeConfig<T extends EntityType> {
  readonly statements: ClassificationTypeStatements<BrandFor<T>>;
  readonly idEntityType: T;
  readonly eventPrefix: string;
  readonly noun: string;
  readonly errorCodes: {
    readonly emptyName: string;
    readonly nameTaken: string;
    readonly codeTaken: string;
    readonly unknown: string;
  };
  readonly makeValidationError: (code: string, message: string) => Error;
}

export interface ClassificationTypeService<Id extends string> {
  create(
    database: SqlDatabase,
    input: { name: string; code?: string | null },
    options: ClassificationTypeServiceOptions,
  ): Promise<{ id: Id; effect: EffectWrite }>;
  update(
    database: SqlDatabase,
    id: Id,
    patch: { name?: string; code?: string | null },
    options: ClassificationTypeServiceOptions,
  ): Promise<{ effect: EffectWrite }>;
  deactivate(
    database: SqlDatabase,
    id: Id,
    options: ClassificationTypeServiceOptions,
  ): Promise<{ effect: EffectWrite }>;
  load(database: SqlDatabase, id: Id): Promise<StoredClassificationType<Id> | undefined>;
}

export function createClassificationTypeService<T extends EntityType>(
  config: ClassificationTypeConfig<T>,
): ClassificationTypeService<BrandFor<T>> {
  type Id = BrandFor<T>;
  const { statements, errorCodes, makeValidationError } = config;

  async function load(
    database: SqlDatabase,
    id: Id,
  ): Promise<StoredClassificationType<Id> | undefined> {
    const { results } = await statements.select(database, id).all<StoredClassificationType<Id>>();
    return results[0];
  }

  async function assertNameAvailable(
    database: SqlDatabase,
    name: string,
    excludeId?: Id,
  ): Promise<void> {
    const { results } = await statements.selectIdByName(database, name).all<{ id: Id }>();
    if (results.some((row) => row.id !== excludeId)) {
      throw makeValidationError(
        errorCodes.nameTaken,
        `${config.noun} name already in use: ${name}`,
      );
    }
  }

  async function assertCodeAvailable(
    database: SqlDatabase,
    code: string,
    excludeId?: Id,
  ): Promise<void> {
    const { results } = await statements.selectIdByCode(database, code).all<{ id: Id }>();
    if (results.some((row) => row.id !== excludeId)) {
      throw makeValidationError(
        errorCodes.codeTaken,
        `${config.noun} code already in use: ${code}`,
      );
    }
  }

  function auditStatement(
    database: SqlDatabase,
    options: ClassificationTypeServiceOptions,
    event: string,
    subjectId: string,
  ): SqlStatement {
    return domainAuditStatement(database, {
      event,
      subjectId,
      actorUserId: options.actorUserId,
      clock: options.clock,
      randomSource: options.randomSource,
    });
  }

  return {
    load,

    async create(database, input, options) {
      if (input.name.trim().length === 0) {
        throw makeValidationError(errorCodes.emptyName, `a ${config.noun} needs a name`);
      }
      const code = input.code ?? null;
      await assertNameAvailable(database, input.name);
      if (code !== null) await assertCodeAvailable(database, code);
      const id = newIdentifier(config.idEntityType, options.randomSource);
      return {
        id,
        effect: {
          statements: [
            statements.insert(database, {
              id,
              name: input.name,
              code,
              createdAt: options.clock.now(),
            }),
            auditStatement(database, options, `${config.eventPrefix}.created`, id),
          ],
          outboxMessages: [],
        },
      };
    },

    async update(database, id, patch, options) {
      const existing = await load(database, id);
      if (existing === undefined) {
        throw makeValidationError(errorCodes.unknown, `no such ${config.noun}: ${id}`);
      }
      const name = patch.name ?? existing.name;
      if (name.trim().length === 0) {
        throw makeValidationError(errorCodes.emptyName, `a ${config.noun} needs a name`);
      }
      const code = patch.code !== undefined ? patch.code : existing.code;
      // Exclude self so a no-op rename / re-save does not collide with the row it is updating.
      if (name !== existing.name) await assertNameAvailable(database, name, id);
      if (code !== null && code !== existing.code) {
        await assertCodeAvailable(database, code, id);
      }
      return {
        effect: {
          statements: [
            statements.update(database, id, name, code, options.clock.now()),
            auditStatement(database, options, `${config.eventPrefix}.updated`, id),
          ],
          outboxMessages: [],
        },
      };
    },

    async deactivate(database, id, options) {
      const existing = await load(database, id);
      if (existing === undefined) {
        throw makeValidationError(errorCodes.unknown, `no such ${config.noun}: ${id}`);
      }
      return {
        effect: {
          statements: [
            statements.deactivate(database, id, options.clock.now()),
            auditStatement(database, options, `${config.eventPrefix}.deactivated`, id),
          ],
          outboxMessages: [],
        },
      };
    },
  };
}
