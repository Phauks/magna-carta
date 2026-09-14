import { describe, expect, it } from "vitest";
import {
  calendarLabel,
  describeScope,
  emptyCalendarMessage,
  isFirmSideScope,
  isMatterScope,
  scopeKey,
  whoseCalendar,
  type CalendarScope,
} from "$lib/calendar/calendar-scope.ts";

const firm: CalendarScope = { kind: "firm" };
const mine: CalendarScope = { kind: "mine", memberId: "user_me" };
const matter: CalendarScope = { kind: "matter", matterId: "matter_1" };
const resource: CalendarScope = { kind: "resource", resourceId: "firmResource_1" };

/** The roster, as the context resolves it: a name where it knows the member, the handle otherwise. */
const memberName = (userId: string): string => (userId === "user_ada" ? "Ada Lovelace" : userId);

describe("scopeKey", () => {
  it("tells one scope from another, and the same matter from a different one", () => {
    expect(scopeKey(firm)).toBe("firm");
    expect(scopeKey(mine)).toBe("mine:user_me");
    expect(scopeKey(matter)).toBe("matter:matter_1");
    expect(scopeKey(resource)).toBe("resource:firmResource_1");
    expect(scopeKey({ kind: "matter", matterId: "matter_2" })).not.toBe(scopeKey(matter));
  });
});

describe("describeScope", () => {
  it("gives each scope its own word", () => {
    expect(describeScope(firm)).toBe("Everyone");
    expect(describeScope(mine)).toBe("Mine");
    expect(describeScope(matter)).toBe("This matter");
    expect(describeScope(resource)).toBe("This resource");
  });
});

describe("which side a scope is on", () => {
  it("puts the firm and the reader's own on the firm side, and nothing else", () => {
    expect(isFirmSideScope(firm)).toBe(true);
    expect(isFirmSideScope(mine)).toBe(true);
    expect(isFirmSideScope(matter)).toBe(false);
    expect(isFirmSideScope(resource)).toBe(false);
  });

  it("names a matter scope, so a chip can drop the number it would repeat", () => {
    expect(isMatterScope(matter)).toBe(true);
    expect(isMatterScope(firm)).toBe(false);
    expect(isMatterScope(resource)).toBe(false);
  });
});

describe("whoseCalendar", () => {
  it("lets a matter and a resource name themselves, whatever the firm-side choice", () => {
    expect(whoseCalendar(matter, "mine", null, memberName)).toBe("this matter's");
    expect(whoseCalendar(resource, "member", "user_ada", memberName)).toBe("this resource's");
  });

  it("is the reader's own on a mine scope, or when Mine is chosen over the firm", () => {
    expect(whoseCalendar(mine, "everyone", null, memberName)).toBe("your");
    expect(whoseCalendar(firm, "mine", null, memberName)).toBe("your");
  });

  it("names a chosen colleague as the roster knows them, in the possessive", () => {
    expect(whoseCalendar(firm, "member", "user_ada", memberName)).toBe("Ada Lovelace's");
    expect(whoseCalendar(firm, "member", "user_new", memberName)).toBe("user_new's");
  });

  it("is the firm's for Everyone, and for a colleague choice with no colleague", () => {
    expect(whoseCalendar(firm, "everyone", null, memberName)).toBe("the firm's");
    expect(whoseCalendar(firm, "member", null, memberName)).toBe("the firm's");
  });
});

describe("calendarLabel", () => {
  it("opens the possessive as a sentence does and names the grid a calendar", () => {
    expect(calendarLabel("your")).toBe("Your calendar");
    expect(calendarLabel("the firm's")).toBe("The firm's calendar");
    expect(calendarLabel("Ada Lovelace's")).toBe("Ada Lovelace's calendar");
    expect(calendarLabel("this matter's")).toBe("This matter's calendar");
  });
});

describe("emptyCalendarMessage", () => {
  it("says nothing on a grid, which shows its own empty days", () => {
    // The owner's ruling of 2026-09-14, against "Nothing recorded in September 2026" standing over
    // a month of empty squares: a grid that is empty has already said so.
    expect(emptyCalendarMessage(firm, "the firm's", "September 2026", "month")).toBeUndefined();
    expect(emptyCalendarMessage(firm, "the firm's", "Sep 13 - 19, 2026", "week")).toBeUndefined();
    expect(emptyCalendarMessage(firm, "the firm's", "September 15, 2026", "day")).toBeUndefined();
  });

  it("says a resource has nothing booked", () => {
    expect(emptyCalendarMessage(resource, "this resource's", "September 2026", "agenda")).toBe(
      "Nothing booked in September 2026.",
    );
  });

  it("says the firm's and a matter's calendars have nothing recorded", () => {
    expect(emptyCalendarMessage(firm, "the firm's", "September 2026", "agenda")).toBe(
      "Nothing recorded in September 2026.",
    );
    expect(emptyCalendarMessage(matter, "this matter's", "Sep 2 - 15, 2026", "agenda")).toBe(
      "Nothing recorded in Sep 2 - 15, 2026.",
    );
  });

  it("says whose calendar is empty when it is a person's", () => {
    expect(emptyCalendarMessage(firm, "your", "September 2026", "agenda")).toBe(
      "Nothing on your calendar in September 2026.",
    );
    expect(emptyCalendarMessage(firm, "Ada Lovelace's", "September 2026", "agenda")).toBe(
      "Nothing on Ada Lovelace's calendar in September 2026.",
    );
  });
});
