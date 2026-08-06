import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  MatterDeadlineId,
  MatterEventId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import {
  assertMatterDeadlineOpenStatement,
  closeMatterDeadlineStatement,
  insertMatterDeadlineStatement,
  readMatterDeadline,
  satisfyMatterDeadlineStatement,
  updateMatterDeadlineStatement,
} from "./deadline-statements.ts";
import { readMatterEvent } from "./event-statements.ts";
import type { VisibleMatterPredicate } from "./visibility.ts";
import type { CalendarServiceOptions } from "./event-service.ts";
import type { MatterDeadlineSource } from "./types.ts";
import {
  CalendarValidationError,
  assertCivilDate,
  assertNonEmptyTitle,
  assertTimeZone,
  assertWallClockTime,
} from "./validation.ts";

// Recording a date the firm must act by.
//
// NOTHING IN THIS MODULE COMPUTES A DUE DATE. `dueOn` is only ever a value a person supplied. There
// is no business-day arithmetic here, no holiday calendar, no service-method offset, and no cascade
// when a trigger event moves — a deadline's trigger is a LINK to the event that started the clock
// and never an input to a calculation. A computed deadline that is wrong is worse than none, because
// it will be trusted precisely because it was computed, and the firm that would have looked the rule
// up will not.

async function assertEventOnMatter(
  database: SqlDatabase,
  eventId: MatterEventId | null | undefined,
  matterId: MatterId,
  role: string,
  visibility: VisibleMatterPredicate,
): Promise<void> {
  if (eventId === null || eventId === undefined) return;
  const event = await readMatterEvent(database, eventId, visibility);
  if (event === undefined) {
    throw new CalendarValidationError(
      "calendar-unknown-event",
      `the ${role} event is not an event in this firm`,
    );
  }
  if (event.matter_id !== matterId) {
    throw new CalendarValidationError(
      "calendar-event-matter-mismatch",
      `the ${role} event belongs to a different matter; a deadline's discharge has to be findable from the case it discharges`,
    );
  }
}

export interface CreateMatterDeadlineInput {
  readonly matterId: MatterId;
  readonly title: string;
  readonly dueOn: string;
  readonly dueAtTime?: string | null;
  readonly timeZone: string;
  readonly source?: MatterDeadlineSource;
  readonly authorityText?: string | null;
  readonly triggerEventId?: MatterEventId | null;
  readonly priority?: number | null;
}

export async function createMatterDeadline(
  database: SqlDatabase,
  input: CreateMatterDeadlineInput,
  options: CalendarServiceOptions,
): Promise<{ deadlineId: MatterDeadlineId; effect: EffectWrite }> {
  assertNonEmptyTitle(input.title);
  assertCivilDate(input.dueOn, "dueOn");
  assertWallClockTime(input.dueAtTime, "dueAtTime");
  assertTimeZone(input.timeZone);
  const source = input.source ?? "member";
  if (source === "statutory_catalog") {
    // Accepted by the schema and unreachable through the API, deliberately. The columns exist now
    // because adding them later means rebuilding the table; the refusal exists because no verified
    // jurisdiction-keyed catalog is encoded, and a row claiming a catalog authority when none was
    // consulted would be the exact false confidence the whole position guards against.
    throw new CalendarValidationError(
      "calendar-deadline-catalog-unavailable",
      "no verified deadline catalog is encoded for any jurisdiction, so a deadline cannot be sourced from one; record the date and the authority the firm relies on",
    );
  }
  await assertEventOnMatter(
    database,
    input.triggerEventId,
    input.matterId,
    "trigger",
    options.visibility,
  );
  const now = options.clock.now();
  const deadlineId = newIdentifier("matterDeadline", options.randomSource);
  return {
    deadlineId,
    effect: {
      statements: [
        insertMatterDeadlineStatement(database, {
          id: deadlineId,
          matterId: input.matterId,
          title: input.title,
          dueOn: input.dueOn,
          dueAtTime: input.dueAtTime ?? null,
          timeZone: input.timeZone,
          source,
          authorityText: input.authorityText ?? null,
          triggerEventId: input.triggerEventId ?? null,
          priority: input.priority ?? null,
          recordedAt: now,
          recordedBy: options.actorUserId,
          now,
        }),
        domainAuditStatement(database, {
          event: "calendar.deadline.created",
          subjectId: deadlineId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          // Identifiers and the closed source vocabulary only — never the title or the authority
          // note, which are the firm's words about a case.
          metadata: { matterId: input.matterId, source },
        }),
      ],
      outboxMessages: [],
    },
  };
}

export interface UpdateMatterDeadlineInput {
  readonly title?: string;
  readonly dueOn?: string;
  readonly dueAtTime?: string | null;
  readonly timeZone?: string;
  readonly authorityText?: string | null;
  readonly triggerEventId?: MatterEventId | null;
  readonly priority?: number | null;
}

export async function updateMatterDeadline(
  database: SqlDatabase,
  deadlineId: MatterDeadlineId,
  patch: UpdateMatterDeadlineInput,
  options: CalendarServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const existing = await readMatterDeadline(database, deadlineId, options.visibility);
  if (existing === undefined) {
    throw new CalendarValidationError("calendar-unknown-deadline", "no such deadline in this firm");
  }
  if (existing.state !== "open") {
    throw new CalendarValidationError(
      "calendar-deadline-not-open",
      `this deadline is ${existing.state}; a settled deadline is superseded by a new one rather than edited`,
    );
  }
  const merged = {
    title: patch.title ?? existing.title,
    dueOn: patch.dueOn ?? existing.due_on,
    dueAtTime: patch.dueAtTime === undefined ? existing.due_at_time : patch.dueAtTime,
    timeZone: patch.timeZone ?? existing.time_zone,
    authorityText:
      patch.authorityText === undefined ? existing.authority_text : patch.authorityText,
    triggerEventId:
      patch.triggerEventId === undefined ? existing.trigger_event_id : patch.triggerEventId,
    priority: patch.priority === undefined ? existing.priority : patch.priority,
  };
  assertNonEmptyTitle(merged.title);
  assertCivilDate(merged.dueOn, "dueOn");
  assertWallClockTime(merged.dueAtTime, "dueAtTime");
  assertTimeZone(merged.timeZone);
  await assertEventOnMatter(
    database,
    merged.triggerEventId,
    existing.matter_id,
    "trigger",
    options.visibility,
  );
  return {
    effect: {
      statements: [
        // First: the state the read observed, re-asserted against the row as the batch sees it. An
        // attorney satisfying this deadline in the few hundred milliseconds between the read above
        // and this write aborts the edit rather than letting it rewrite a discharged deadline.
        assertMatterDeadlineOpenStatement(database, deadlineId),
        updateMatterDeadlineStatement(database, deadlineId, merged, options.clock.now()),
        domainAuditStatement(database, {
          event: "calendar.deadline.updated",
          subjectId: deadlineId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: {
            matterId: existing.matter_id,
            dueOnBefore: existing.due_on,
            dueOnAfter: merged.dueOn,
          },
        }),
      ],
      outboxMessages: [],
    },
  };
}

export interface SatisfyMatterDeadlineInput {
  readonly satisfiedBy: UserId;
  readonly satisfyingEventId?: MatterEventId | null;
  readonly satisfactionNote?: string | null;
}

// Satisfying a deadline records WHO discharged it, WHEN, and — where the firm recorded one — the
// filing that did it. That last link is what turns "we did it" into "here is the thing we did".
export async function satisfyMatterDeadline(
  database: SqlDatabase,
  deadlineId: MatterDeadlineId,
  input: SatisfyMatterDeadlineInput,
  options: CalendarServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const existing = await readMatterDeadline(database, deadlineId, options.visibility);
  if (existing === undefined) {
    throw new CalendarValidationError("calendar-unknown-deadline", "no such deadline in this firm");
  }
  if (existing.state !== "open") {
    throw new CalendarValidationError(
      "calendar-deadline-not-open",
      `this deadline is already ${existing.state}`,
    );
  }
  await assertEventOnMatter(
    database,
    input.satisfyingEventId,
    existing.matter_id,
    "satisfying",
    options.visibility,
  );
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        satisfyMatterDeadlineStatement(
          database,
          deadlineId,
          {
            satisfiedAt: now,
            satisfiedBy: input.satisfiedBy,
            satisfyingEventId: input.satisfyingEventId ?? null,
            satisfactionNote: input.satisfactionNote ?? null,
          },
          now,
        ),
        domainAuditStatement(database, {
          event: "calendar.deadline.satisfied",
          subjectId: deadlineId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: { matterId: existing.matter_id },
        }),
      ],
      outboxMessages: [],
    },
  };
}

export interface CloseMatterDeadlineInput {
  readonly stateReason: string;
  readonly supersededByDeadlineId?: MatterDeadlineId | null;
}

// Vacating or superseding a deadline REQUIRES a reason. Not because a column is NOT NULL, but
// because a deadline that quietly stopped being in force is indistinguishable from one the firm
// forgot, and the person asking six months later has no other place to look.
export async function closeMatterDeadline(
  database: SqlDatabase,
  deadlineId: MatterDeadlineId,
  state: "vacated" | "superseded",
  input: CloseMatterDeadlineInput,
  options: CalendarServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const existing = await readMatterDeadline(database, deadlineId, options.visibility);
  if (existing === undefined) {
    throw new CalendarValidationError("calendar-unknown-deadline", "no such deadline in this firm");
  }
  if (existing.state !== "open") {
    throw new CalendarValidationError(
      "calendar-deadline-not-open",
      `this deadline is already ${existing.state}`,
    );
  }
  if (input.stateReason.trim().length === 0) {
    throw new CalendarValidationError(
      "calendar-deadline-reason-required",
      `a ${state} deadline records why it is no longer in force`,
    );
  }
  return {
    effect: {
      statements: [
        closeMatterDeadlineStatement(
          database,
          deadlineId,
          {
            state,
            stateReason: input.stateReason,
            supersededByDeadlineId:
              state === "superseded" ? (input.supersededByDeadlineId ?? null) : null,
          },
          options.clock.now(),
        ),
        domainAuditStatement(database, {
          event: `calendar.deadline.${state}`,
          subjectId: deadlineId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          // The reason is the firm's own words about a case and stays on the deadline row, which
          // inherits the matter's tenancy and access posture. It is not repeated into the audit log.
          metadata: { matterId: existing.matter_id },
        }),
      ],
      outboxMessages: [],
    },
  };
}
