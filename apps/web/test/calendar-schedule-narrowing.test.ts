/*
 * Which of the window's entries a reader wants in front of them. The rail answers whose calendar;
 * this answers what kind, and the questions a reader would argue about — what an untouched control
 * means, what turning everything off does — are answered here without a browser.
 */
import { describe, expect, it } from "vitest";
import type { CalendarEntry, CalendarEntryKind } from "$lib/calendar/calendar-entries.ts";
import {
  heldBack,
  isNarrowed,
  narrowToKinds,
  SCHEDULE_KINDS,
  toggleKind,
} from "$lib/calendar/schedule-narrowing.ts";

function entry(id: string, kind: CalendarEntryKind): CalendarEntry {
  return {
    id,
    kind,
    recordId: id,
    date: "2026-09-15",
    label: "Thing",
    tone: "neutral",
  } as CalendarEntry;
}

const WINDOW = [
  entry("a", "event"),
  entry("b", "deadline"),
  entry("c", "firmEvent"),
  entry("d", "other"),
  entry("e", "event"),
];

const EVERY_KIND = new Set(SCHEDULE_KINDS.map((each) => each.kind));

describe("an untouched narrowing", () => {
  it("means everything, and is not a narrowing", () => {
    expect(isNarrowed(new Set())).toBe(false);
    expect(narrowToKinds(WINDOW, new Set())).toBe(WINDOW);
    expect(heldBack(WINDOW, new Set())).toBe(0);
  });

  it("is the same object, so an unnarrowed grid does no work for a control nobody used", () => {
    expect(narrowToKinds(WINDOW, new Set())).toBe(WINDOW);
    expect(narrowToKinds(WINDOW, EVERY_KIND)).toBe(WINDOW);
  });
});

describe("narrowing to a kind", () => {
  it("keeps only that kind", () => {
    const kept = narrowToKinds(WINDOW, new Set<CalendarEntryKind>(["event"]));
    expect(kept.map((each) => each.id)).toEqual(["a", "e"]);
    expect(heldBack(WINDOW, new Set<CalendarEntryKind>(["event"]))).toBe(3);
  });

  it("keeps several", () => {
    const kept = narrowToKinds(WINDOW, new Set<CalendarEntryKind>(["deadline", "firmEvent"]));
    expect(kept.map((each) => each.id)).toEqual(["b", "c"]);
  });
});

describe("the first press", () => {
  it("REMOVES the kind pressed, starting from everything", () => {
    // Pressing Deadlines on an untouched control means "not deadlines", not "only deadlines" —
    // the control shows every kind ticked, so a press unticks one.
    const after = toggleKind(new Set(), "deadline");
    expect(after.has("deadline")).toBe(false);
    expect(after.has("event")).toBe(true);
    expect(narrowToKinds(WINDOW, after).map((each) => each.id)).toEqual(["a", "c", "d", "e"]);
  });

  it("puts one back", () => {
    const off = toggleKind(new Set(), "deadline");
    expect(toggleKind(off, "deadline")).toEqual(EVERY_KIND);
  });
});

describe("turning every kind off", () => {
  it("shows the whole window rather than an empty grid", () => {
    // An empty answer to "show me nothing" is right and useless, and the one thing a calendar must
    // not do is look empty when it is not.
    let kinds = new Set<CalendarEntryKind>();
    for (const choice of SCHEDULE_KINDS) kinds = new Set(toggleKind(kinds, choice.kind));
    expect(kinds.size).toBe(0);
    expect(isNarrowed(kinds)).toBe(false);
    expect(narrowToKinds(WINDOW, kinds)).toBe(WINDOW);
  });
});
