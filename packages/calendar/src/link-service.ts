import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { CalendarEventLinkId } from "@magna-carta/identifiers/types";
import type { CalendarServiceOptions } from "./event-service.ts";
import { readMatterEvent } from "./event-statements.ts";
import { readFirmEvent } from "./firm-event-statements.ts";
import {
  deleteCalendarEventLinkStatement,
  insertCalendarEventLinkStatement,
  readCalendarEventLink,
  readRelatedLinkBetween,
  type LinkEnd,
} from "./link-statements.ts";
import { CalendarValidationError } from "./validation.ts";

// The general link routes handle 'related' links ONLY. A 'continuance_of' link is minted by the
// continuance operation and by nothing else — it is procedural history held to a chain by the
// schema, and neither created nor deleted as an annotation.

async function assertEndExists(
  database: SqlDatabase,
  end: LinkEnd,
  options: CalendarServiceOptions,
): Promise<void> {
  if ("matterEventId" in end) {
    // Through the visible-matter predicate: linking to a hearing the caller cannot see is a 404.
    const event = await readMatterEvent(database, end.matterEventId, options.visibility);
    if (event === undefined) {
      throw new CalendarValidationError("calendar-unknown-event", "no such event in this firm");
    }
    return;
  }
  const event = await readFirmEvent(database, end.firmEventId);
  if (event === undefined) {
    throw new CalendarValidationError(
      "calendar-unknown-firm-event",
      "no such firm event in this firm",
    );
  }
}

function sameEnd(first: LinkEnd, second: LinkEnd): boolean {
  const firstId = "matterEventId" in first ? first.matterEventId : first.firmEventId;
  const secondId = "matterEventId" in second ? second.matterEventId : second.firmEventId;
  return firstId === secondId;
}

export interface CreateRelatedLinkInput {
  readonly from: LinkEnd;
  readonly to: LinkEnd;
  readonly note?: string | null;
}

export async function createRelatedLink(
  database: SqlDatabase,
  input: CreateRelatedLinkInput,
  options: CalendarServiceOptions,
): Promise<{ calendarEventLinkId: CalendarEventLinkId; effect: EffectWrite }> {
  if (sameEnd(input.from, input.to)) {
    throw new CalendarValidationError(
      "calendar-duplicate-link",
      "an event does not relate to itself",
    );
  }
  await assertEndExists(database, input.from, options);
  await assertEndExists(database, input.to, options);
  // Refused in the service, not the schema: 'related' is undirected in meaning though stored
  // directed, and a schema-level uniqueness statement over both orientations is more subtle than
  // the fact deserves.
  const existing = await readRelatedLinkBetween(database, input.from, input.to);
  if (existing !== undefined) {
    throw new CalendarValidationError(
      "calendar-duplicate-link",
      "these two events are already related",
    );
  }
  const now = options.clock.now();
  const calendarEventLinkId = newIdentifier("calendarEventLink", options.randomSource);
  return {
    calendarEventLinkId,
    effect: {
      statements: [
        insertCalendarEventLinkStatement(database, {
          id: calendarEventLinkId,
          from: input.from,
          to: input.to,
          kind: "related",
          note: input.note ?? null,
          recordedBy: options.actorUserId,
          now,
        }),
        domainAuditStatement(database, {
          event: "calendar.link.created",
          subjectId: calendarEventLinkId,
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

// A true delete: a related link is an annotation, not history. A continuance link is history and is
// refused by name.
export async function deleteRelatedLink(
  database: SqlDatabase,
  calendarEventLinkId: CalendarEventLinkId,
  options: CalendarServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const existing = await readCalendarEventLink(database, calendarEventLinkId);
  if (existing === undefined) {
    throw new CalendarValidationError("calendar-unknown-link", "no such link in this firm");
  }
  if (existing.kind === "continuance_of") {
    throw new CalendarValidationError(
      "calendar-continuance-link-immutable",
      "a continuance link is the record of what was continued from what; it is never deleted",
    );
  }
  return {
    effect: {
      statements: [
        deleteCalendarEventLinkStatement(database, calendarEventLinkId),
        domainAuditStatement(database, {
          event: "calendar.link.deleted",
          subjectId: calendarEventLinkId,
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

export type { LinkEnd };
