import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { MatterEventTypeId } from "@magna-carta/identifiers/types";
import type { CalendarServiceOptions } from "./event-service.ts";
import {
  deactivateMatterEventTypeStatement,
  insertMatterEventTypeStatement,
  readMatterEventType,
  selectMatterEventTypeIdByCodeStatement,
  selectMatterEventTypeIdByNameStatement,
  updateMatterEventTypeStatement,
} from "./event-type-statements.ts";
import type { MatterEventCategory } from "./types.ts";
import { CalendarValidationError, assertNonEmptyTitle } from "./validation.ts";

// The firm's event-type catalog. It is NOT built on the shared classification-type service, because
// this catalog carries a rule that shape has no room for: a PLATFORM row's name and code are the
// shared vocabulary and a firm may not redefine them under everybody else. A firm deactivates a
// platform type it does not use; it never changes what "Hearing" means.

async function refuseNameCollision(
  database: SqlDatabase,
  name: string,
  selfId: MatterEventTypeId | null,
): Promise<void> {
  const { results } = await selectMatterEventTypeIdByNameStatement(database, name).all<{
    id: MatterEventTypeId;
  }>();
  const existing = results[0];
  if (existing !== undefined && existing.id !== selfId) {
    throw new CalendarValidationError(
      "calendar-event-type-name-taken",
      `an event type named ${JSON.stringify(name)} already exists`,
    );
  }
}

async function refuseCodeCollision(
  database: SqlDatabase,
  code: string | null,
  selfId: MatterEventTypeId | null,
): Promise<void> {
  if (code === null) return;
  const { results } = await selectMatterEventTypeIdByCodeStatement(database, code).all<{
    id: MatterEventTypeId;
  }>();
  const existing = results[0];
  if (existing !== undefined && existing.id !== selfId) {
    throw new CalendarValidationError(
      "calendar-event-type-code-taken",
      `an event type with the code ${JSON.stringify(code)} already exists`,
    );
  }
}

export interface CreateMatterEventTypeInput {
  readonly name: string;
  readonly code?: string | null;
  readonly category?: MatterEventCategory;
}

export async function createMatterEventType(
  database: SqlDatabase,
  input: CreateMatterEventTypeInput,
  options: CalendarServiceOptions,
): Promise<{ eventTypeId: MatterEventTypeId; effect: EffectWrite }> {
  assertNonEmptyTitle(input.name);
  const code = input.code ?? null;
  await refuseNameCollision(database, input.name, null);
  await refuseCodeCollision(database, code, null);
  const eventTypeId = newIdentifier("matterEventType", options.randomSource);
  const now = options.clock.now();
  return {
    eventTypeId,
    effect: {
      statements: [
        insertMatterEventTypeStatement(database, {
          id: eventTypeId,
          name: input.name,
          code,
          category: input.category ?? "litigation",
          createdAt: now,
        }),
        domainAuditStatement(database, {
          event: "calendar.eventType.created",
          subjectId: eventTypeId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
        }),
      ],
      outboxMessages: [],
    },
  };
}

export interface UpdateMatterEventTypeInput {
  readonly name?: string;
  readonly code?: string | null;
  readonly category?: MatterEventCategory;
}

export async function updateMatterEventType(
  database: SqlDatabase,
  eventTypeId: MatterEventTypeId,
  patch: UpdateMatterEventTypeInput,
  options: CalendarServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const existing = await readMatterEventType(database, eventTypeId);
  if (existing === undefined) {
    throw new CalendarValidationError(
      "calendar-unknown-event-type",
      "no such event type in this firm",
    );
  }
  const name = patch.name ?? existing.name;
  const code = patch.code === undefined ? existing.code : patch.code;
  if (existing.origin === "platform" && (name !== existing.name || code !== existing.code)) {
    throw new CalendarValidationError(
      "calendar-platform-type-immutable",
      "a platform event type's name and code are the shared vocabulary and cannot be redefined; deactivate it instead",
    );
  }
  assertNonEmptyTitle(name);
  await refuseNameCollision(database, name, eventTypeId);
  await refuseCodeCollision(database, code, eventTypeId);
  return {
    effect: {
      statements: [
        updateMatterEventTypeStatement(
          database,
          eventTypeId,
          { name, code, category: patch.category ?? existing.category },
          options.clock.now(),
        ),
        domainAuditStatement(database, {
          event: "calendar.eventType.updated",
          subjectId: eventTypeId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
        }),
      ],
      outboxMessages: [],
    },
  };
}

// Deactivation is permitted on ANY row, platform included: a firm whose practice never sees an
// arbitration should not have to look at one, and nothing already classified loses its meaning.
export async function deactivateMatterEventType(
  database: SqlDatabase,
  eventTypeId: MatterEventTypeId,
  options: CalendarServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const existing = await readMatterEventType(database, eventTypeId);
  if (existing === undefined) {
    throw new CalendarValidationError(
      "calendar-unknown-event-type",
      "no such event type in this firm",
    );
  }
  return {
    effect: {
      statements: [
        deactivateMatterEventTypeStatement(database, eventTypeId, options.clock.now()),
        domainAuditStatement(database, {
          event: "calendar.eventType.deactivated",
          subjectId: eventTypeId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
        }),
      ],
      outboxMessages: [],
    },
  };
}
