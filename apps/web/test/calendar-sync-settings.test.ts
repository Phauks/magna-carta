import { describe, expect, it } from "vitest";
import {
  destinationChoices,
  destinationText,
  firmLimitColumns,
  memberSyncColumns,
  memberSyncRows,
  NOT_SYNCED,
  rulesWithChange,
  scopeLabel,
  subjectCategory,
  subjectName,
  syncingSummary,
} from "../src/lib/calendar-sync/sync-settings.ts";

const hearing = {
  subject: "matterEventType_hearing",
  kind: "eventType",
  name: "Hearing",
  category: "litigation",
  mayLeave: true,
  detail: "full",
} as const;
const closure = {
  subject: "matterEventType_closure",
  kind: "eventType",
  name: "Office closure",
  category: "firm",
  mayLeave: false,
  detail: "full",
} as const;
const deadline = {
  subject: "deadline",
  kind: "deadline",
  name: null,
  category: null,
  mayLeave: true,
  detail: "minimal",
} as const;
const hearingRule = {
  subject: hearing.subject,
  calendarRemoteId: "cal-court",
  calendarName: "Court",
  scope: "mine",
} as const;

describe("one row per event type", () => {
  it("gives every subject its own row, with the member's rule where they have one", () => {
    const rows = memberSyncRows([hearing, closure, deadline], [hearingRule]);
    expect(rows.map((row) => subjectName(row.subject))).toEqual([
      "Hearing",
      "Office closure",
      "Deadline",
    ]);
    expect(rows.map(destinationText)).toEqual(["Court", "Not Allowed by the Firm", "Not Synced"]);
  });

  it("names a category for filtering and sets nothing by it", () => {
    expect(subjectCategory(hearing)).toBe("Litigation");
    expect(subjectCategory(deadline)).toBe("Deadlines");
  });

  it("words the narrow scope for a deadline as the matters the member is responsible for", () => {
    expect(scopeLabel("eventType", "mine")).toBe("Ones I Take Part In");
    expect(scopeLabel("deadline", "mine")).toBe("On Matters I Am Responsible For");
  });
});

describe("where a rule may point", () => {
  it("offers not syncing first, then only calendars the account can write to", () => {
    const choices = destinationChoices([
      { remoteId: "cal-main", name: "Calendar", isDefault: true, canWrite: true },
      { remoteId: "cal-holidays", name: "Holidays", isDefault: false, canWrite: false },
      { remoteId: "cal-court", name: "Court", isDefault: false, canWrite: true },
    ]);
    expect(choices).toEqual([
      { value: NOT_SYNCED, label: "Not Synced" },
      { value: "cal-main", label: "Calendar (My Main One)" },
      { value: "cal-court", label: "Court" },
    ]);
  });
});

describe("the set a save sends", () => {
  it("carries every other rule along unchanged", () => {
    const deadlineRule = { ...hearingRule, subject: "deadline", calendarRemoteId: "cal-main" };
    expect(
      rulesWithChange([hearingRule, deadlineRule], hearing.subject, {
        calendarRemoteId: "cal-main",
        scope: "my_matters",
      }),
    ).toEqual([
      { subject: "deadline", calendarRemoteId: "cal-main", scope: "mine" },
      { subject: hearing.subject, calendarRemoteId: "cal-main", scope: "my_matters" },
    ]);
  });

  it("drops the rule when the member chooses not to sync", () => {
    expect(
      rulesWithChange([hearingRule], hearing.subject, {
        calendarRemoteId: NOT_SYNCED,
        scope: "mine",
      }),
    ).toEqual([]);
  });
});

describe("what the pages state", () => {
  it("counts the rules in a sentence", () => {
    expect(syncingSummary([])).toBe("Nothing is set to sync.");
    expect(syncingSummary([hearingRule])).toBe("1 event type is set to sync.");
  });

  it("offers a change column only to somebody who can make one", () => {
    expect(memberSyncColumns(false).map((column) => column.id)).not.toContain("actions");
    expect(memberSyncColumns(true).map((column) => column.id)).toContain("actions");
    expect(firmLimitColumns(false).map((column) => column.id)).not.toContain("actions");
  });
});
