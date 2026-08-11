import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmResourceId, LocationId } from "@magna-carta/identifiers/types";
import type { CalendarServiceOptions } from "./event-service.ts";
import {
  insertFirmResourceStatement,
  readFirmResource,
  selectFirmResourceByNameStatement,
  updateFirmResourceStatement,
  type FirmResourceRow,
} from "./resource-statements.ts";
import type { FirmResourceKind } from "./types.ts";
import { CalendarValidationError } from "./validation.ts";

// The resource catalog's writes. Curating the room list is calendar administration exactly as
// curating the event-type catalog is, so it rides calendar:manage and no third permission.

export interface CreateFirmResourceInput {
  readonly name: string;
  readonly kind: FirmResourceKind;
  readonly locationId?: LocationId | null;
  readonly capacity?: number | null;
  readonly notes?: string | null;
}

function assertResourceShape(input: { name: string; capacity?: number | null }): void {
  if (input.name.trim().length === 0) {
    throw new CalendarValidationError("calendar-empty-title", "a resource needs a name");
  }
  if (input.capacity !== null && input.capacity !== undefined) {
    if (!Number.isInteger(input.capacity) || input.capacity < 1) {
      throw new CalendarValidationError(
        "calendar-invalid-range",
        "a capacity is a positive whole number of people, or absent where it is meaningless",
      );
    }
  }
}

async function assertNameFree(
  database: SqlDatabase,
  name: string,
  ownId: FirmResourceId | undefined,
): Promise<void> {
  const { results } = await selectFirmResourceByNameStatement(
    database,
    name,
  ).all<FirmResourceRow>();
  const holder = results[0];
  if (holder !== undefined && holder.id !== ownId) {
    // The unique index would abort the batch anyway; refusing first gives the caller a name. Two
    // rooms called the same thing are one room nobody can book on purpose.
    throw new CalendarValidationError(
      "calendar-resource-name-taken",
      `the firm already has a resource named ${name}`,
    );
  }
}

export async function createFirmResource(
  database: SqlDatabase,
  input: CreateFirmResourceInput,
  options: CalendarServiceOptions,
): Promise<{ firmResourceId: FirmResourceId; effect: EffectWrite }> {
  assertResourceShape(input);
  await assertNameFree(database, input.name, undefined);
  const now = options.clock.now();
  const firmResourceId = newIdentifier("firmResource", options.randomSource);
  return {
    firmResourceId,
    effect: {
      statements: [
        insertFirmResourceStatement(database, {
          id: firmResourceId,
          name: input.name,
          kind: input.kind,
          locationId: input.locationId ?? null,
          capacity: input.capacity ?? null,
          notes: input.notes ?? null,
          now,
        }),
        domainAuditStatement(database, {
          event: "calendar.resource.created",
          subjectId: firmResourceId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: {},
        }),
      ],
      outboxMessages: [],
    },
  };
}

export interface UpdateFirmResourceInput {
  readonly name?: string;
  readonly kind?: FirmResourceKind;
  readonly locationId?: LocationId | null;
  readonly capacity?: number | null;
  readonly notes?: string | null;
  // Soft-deactivate lives here: active: false retires the resource. Existing bookings keep
  // resolving; new ones are refused by the booking service.
  readonly active?: boolean;
}

export async function updateFirmResource(
  database: SqlDatabase,
  firmResourceId: FirmResourceId,
  patch: UpdateFirmResourceInput,
  options: CalendarServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const existing = await readFirmResource(database, firmResourceId);
  if (existing === undefined) {
    throw new CalendarValidationError("calendar-unknown-resource", "no such resource in this firm");
  }
  const merged = {
    name: patch.name ?? existing.name,
    kind: patch.kind ?? existing.kind,
    locationId: patch.locationId === undefined ? existing.location_id : patch.locationId,
    capacity: patch.capacity === undefined ? existing.capacity : patch.capacity,
    notes: patch.notes === undefined ? existing.notes : patch.notes,
    active: patch.active ?? existing.active === 1,
  };
  assertResourceShape(merged);
  if (merged.name !== existing.name) {
    await assertNameFree(database, merged.name, firmResourceId);
  }
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        updateFirmResourceStatement(database, firmResourceId, merged, now),
        domainAuditStatement(database, {
          event: "calendar.resource.updated",
          subjectId: firmResourceId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { activeBefore: existing.active === 1, activeAfter: merged.active },
        }),
      ],
      outboxMessages: [],
    },
  };
}

export type { FirmResourceRow };
