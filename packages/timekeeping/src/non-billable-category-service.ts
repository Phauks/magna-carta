import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { NonBillableCategoryId } from "@magna-carta/identifiers/types";
import type { TimekeepingServiceOptions } from "./time-entry-service.ts";
import { TimeEntryValidationError } from "./time-entry-validation.ts";
import {
  archiveNonBillableCategoryStatement,
  insertNonBillableCategoryStatement,
  renameNonBillableCategoryStatement,
  selectNonBillableCategoryExistsStatement,
} from "./non-billable-category-statements.ts";

function audit(
  database: SqlDatabase,
  options: TimekeepingServiceOptions,
  event: string,
  subjectId: string,
) {
  return domainAuditStatement(database, {
    event,
    subjectId,
    actorUserId: options.actorUserId,
    clock: options.clock,
    randomSource: options.randomSource,
  });
}

function requireNonEmpty(name: string): void {
  if (name.trim().length === 0) {
    throw new TimeEntryValidationError("empty-name", "a non-billable category needs a name");
  }
}

// Pre-read the row's existence so the service refuses an unknown id without writing a misleading
// audit row for a mutation that never happened. Mirrors assertUtbmsCodeExists in utbms-service.ts.
async function assertNonBillableCategoryExists(
  database: SqlDatabase,
  id: NonBillableCategoryId,
): Promise<void> {
  const { results } = await selectNonBillableCategoryExistsStatement(database, id).all<{
    found: number;
  }>();
  if (results.length === 0) {
    throw new TimeEntryValidationError("not-found", `no such non-billable category: ${id}`);
  }
}

export async function createNonBillableCategory(
  database: SqlDatabase,
  input: { name: string },
  options: TimekeepingServiceOptions,
): Promise<{ nonBillableCategoryId: NonBillableCategoryId; effect: EffectWrite }> {
  requireNonEmpty(input.name);
  const nonBillableCategoryId = newIdentifier("nonBillableCategory", options.randomSource);
  const now = options.clock.now();
  return {
    nonBillableCategoryId,
    effect: {
      statements: [
        insertNonBillableCategoryStatement(database, {
          id: nonBillableCategoryId,
          name: input.name,
          createdAt: now,
        }),
        audit(database, options, "non_billable_category.created", nonBillableCategoryId),
      ],
      outboxMessages: [],
    },
  };
}

export async function updateNonBillableCategory(
  database: SqlDatabase,
  id: NonBillableCategoryId,
  patch: { name: string },
  options: TimekeepingServiceOptions,
): Promise<{ nonBillableCategoryId: NonBillableCategoryId; effect: EffectWrite }> {
  requireNonEmpty(patch.name);
  await assertNonBillableCategoryExists(database, id);
  return {
    nonBillableCategoryId: id,
    effect: {
      statements: [
        renameNonBillableCategoryStatement(database, id, patch.name, options.clock.now()),
        audit(database, options, "non_billable_category.updated", id),
      ],
      outboxMessages: [],
    },
  };
}

// Soft-archive only — a category with historical entries pointing at it is never hard-deleted.
export async function archiveNonBillableCategory(
  database: SqlDatabase,
  id: NonBillableCategoryId,
  options: TimekeepingServiceOptions,
): Promise<{ nonBillableCategoryId: NonBillableCategoryId; effect: EffectWrite }> {
  await assertNonBillableCategoryExists(database, id);
  return {
    nonBillableCategoryId: id,
    effect: {
      statements: [
        archiveNonBillableCategoryStatement(database, id, options.clock.now()),
        audit(database, options, "non_billable_category.archived", id),
      ],
      outboxMessages: [],
    },
  };
}
