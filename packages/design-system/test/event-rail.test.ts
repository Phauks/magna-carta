/*
 * EventRail's instant rules, which are the part of the component that can be wrong silently.
 *
 * Two of them are absolute and are asserted here rather than trusted: a timestamp renders in the
 * viewer's own local time, and it never renders as elapsed time. The rendering itself is asserted
 * against a pinned locale and zone, because otherwise the test would only be checking that the
 * machine running it agrees with itself.
 */
import { describe, expect, it } from "vitest";
import {
  eventInstantAttribute,
  eventInstantText,
  orderedOldestFirst,
} from "../src/lib/components/event-rail/event-instant.ts";

// A fixed instant, written as the UTC the platform stores.
const INSTANT = "2026-08-14T20:05:00.000Z";

describe("eventInstantText", () => {
  it("states the actual moment, with both the date and the time of day", () => {
    const text = eventInstantText(INSTANT, { locale: "en-US", timeZone: "UTC" });
    expect(text).toContain("2026");
    expect(text).toContain("Aug");
    expect(text).toContain("14");
    expect(text).toMatch(/8:05|20:05/);
  });

  it("never renders elapsed time, however recent the instant is", () => {
    const text = eventInstantText(new Date(), { locale: "en-US" });
    expect(text).not.toMatch(/just now|ago|moments|second|minute|hour/i);
    // An absolute rendering always carries the year; a relative one never does.
    expect(text).toMatch(/\d{4}/);
  });

  it("renders in the viewer's zone, not the zone the instant was stored in", () => {
    const stored = eventInstantText(INSTANT, { locale: "en-US", timeZone: "UTC" });
    const viewer = eventInstantText(INSTANT, { locale: "en-US", timeZone: "America/Los_Angeles" });
    expect(viewer).not.toEqual(stored);
    expect(viewer).toContain("1:05");
  });

  it("accepts a Date, an ISO string and epoch milliseconds as the same moment", () => {
    const options = { locale: "en-US", timeZone: "UTC" };
    const fromString = eventInstantText(INSTANT, options);
    expect(eventInstantText(new Date(INSTANT), options)).toEqual(fromString);
    expect(eventInstantText(Date.parse(INSTANT), options)).toEqual(fromString);
  });

  it("shows an unreadable value as what it actually says, rather than hiding it", () => {
    expect(eventInstantText("recorded on a Tuesday")).toEqual("recorded on a Tuesday");
  });
});

describe("eventInstantAttribute", () => {
  it("carries the machine-readable UTC instant", () => {
    expect(eventInstantAttribute(INSTANT)).toEqual(INSTANT);
  });

  it("is absent rather than wrong when the value is not an instant", () => {
    expect(eventInstantAttribute("recorded on a Tuesday")).toBeUndefined();
  });
});

describe("orderedOldestFirst", () => {
  const entered = { id: "entered", at: "2026-08-14T20:05:00.000Z" };
  const submitted = { id: "submitted", at: "2026-08-15T09:00:00.000Z" };
  const approved = { id: "approved", at: "2026-08-16T11:30:00.000Z" };

  it("puts the oldest event first", () => {
    const ordered = orderedOldestFirst([approved, entered, submitted]);
    expect(ordered.map((event) => event.id)).toEqual(["entered", "submitted", "approved"]);
  });

  it("keeps the recorded order of events sharing one instant", () => {
    const first = { id: "first", at: INSTANT };
    const second = { id: "second", at: INSTANT };
    expect(orderedOldestFirst([first, second]).map((event) => event.id)).toEqual([
      "first",
      "second",
    ]);
    expect(orderedOldestFirst([second, first]).map((event) => event.id)).toEqual([
      "second",
      "first",
    ]);
  });

  it("leaves an unreadable instant where it was recorded", () => {
    const unreadable = { id: "unreadable", at: "some time last spring" };
    expect(orderedOldestFirst([entered, unreadable, approved]).map((event) => event.id)).toEqual([
      "entered",
      "unreadable",
      "approved",
    ]);
  });

  it("does not mutate what it was given", () => {
    const events = [approved, entered];
    orderedOldestFirst(events);
    expect(events.map((event) => event.id)).toEqual(["approved", "entered"]);
  });
});
