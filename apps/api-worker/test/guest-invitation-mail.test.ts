// THE MAIL A MEETING GUEST RECEIVES, and the instant a link's life is measured from. The mail says who,
// what and when, and carries the link twice — once as an address, once as a code to type — and says
// nothing about the matter behind the meeting.
import { describe, expect, it } from "vitest";
import {
  eventEndInstant,
  guestArrivalLink,
  guestInvitationEmail,
} from "../src/meetings/guest-invitation-mail.ts";

const EVENT = {
  title: "Settlement conference",
  startsOn: "2026-10-05",
  endsOn: null,
  startsAtTime: "09:30",
  endsAtTime: "10:30",
  timeZone: "America/Los_Angeles",
} as const;

const TOKEN = "eyJmaXJtSWQiOiJmaXJtXzEifQ.c2lnbmF0dXJl";

describe("the invitation mail", () => {
  const mail = guestInvitationEmail({
    firmName: "Hollis & Park LLP",
    event: EVENT,
    origin: "https://app.example.test",
    token: TOKEN,
  });

  it("names the firm and the meeting in the subject", () => {
    expect(mail.subject).toBe(
      "Hollis & Park LLP has invited you to a meeting: Settlement conference",
    );
  });

  it("writes the start in the event's own zone, labelled with that zone", () => {
    // The platform's formatters put a narrow no-break space before the day period on current
    // runtimes, so the separator is matched as whitespace rather than spelled.
    expect(mail.text).toMatch(/Oct 5, 2026 at 9:30\sAM PDT \(America\/Los_Angeles\)/);
  });

  it("falls back to the wall clock the event records for a zone the runtime cannot resolve", () => {
    const unresolvable = guestInvitationEmail({
      firmName: "Hollis & Park LLP",
      event: { ...EVENT, timeZone: "Not/AZone" },
      origin: "https://app.example.test",
      token: TOKEN,
    });
    expect(unresolvable.text).toContain("Oct 5, 2026 at 09:30 (Not/AZone)");
  });

  it("carries the arrival link and the typed fallback", () => {
    expect(mail.text).toContain(`https://app.example.test/join/${encodeURIComponent(TOKEN)}`);
    expect(mail.text).toContain(
      `https://app.example.test/join/ followed by this code:\n\n${TOKEN}`,
    );
  });

  it("says nothing about the matter — no identifier of one, and nothing the title did not already say", () => {
    expect(mail.text).not.toMatch(/matter_|matterEvent_|firmEvent_|meeting_/);
    expect(mail.text.toLowerCase()).not.toContain("matter");
  });

  it("says an all-day event is all day", () => {
    const allDay = guestInvitationEmail({
      firmName: "Hollis & Park LLP",
      event: { ...EVENT, startsAtTime: null, endsAtTime: null },
      origin: "https://app.example.test",
      token: TOKEN,
    });
    expect(allDay.text).toContain("Oct 5, 2026 (all day, America/Los_Angeles)");
  });

  it("stands in for a firm with no name rather than leaving a gap", () => {
    const unnamed = guestInvitationEmail({
      firmName: "",
      event: EVENT,
      origin: "https://app.example.test",
      token: TOKEN,
    });
    expect(unnamed.subject.startsWith("A firm has invited you")).toBe(true);
  });

  it("escapes the token in the address", () => {
    expect(guestArrivalLink("https://app.example.test", "a/b+c")).toBe(
      "https://app.example.test/join/a%2Fb%2Bc",
    );
  });
});

describe("when an event ends — what a link's life is measured from", () => {
  it("is the end time on the event's own day in the event's own zone", () => {
    // 10:30 on October 5 in Los Angeles is 17:30 UTC, daylight time.
    expect(eventEndInstant(EVENT)).toBe("2026-10-05T17:30:00.000Z");
  });

  it("is the end of the event's own day in its own zone when it has no end time, never midnight UTC", () => {
    const honolulu = eventEndInstant({
      ...EVENT,
      startsAtTime: null,
      endsAtTime: null,
      timeZone: "Pacific/Honolulu",
    });
    // The Honolulu day ends ten hours after UTC's does.
    expect(Date.parse(honolulu)).toBeGreaterThan(Date.parse("2026-10-06T00:00:00.000Z"));
    expect(Date.parse(honolulu)).toBeLessThanOrEqual(Date.parse("2026-10-06T10:00:00.000Z"));
  });

  it("is on the last day of a multi-day event", () => {
    expect(eventEndInstant({ ...EVENT, endsOn: "2026-10-07" })).toBe("2026-10-07T17:30:00.000Z");
  });

  it("falls back to the end of the day in UTC for a zone the runtime cannot resolve", () => {
    const fallback = eventEndInstant({ ...EVENT, timeZone: "Not/AZone" });
    expect(Date.parse(fallback)).toBeGreaterThan(Date.parse("2026-10-05T23:00:00.000Z"));
    expect(Date.parse(fallback)).toBeLessThanOrEqual(Date.parse("2026-10-06T00:00:00.000Z"));
  });
});
