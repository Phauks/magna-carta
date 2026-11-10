import { describe, expect, it } from "vitest";
import { parseRecurrence } from "@magna-carta/civil-time/recurrence";
import { nextCopyDates, nextCopySentence } from "$lib/matters/task-recurrence.ts";

// The window's promise about a repeating task's next copy has to be the date the server will use,
// so these cases mirror packages/tasks/test/task-recurrence.test.ts from the reader's side.

function rule(line: string) {
  const parsed = parseRecurrence(line);
  if (parsed === null) throw new Error(line);
  return parsed;
}

describe("the next copy as the task window states it", () => {
  it("is due on the rule's next day, the start the same distance before", () => {
    expect(nextCopyDates(rule("FREQ=MONTHLY"), "2026-11-10", "2026-11-10", "2026-11-03")).toEqual({
      dueOn: "2026-12-10",
      startsOn: "2026-12-03",
    });
  });

  it("follows the series, not a due date moved for this copy only", () => {
    expect(nextCopyDates(rule("FREQ=WEEKLY"), "2026-11-10", "2026-11-12", null)?.dueOn).toBe(
      "2026-11-17",
    );
  });

  it("says when the last one is the last", () => {
    expect(
      nextCopySentence(rule("FREQ=WEEKLY;COUNT=1"), "completed", "2026-11-10", "2026-11-10", null),
    ).toBe("This is the last one.");
  });

  it("names when the next one appears in each mode", () => {
    const monthly = rule("FREQ=MONTHLY");
    expect(nextCopySentence(monthly, "completed", "2026-11-10", "2026-11-10", null)).toContain(
      "made when this one is marked complete",
    );
    expect(
      nextCopySentence(monthly, "scheduled", "2026-11-10", "2026-11-10", "2026-11-03"),
    ).toContain("whether or not this one is done");
  });
});
