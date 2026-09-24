/*
 * One calendar entry, on paper.
 *
 * A setting, a deadline and a firm event each stand alone on a sheet: the facts a person carries
 * into court or pins above a desk. What reaches the paper is a closed set of stated strings — the
 * sheet takes no markup and no formatter of its own — so what a reader can print is exactly what
 * this projection says and nothing more.
 *
 * Dates and times arrive already rendered, because the locale and the reader's zone belong to the
 * surface doing the printing, not to the description of what the paper says. The description of an
 * event is prose and prints as prose, wrapping rather than clipping.
 */
import type { PrintSheetDates } from "$lib/print-sheet";
import type {
  PrintSheetDocument,
  PrintSheetField,
} from "@magna-carta/design-system/print-sheet/projection";
import {
  deadlineStateLabel,
  eventStatusLabel,
  firmEventAudienceLabel,
  type EventParticipant,
} from "./calendar-api.ts";
import { deadlineSourceLabel } from "./deadline-draft.ts";
import type { EntryRecord } from "./entry-reference.ts";
import { recurrenceSentence } from "./recurrence-sentence.ts";
import { civilDateAsUtc } from "./calendar-window.ts";
import { timeZoneLabel } from "./time-zone-options.ts";

/** Everything the sheet needs that the record itself does not carry. */
export interface EntrySheetContext extends PrintSheetDates {
  /** The matter's number, where the record has a matter and the number is known. */
  readonly matterNumber: string | null;
  /** The type's name, where the record is classified and the catalog knows it. */
  readonly typeName: string | null;
  /** The office a firm event is at, where one was chosen. */
  readonly officeName: string | null;
  /** A participant's name as the surface resolved it. */
  readonly participantName: (participant: EventParticipant) => string;
  /** A wall-clock time in its zone on a civil day, or null for all day. */
  readonly time: (time: string | null, timeZone: string, on: string) => string | null;
  /** When the sheet was taken, already stated as an instant. */
  readonly printedAt: string;
}

const ALL_DAY = "All day";
const NOT_RECORDED = "Not recorded";

function whenFields(
  startsOn: string,
  startsAtTime: string | null,
  endsOn: string | null,
  endsAtTime: string | null,
  timeZone: string,
  context: EntrySheetContext,
): PrintSheetField[] {
  const fields: PrintSheetField[] = [
    { label: "Date", value: context.date(startsOn) },
    { label: "Time", value: context.time(startsAtTime, timeZone, startsOn) ?? ALL_DAY },
  ];
  if (endsOn !== null || endsAtTime !== null) {
    fields.push({
      label: "Ends",
      value: [
        endsOn === null ? null : context.date(endsOn),
        context.time(endsAtTime, timeZone, endsOn ?? startsOn),
      ]
        .filter((part): part is string => part !== null)
        .join(", "),
    });
  }
  // The zone as it read ON THE RECORD'S DAY: its offset and its name both change with the clocks.
  fields.push({ label: "Time Zone", value: timeZoneLabel(timeZone, civilDateAsUtc(startsOn)) });
  return fields;
}

function participantFields(
  participants: readonly EventParticipant[],
  context: EntrySheetContext,
): PrintSheetField[] {
  return participants.map((participant) => ({
    label: participant.role ?? "Participant",
    value: context.participantName(participant),
  }));
}

/** What one entry's sheet says. */
export function entrySheet(record: EntryRecord, context: EntrySheetContext): PrintSheetDocument {
  const footer = `Magna Carta · printed ${context.printedAt}`;

  if (record.kind === "deadline") {
    const deadline = record.deadline;
    return {
      heading: "Deadline",
      reference: deadline.title,
      subtitle: context.matterNumber === null ? undefined : `Matter ${context.matterNumber}`,
      sections: [
        {
          id: "when",
          kind: "fields",
          fields: [
            { label: "Due", value: context.date(deadline.dueOn) },
            {
              label: "Time",
              value:
                context.time(deadline.dueAtTime, deadline.timeZone, deadline.dueOn) ??
                "End of the day",
            },
            {
              label: "Time Zone",
              value: timeZoneLabel(deadline.timeZone, civilDateAsUtc(deadline.dueOn)),
            },
          ],
        },
        {
          id: "facts",
          kind: "fields",
          fields: [
            { label: "Authority", value: deadline.authorityText ?? NOT_RECORDED },
            {
              label: "Source",
              value: deadlineSourceLabel(
                deadline.source === "court_order" ? "court_order" : "member",
              ),
            },
            {
              label: "Priority",
              value: deadline.priority === null ? "None" : String(deadline.priority),
            },
            {
              label: "State",
              value:
                deadline.overdue && deadline.state === "open"
                  ? "Open, past due"
                  : deadlineStateLabel(deadline.state),
            },
            ...(deadline.stateReason === null
              ? []
              : [{ label: "Reason", value: deadline.stateReason }]),
          ],
        },
      ],
      footer,
    };
  }

  if (record.kind === "event") {
    const event = record.event;
    return {
      heading: "Matter Event",
      reference: event.title,
      subtitle: [
        context.typeName,
        context.matterNumber === null ? null : `Matter ${context.matterNumber}`,
      ]
        .filter((part): part is string => part !== null)
        .join(" · "),
      sections: [
        {
          id: "when",
          kind: "fields",
          fields: whenFields(
            event.startsOn,
            event.startsAtTime,
            event.endsOn,
            event.endsAtTime,
            event.timeZone,
            context,
          ),
        },
        {
          id: "facts",
          kind: "fields",
          fields: [
            { label: "Location", value: event.locationText ?? NOT_RECORDED },
            { label: "Conference Link", value: event.conferenceUrl ?? NOT_RECORDED },
            { label: "Court Reference", value: event.courtReference ?? NOT_RECORDED },
            ...repeatFact(event.recurrenceRule, event.startsOn),
            { label: "Status", value: eventStatusLabel(event.status) },
            ...(event.statusReason === null
              ? []
              : [{ label: "Reason", value: event.statusReason }]),
          ],
        },
        ...(record.participants.length === 0
          ? []
          : [
              {
                id: "participants",
                kind: "fields" as const,
                title: "Participants",
                fields: participantFields(record.participants, context),
              },
            ]),
        ...(event.description === null
          ? []
          : [
              {
                id: "description",
                kind: "text" as const,
                title: "Description",
                text: event.description,
              },
            ]),
      ],
      footer,
    };
  }

  const event = record.event;
  return {
    heading: "Firm Event",
    reference: event.title,
    subtitle: context.typeName ?? undefined,
    sections: [
      {
        id: "when",
        kind: "fields",
        fields: whenFields(
          event.startsOn,
          event.startsAtTime,
          event.endsOn,
          event.endsAtTime,
          event.timeZone,
          context,
        ),
      },
      {
        id: "facts",
        kind: "fields",
        fields: [
          { label: "Audience", value: firmEventAudienceLabel(event.audience) },
          { label: "Office", value: context.officeName ?? NOT_RECORDED },
          { label: "Location", value: event.locationText ?? NOT_RECORDED },
          { label: "Conference Link", value: event.conferenceUrl ?? NOT_RECORDED },
          ...repeatFact(event.recurrenceRule, event.startsOn),
          { label: "Status", value: eventStatusLabel(event.status) },
          ...(event.statusReason === null ? [] : [{ label: "Reason", value: event.statusReason }]),
        ],
      },
      ...(event.audience === "all_members" || record.participants.length === 0
        ? []
        : [
            {
              id: "participants",
              kind: "fields" as const,
              title: "Participants",
              fields: participantFields(record.participants, context),
            },
          ]),
      ...(event.description === null
        ? []
        : [
            {
              id: "description",
              kind: "text" as const,
              title: "Description",
              text: event.description,
            },
          ]),
    ],
    footer,
  };
}

/**
 * The Repeats line, on a sheet for a setting that repeats and on no other.
 *
 * Present-or-absent rather than the "Not recorded" the neighbouring facts use, because a repeat is
 * not a blank somebody failed to fill in: almost every setting a firm records happens once, and a
 * row stating so on every printed sheet is a line nobody reads carrying no news.
 */
function repeatFact(
  recurrenceRule: string | null,
  startsOn: string,
): { label: string; value: string }[] {
  const sentence = recurrenceSentence(recurrenceRule, startsOn);
  return sentence === null ? [] : [{ label: "Repeats", value: sentence }];
}
