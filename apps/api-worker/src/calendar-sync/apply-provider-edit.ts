import { assertPermission } from "@magna-carta/access-control/registry";
import { CalendarValidationError } from "@magna-carta/calendar/validation";
import { updateMatterEvent } from "@magna-carta/calendar/event-service";
import { updateFirmEvent } from "@magna-carta/calendar/firm-event-service";
import {
  changeFirmEventOccurrence,
  changeMatterEventOccurrence,
} from "@magna-carta/calendar/series-service";
import type { CalendarProvider } from "@magna-carta/calendar/sync-contract";
import type { SyncCopyReading } from "@magna-carta/calendar/sync-issue-statements";
import type { OutboundDesired } from "@magna-carta/calendar/sync-outbound";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type { FirmEventId, MatterEventId, UserId } from "@magna-carta/identifiers/types";
import { loadEffectivePermissions } from "../effective-permissions.ts";
import type { ProviderEditDecision } from "./provider-changes.ts";

// AN EDIT A MEMBER MADE TO A COPY IN THEIR OWN CALENDAR, CARRIED BACK TO THE EVENT.
//
// By the owner's ruling an edit made at the provider changes the event in the firm's calendar
// without asking. What that is allowed to mean is decided here, and it is deliberately the same
// thing the member could have done by opening the event:
//
//   - The member must hold the permission that edits the calendar. Without it the edit is not
//     applied and becomes the question it always was (put the copy back, or leave it).
//   - It is an ordinary edit through the calendar's own service, so the event's shape is validated,
//     the audit row is written with the member as the actor, and a moved setting is announced
//     exactly as it would be from the event's own window.
//   - Only what a copy can faithfully say is carried: when it happens, and its title and place
//     where the firm lets those leave. A copy sent with minimal detail has a title this platform
//     wrote, so an edit to it says nothing about the event and the copy is simply put back.
//   - A series' first day is never moved from a copy. Where a provider's series begins after a
//     drag is not something its documentation settles, so that one edit stays a question.
//
// ONE DAY OF A SERIES changed on its own is carried as that day's own change: the series keeps its
// rule and the day gets a row, which is what "this event only" does in the event's own window.
// The day may move to another date, because it is the day that moved and not the series.
//
// A deadline never reaches here, and neither does a copy that was deleted: removing something
// from your own calendar is not cancelling a hearing.

const MANAGE_CALENDAR = assertPermission("calendar:manage");

export interface ApplyProviderEditInput {
  readonly database: BatchDatabase;
  readonly memberUserId: UserId;
  // Whose calendar the edit was made in, for the audit row.
  readonly provider: CalendarProvider;
  readonly now: () => Date;
}

interface EventPatch {
  title?: string;
  locationText?: string | null;
  startsOn?: string;
  startsAtTime?: string | null;
  endsOn?: string | null;
  endsAtTime?: string | null;
}

const sameWhen = (left: SyncCopyReading, right: SyncCopyReading): boolean =>
  left.startsOn === right.startsOn &&
  left.startsAtTime === right.startsAtTime &&
  left.endsOn === right.endsOn &&
  left.endsAtTime === right.endsAtTime;

// The difference between the copy as sent and as found, as a change to the event. Undefined where
// the difference is one that must not be carried at all; an empty patch where nothing in it can be.
export function patchForProviderEdit(
  copy: OutboundDesired,
  sent: SyncCopyReading,
  found: SyncCopyReading,
  // Present when the two readings are of one day of a series and not of the series itself.
  occurrenceOn?: string,
): EventPatch | undefined {
  const patch: EventPatch = {};
  if (!sameWhen(sent, found)) {
    const series =
      occurrenceOn === undefined && copy.event.repeats !== undefined && copy.event.repeats !== null;
    if (series && (sent.startsOn !== found.startsOn || sent.endsOn !== found.endsOn)) {
      return undefined;
    }
    patch.startsOn = found.startsOn;
    patch.startsAtTime = found.startsAtTime;
    // An event that ends the day it starts stores no last day, and one whose copy ends the minute
    // it starts was sent with no end at all.
    patch.endsOn = found.endsOn === found.startsOn ? null : found.endsOn;
    patch.endsAtTime =
      found.endsAtTime !== null &&
      found.endsAtTime === found.startsAtTime &&
      found.endsOn === found.startsOn
        ? null
        : found.endsAtTime;
  }
  if (copy.detail === "full") {
    if (sent.title !== found.title && found.title !== "") patch.title = found.title;
    if (sent.location !== found.location) patch.locationText = found.location;
  }
  return patch;
}

// One applier per pass: the member's permissions are read once, and only if a copy was edited.
export function providerEditApplier(
  input: ApplyProviderEditInput,
): (
  copy: OutboundDesired,
  sent: SyncCopyReading,
  found: SyncCopyReading,
  occurrenceOn?: string,
) => Promise<ProviderEditDecision> {
  let mayManage: Promise<boolean> | undefined;
  return async (copy, sent, found, occurrenceOn) => {
    if (copy.localKind === "deadline") return "put-back";
    const patch = patchForProviderEdit(copy, sent, found, occurrenceOn);
    if (patch === undefined) return "ask";
    if (Object.keys(patch).length === 0) return "put-back";

    mayManage ??= loadEffectivePermissions(input.database, input.memberUserId).then((held) =>
      held.has(MANAGE_CALENDAR),
    );
    if (!(await mayManage)) return "ask";

    const instant = input.now().toISOString();
    const options = {
      clock: { now: () => instant },
      actorUserId: input.memberUserId,
      randomSource: cryptoRandomSource,
      visibility: visibleMatterPredicate(),
    };
    try {
      const change = { kind: "update", fields: patch } as const;
      const { effect } =
        copy.localKind === "matter_event"
          ? occurrenceOn === undefined
            ? await updateMatterEvent(input.database, copy.localId as MatterEventId, patch, options)
            : await changeMatterEventOccurrence(
                input.database,
                copy.localId as MatterEventId,
                occurrenceOn,
                "this",
                change,
                options,
              )
          : occurrenceOn === undefined
            ? await updateFirmEvent(input.database, copy.localId as FirmEventId, patch, options)
            : await changeFirmEventOccurrence(
                input.database,
                copy.localId as FirmEventId,
                occurrenceOn,
                "this",
                change,
                options,
              );
      await commitEffectBatch(
        input.database,
        {
          ...effect,
          statements: [
            ...effect.statements,
            // Beside the service's own audit row, which says what moved: this one says the change
            // was made in the member's own calendar and carried here, not typed into the event.
            domainAuditStatement(input.database, {
              event: "calendar_sync.provider_edit_applied",
              subjectId: copy.localId,
              actorUserId: input.memberUserId,
              clock: options.clock,
              metadata: {
                provider: input.provider,
                localKind: copy.localKind,
                ...(occurrenceOn === undefined ? {} : { occurrenceOn }),
              },
            }),
          ],
        },
        { now: () => instant },
      );
      return "applied";
    } catch (error) {
      // The calendar's own service refused the edit as it stands. The copy and the event still
      // differ, and the member is the one who can say which is right.
      if (error instanceof CalendarValidationError) return "ask";
      throw error;
    }
  };
}
