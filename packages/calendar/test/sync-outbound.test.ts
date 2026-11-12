import { describe, expect, it } from "vitest";
import type { SyncCandidateRow, SyncLinkRow } from "../src/sync-link-statements.ts";
import {
  agreedText,
  desiredCopies,
  planOutbound,
  providerEventFor,
  type OutboundCandidate,
} from "../src/sync-outbound.ts";

const row: SyncCandidateRow = {
  id: "matterEvent_1",
  subject: "type-hearing",
  title: "Motion to suppress",
  description: "Bring the exhibits",
  starts_on: "2026-12-01",
  starts_at_time: "09:30",
  ends_on: null,
  ends_at_time: "11:00",
  time_zone: "America/Chicago",
  location_text: "Courtroom 4",
  conference_url: "https://meet.example/abc",
  matter_number: "2026-0001",
  type_name: "Hearing",
  takes_part: 1,
  on_own_matter: 0,
  recurrence_rule: null,
  replaced_days: null,
};
const candidate: OutboundCandidate = { localKind: "matter_event", row };
const rule = { subject: "type-hearing", calendarRemoteId: "cal-1", scope: "mine" } as const;
const open = () => ({ mayLeave: true, detail: "full" }) as const;
const digestOf = (text: string) => Promise.resolve(`digest:${text}`);

function link(overrides: Partial<SyncLinkRow> = {}): SyncLinkRow {
  return {
    local_kind: "matter_event",
    local_id: "matterEvent_1",
    calendar_remote_id: "cal-1",
    transaction_id: "txn-1",
    remote_event_id: "remote-1",
    remote_version_tag: "v1",
    agreed_hash: "",
    state: "synced",
    ...overrides,
  };
}

describe("what leaves for a member's calendar", () => {
  it("carries the whole event at full detail", () => {
    expect(providerEventFor(candidate, "full")).toEqual({
      title: "Motion to suppress",
      notes: "Bring the exhibits\n\nhttps://meet.example/abc\n\nMatter 2026-0001",
      location: "Courtroom 4",
      startsOn: "2026-12-01",
      startsAtTime: "09:30",
      endsOn: null,
      endsAtTime: "11:00",
      timeZone: "America/Chicago",
    });
  });

  it("carries the type and the matter number alone at minimal detail", () => {
    expect(providerEventFor(candidate, "minimal")).toMatchObject({
      title: "Hearing (2026-0001)",
      notes: null,
      location: null,
    });
    expect(
      providerEventFor({ ...candidate, row: { ...row, matter_number: null } }, "minimal").title,
    ).toBe("Hearing");
  });

  it("sends a deadline as a whole day with its time in the title", () => {
    const deadline: OutboundCandidate = {
      localKind: "deadline",
      row: {
        ...row,
        id: "matterDeadline_1",
        subject: "deadline",
        title: "Answer due",
        starts_at_time: "17:00",
        ends_at_time: null,
      },
    };
    expect(providerEventFor(deadline, "full")).toMatchObject({
      title: "Deadline: Answer due at 17:00",
      startsAtTime: null,
      endsAtTime: null,
    });
    expect(providerEventFor(deadline, "minimal").title).toBe("Deadline (2026-0001) at 17:00");
  });

  it("wants nothing without a rule, outside the rule's scope, or past the firm's limit", () => {
    expect(desiredCopies([], open, [candidate])).toEqual([]);
    const onMatterOnly = { ...candidate, row: { ...row, takes_part: 0, on_own_matter: 1 } };
    expect(desiredCopies([rule], open, [onMatterOnly])).toEqual([]);
    expect(desiredCopies([{ ...rule, scope: "my_matters" }], open, [onMatterOnly])).toHaveLength(1);
    expect(desiredCopies([rule], () => ({ mayLeave: false, detail: "full" }), [candidate])).toEqual(
      [],
    );
  });
});

describe("the difference a pass sends", () => {
  const desired = desiredCopies([rule], open, [candidate]);
  const digest = `digest:${agreedText(desired[0] as never)}`;

  it("creates what has no link and leaves alone what agrees", async () => {
    expect((await planOutbound(desired, [], digestOf)).steps).toMatchObject([
      { action: "create", link: null },
    ]);
    expect((await planOutbound(desired, [link({ agreed_hash: digest })], digestOf)).steps).toEqual(
      [],
    );
  });

  it("updates a copy whose event changed", async () => {
    const { steps } = await planOutbound(desired, [link({ agreed_hash: "older" })], digestOf);
    expect(steps).toMatchObject([{ action: "update" }]);
  });

  it("removes a copy nothing wants, and one whose rule moved calendars", async () => {
    expect((await planOutbound([], [link()], digestOf)).steps).toMatchObject([
      { action: "remove" },
    ]);
    const moved = await planOutbound(desired, [link({ calendar_remote_id: "cal-old" })], digestOf);
    expect(moved.steps).toMatchObject([{ action: "remove" }]);
  });

  it("repeats an unanswered create, and a refused one only after the event changes", async () => {
    const pending = link({ remote_event_id: null, state: "pending", agreed_hash: digest });
    expect((await planOutbound(desired, [pending], digestOf)).steps).toMatchObject([
      { action: "create", link: { transaction_id: "txn-1" } },
    ]);
    const refused = link({ remote_event_id: null, state: "failed", agreed_hash: digest });
    expect((await planOutbound(desired, [refused], digestOf)).steps).toEqual([]);
    const changed = link({ remote_event_id: null, state: "failed", agreed_hash: "older" });
    expect((await planOutbound(desired, [changed], digestOf)).steps).toMatchObject([
      { action: "create" },
    ]);
  });

  it("takes copies back before it sends anything new", async () => {
    const stale = link({ local_id: "matterEvent_gone" });
    const { steps } = await planOutbound(desired, [stale], digestOf);
    expect(steps.map((step) => step.action)).toEqual(["remove", "create"]);
  });
});

describe("a series", () => {
  const series: OutboundCandidate = {
    localKind: "matter_event",
    row: {
      ...row,
      recurrence_rule: "FREQ=WEEKLY;COUNT=12",
      replaced_days: "2026-12-15,2026-12-08,2026-12-15",
    },
  };

  it("leaves as one event with its rule and the days it skips, sorted and once each", () => {
    expect(providerEventFor(series, "full").repeats).toEqual({
      line: "FREQ=WEEKLY;COUNT=12",
      rule: {
        frequency: "weekly",
        interval: 1,
        weekdays: [],
        monthly: "byDate",
        end: { kind: "after", count: 12 },
      },
      skippedDays: ["2026-12-08", "2026-12-15"],
    });
  });

  it("carries a rule this platform cannot read as unread, for the adapter to refuse", () => {
    const foreign = { ...series, row: { ...series.row, recurrence_rule: "FREQ=HOURLY" } };
    expect(providerEventFor(foreign, "full").repeats).toMatchObject({
      line: "FREQ=HOURLY",
      rule: null,
    });
  });

  it("is written again when its rule or a skipped day changes, and an event that happens once is not", () => {
    const text = (candidateRow: OutboundCandidate) =>
      agreedText({
        localKind: "matter_event",
        localId: "matterEvent_1",
        calendarRemoteId: "cal-1",
        detail: "full",
        event: providerEventFor(candidateRow, "full"),
      });
    expect(text(series)).not.toBe(text(candidate));
    expect(text({ ...series, row: { ...series.row, replaced_days: null } })).not.toBe(text(series));
    // The text for an event that happens once has no trace of the series fields.
    expect(text(candidate)).not.toContain("FREQ");
    expect(JSON.parse(text(candidate))).toHaveLength(9);
  });

  it("never gives a deadline a rule", () => {
    const deadline: OutboundCandidate = { localKind: "deadline", row: series.row };
    expect(providerEventFor(deadline, "full").repeats).toBeUndefined();
  });
});
