import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { NarrativeTemplateId } from "@magna-carta/identifiers/types";
import type { TimekeepingServiceOptions } from "./time-entry-service.ts";
import { TimeEntryValidationError } from "./time-entry-validation.ts";
import {
  archiveNarrativeTemplateStatement,
  insertNarrativeTemplateStatement,
  selectNarrativeTemplateExistsStatement,
  updateNarrativeTemplateStatement,
} from "./narrative-template-statements.ts";

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

// Pre-read the row's existence so the service refuses an unknown id without writing a misleading
// audit row for a mutation that never happened. Mirrors assertUtbmsCodeExists in utbms-service.ts.
async function assertNarrativeTemplateExists(
  database: SqlDatabase,
  id: NarrativeTemplateId,
): Promise<void> {
  const { results } = await selectNarrativeTemplateExistsStatement(database, id).all<{
    found: number;
  }>();
  if (results.length === 0) {
    throw new TimeEntryValidationError("not-found", `no such narrative template: ${id}`);
  }
}

export interface CreateNarrativeTemplateInput {
  readonly narrativeTemplate: string;
  readonly utbmsTaskCodeId?: string;
  readonly defaultRateE4?: number;
}

export async function createNarrativeTemplate(
  database: SqlDatabase,
  input: CreateNarrativeTemplateInput,
  options: TimekeepingServiceOptions,
): Promise<{ narrativeTemplateId: NarrativeTemplateId; effect: EffectWrite }> {
  if (input.narrativeTemplate.trim().length === 0) {
    throw new TimeEntryValidationError("empty-name", "a narrative template needs a body");
  }
  const narrativeTemplateId = newIdentifier("narrativeTemplate", options.randomSource);
  const now = options.clock.now();
  return {
    narrativeTemplateId,
    effect: {
      statements: [
        insertNarrativeTemplateStatement(database, {
          id: narrativeTemplateId,
          utbmsTaskCodeId: input.utbmsTaskCodeId ?? null,
          narrativeTemplate: input.narrativeTemplate,
          defaultRateE4: input.defaultRateE4 ?? null,
          createdAt: now,
        }),
        audit(database, options, "narrative_template.created", narrativeTemplateId),
      ],
      outboxMessages: [],
    },
  };
}

export async function updateNarrativeTemplate(
  database: SqlDatabase,
  id: NarrativeTemplateId,
  patch: {
    narrativeTemplate?: string;
    utbmsTaskCodeId?: string | null;
    defaultRateE4?: number | null;
  },
  options: TimekeepingServiceOptions,
): Promise<{ narrativeTemplateId: NarrativeTemplateId; effect: EffectWrite }> {
  if (patch.narrativeTemplate !== undefined && patch.narrativeTemplate.trim().length === 0) {
    throw new TimeEntryValidationError("empty-name", "a narrative template needs a body");
  }
  // Refuse a patch that carries no changed fields: the statement would only bump updated_at and still
  // emit an audit row — a meaningless no-op on a legal audit trail.
  const hasFields =
    patch.narrativeTemplate !== undefined ||
    patch.utbmsTaskCodeId !== undefined ||
    patch.defaultRateE4 !== undefined;
  if (!hasFields) {
    throw new TimeEntryValidationError(
      "empty-patch",
      "update patch must contain at least one field",
    );
  }
  await assertNarrativeTemplateExists(database, id);
  return {
    narrativeTemplateId: id,
    effect: {
      statements: [
        updateNarrativeTemplateStatement(database, id, patch, options.clock.now()),
        audit(database, options, "narrative_template.updated", id),
      ],
      outboxMessages: [],
    },
  };
}

// Soft-archive only — a template is never hard-deleted so any reference from a cached entry stays
// resolvable for display.
export async function archiveNarrativeTemplate(
  database: SqlDatabase,
  id: NarrativeTemplateId,
  options: TimekeepingServiceOptions,
): Promise<{ narrativeTemplateId: NarrativeTemplateId; effect: EffectWrite }> {
  await assertNarrativeTemplateExists(database, id);
  return {
    narrativeTemplateId: id,
    effect: {
      statements: [
        archiveNarrativeTemplateStatement(database, id, options.clock.now()),
        audit(database, options, "narrative_template.archived", id),
      ],
      outboxMessages: [],
    },
  };
}
