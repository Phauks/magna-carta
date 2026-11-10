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
import {
  foundText,
  issueKey,
  syncIssueColumns,
  whenText,
} from "../src/lib/calendar-sync/sync-issues.ts";

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

describe("a copy the member changed in Outlook", () => {
  const sent = {
    title: "Motion hearing",
    location: "Courtroom 4",
    startsOn: "2026-12-01",
    startsAtTime: "09:30",
    endsOn: "2026-12-01",
    endsAtTime: "11:00",
    timeZone: "America/Chicago",
  };
  const issue = {
    localKind: "matter_event",
    localId: "matterEvent_1",
    kind: "changed",
    sent,
    found: { ...sent, startsAtTime: "14:00", endsAtTime: "15:30" },
    detectedAt: "2026-11-10T12:00:00.000Z",
  } as const;

  it("states when each side happens, on the event's own wall clock", () => {
    expect(whenText(sent)).toContain("9:30 AM to 11:00 AM");
    expect(whenText({ ...sent, startsAtTime: null, endsAtTime: null })).not.toContain("AM");
    expect(
      whenText({ ...sent, startsAtTime: null, endsAtTime: null, endsOn: "2026-12-03" }),
    ).toContain(" to ");
  });

  it("names only what differs in Outlook", () => {
    expect(foundText(issue)).toContain("2:00 PM to 3:30 PM");
    expect(foundText(issue)).not.toContain("Titled");
    expect(
      foundText({ ...issue, found: { ...sent, title: "Hearing (moved)", location: null } }),
    ).toBe('Titled "Hearing (moved)" · No location');
    expect(foundText({ ...issue, kind: "removed", found: null })).toBe("Deleted in Outlook");
    expect(foundText({ ...issue, kind: "not_sent", found: null })).toContain("Not sent");
  });

  it("keys a row by its copy and offers its answers in a trailing column", () => {
    expect(issueKey(issue)).toBe("matter_event:matterEvent_1");
    expect(syncIssueColumns().map((column) => column.label)).toEqual([
      "Event",
      "In Magna Carta",
      "In Outlook",
      "Actions",
    ]);
  });
});
