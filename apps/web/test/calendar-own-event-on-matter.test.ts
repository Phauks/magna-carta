/*
 * One of the reader's own Outlook or Google events, put on a matter: what is still unanswered,
 * when the event reads as being on the reader's screen, and what the save sends.
 */
import { describe, expect, it } from "vitest";
import type { OwnAccountEvent } from "../src/lib/calendar/own-account-events.ts";
import {
  ownEventOnMatterRequest,
  ownEventShortfalls,
  ownEventSource,
  ownEventTiming,
  ownEventWhen,
} from "../src/lib/calendar/own-event-on-matter.ts";

const call: OwnAccountEvent = {
  id: "own-1",
  provider: "microsoft",
  calendarRemoteId: "cal-main",
  calendarName: "Calendar",
  title: "Call with R. Alvarez",
  location: "Phone",
  wholeDay: false,
  startsOn: null,
  endsOn: null,
  // Eleven in the morning in New York, five hours behind UTC in December.
  startsAt: "2026-12-03T16:00:00.000Z",
  endsAt: "2026-12-03T16:30:00.000Z",
};

const reader = { timeZone: "America/New_York", memberUserId: "user_reader" };

describe("an own event put on a matter", () => {
  it("asks for the matter and the type, and nothing else", () => {
    expect(
      ownEventShortfalls({ matterId: null, eventTypeId: null }).map((each) => each.field),
    ).toEqual(["matter", "type"]);
    expect(ownEventShortfalls({ matterId: "matter_1", eventTypeId: "type_1" })).toEqual([]);
    expect(ownEventOnMatterRequest(call, { matterId: "matter_1", eventTypeId: null }, reader)).toBe(
      null,
    );
  });

  it("records the event at the reader's own day and hour, with the reader on it", () => {
    expect(
      ownEventOnMatterRequest(call, { matterId: "matter_1", eventTypeId: "type_1" }, reader),
    ).toEqual({
      eventTypeId: "type_1",
      title: "Call with R. Alvarez",
      startsOn: "2026-12-03",
      startsAtTime: "11:00",
      endsOn: null,
      endsAtTime: "11:30",
      timeZone: "America/New_York",
      locationText: "Phone",
      participants: [{ participantKind: "member", memberUserId: "user_reader" }],
      fromAccountEvent: { provider: "microsoft", id: "own-1" },
    });
  });

  it("keeps a whole-day event on its civil days, whatever the reader's zone", () => {
    const trip: OwnAccountEvent = {
      ...call,
      wholeDay: true,
      startsOn: "2026-12-07",
      endsOn: "2026-12-09",
      startsAt: null,
      endsAt: null,
    };
    expect(ownEventTiming(trip, "Pacific/Auckland")).toEqual({
      startsOn: "2026-12-07",
      startsAtTime: null,
      endsOn: "2026-12-09",
      endsAtTime: null,
    });
    expect(ownEventTiming({ ...trip, endsOn: "2026-12-07" }, "UTC")?.endsOn).toBe(null);
  });

  it("gives a title to an event that has none, and a zone to a reader whose runtime names none", () => {
    const request = ownEventOnMatterRequest(
      { ...call, title: "  " },
      { matterId: "matter_1", eventTypeId: "type_1" },
      { timeZone: "", memberUserId: null },
    );
    expect(request).toMatchObject({
      title: "Untitled event",
      timeZone: "UTC",
      startsAtTime: "16:00",
      participants: [],
    });
  });

  it("says when it is and where it is from, in the reader's words", () => {
    const when = ownEventWhen(call, "America/New_York");
    expect(when).toContain("December 3, 2026");
    expect(when).toContain("11:00 AM to 11:30 AM");
    expect(ownEventSource(call)).toBe("My Outlook Calendar. Only you see this.");
    expect(ownEventSource({ ...call, provider: "google" })).toBe(
      "My Google Calendar. Only you see this.",
    );
  });
});
