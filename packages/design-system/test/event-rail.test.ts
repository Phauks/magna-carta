/*
 * The rail's ordering rule, and the promise that its published instant vocabulary still resolves.
 *
 * The instant formatting itself is no longer the rail's — it is the platform's shared formatter, and
 * its rules (local time, never elapsed time) are asserted in formatters.test.ts. What is left here
 * is what belongs to a rail: the order events read in, and the fact that a consumer holding the
 * rail's own names for the formatter still gets the same function.
 */
import { describe, expect, it } from "vitest";
import {
  eventInstantAttribute,
  eventInstantText,
  orderedOldestFirst,
} from "../src/lib/components/event-rail/event-instant.ts";
import { formatInstant, instantAttribute } from "../src/lib/formatters/instant.ts";

// A fixed instant, written as the UTC the platform stores.
const INSTANT = "2026-08-14T20:05:00.000Z";

describe("the rail's instant vocabulary", () => {
  it("is the shared formatter under the rail's own names, not a second implementation", () => {
    expect(eventInstantText).toBe(formatInstant);
    expect(eventInstantAttribute).toBe(instantAttribute);
  });

  it("still formats and still carries the machine-readable instant", () => {
    expect(eventInstantText(INSTANT, { locale: "en-US", timeZone: "UTC" })).toContain("2026");
    expect(eventInstantAttribute(INSTANT)).toEqual(INSTANT);
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
