import { newIdentifier } from "@magna-carta/identifiers/generate";
import { describe, expect, it } from "vitest";
import { assembleTaskWorkload } from "../src/productivity/task-workload.ts";
import {
  AUTHORIZER,
  RECORDER,
  reportingFixture,
  seedMatter,
  type ReportingFixture,
} from "./support.ts";

// TASKS BY PERSON. The counts are the tasks package's; the people must add up to every open task,
// and a done, cancelled or archived task is not outstanding.

const COMPUTED_AT = "2026-08-05T15:00:00.000Z";
const AT = "2026-07-01T09:00:00.000Z";

async function task(
  fixture: ReportingFixture,
  input: {
    readonly matterId: string | null;
    readonly assignee: string | null;
    readonly dueOn?: string;
    readonly state?: string;
    readonly archived?: boolean;
  },
) {
  const done = input.state === "done";
  const cancelled = input.state === "cancelled";
  await fixture.database
    .prepare(
      `INSERT INTO matter_task (id, matter_id, title, assignee_user_id, created_by, priority, due_on, time_zone, state, completed_at, completed_by, cancelled_at, cancelled_by, cancellation_reason, archived_at, archived_by, created_at, updated_at)
       VALUES (?1, ?2, 'Draft the reply', ?3, ?4, 'normal', ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)`,
    )
    .bind(
      newIdentifier("matterTask"),
      input.matterId,
      input.assignee,
      AUTHORIZER,
      input.dueOn ?? null,
      input.dueOn === undefined ? null : "America/Los_Angeles",
      input.state ?? "open",
      done ? AT : null,
      done ? AUTHORIZER : null,
      cancelled ? AT : null,
      cancelled ? AUTHORIZER : null,
      cancelled ? "No longer needed" : null,
      input.archived === true ? AT : null,
      input.archived === true ? AUTHORIZER : null,
      AT,
    )
    .run();
}

async function book() {
  const fixture = await reportingFixture();
  const alder = await seedMatter(fixture, "Alder", "entity_alder", AT);
  const washoe = await seedMatter(fixture, "Washoe", "entity_washoe", AT);
  await fixture.database
    .prepare("UPDATE matter SET location_id = ?1 WHERE id = ?2")
    .bind(fixture.locationId, washoe)
    .run();
  await task(fixture, { matterId: alder, assignee: RECORDER, dueOn: "2026-08-01" });
  await task(fixture, { matterId: alder, assignee: RECORDER, dueOn: "2026-09-01" });
  // Due today in its own zone: not past due until the day is out.
  await task(fixture, { matterId: washoe, assignee: RECORDER, dueOn: "2026-08-05" });
  await task(fixture, { matterId: washoe, assignee: AUTHORIZER });
  await task(fixture, { matterId: null, assignee: null, dueOn: "2026-07-15" });
  await task(fixture, { matterId: alder, assignee: RECORDER, dueOn: "2026-07-01", state: "done" });
  await task(fixture, { matterId: alder, assignee: RECORDER, state: "cancelled" });
  await task(fixture, {
    matterId: alder,
    assignee: AUTHORIZER,
    dueOn: "2026-07-01",
    archived: true,
  });
  return fixture;
}

describe("the tasks by person report", () => {
  it("counts each member's open tasks, the overdue and the undated, adding up to every open task", async () => {
    const fixture = await book();
    const report = await assembleTaskWorkload(
      fixture.database,
      { locationId: null },
      { computedAt: COMPUTED_AT },
    );
    const { results } = await fixture.database
      .prepare(
        "SELECT COUNT(*) AS count FROM matter_task WHERE state = 'open' AND archived_at IS NULL",
      )
      .all<{ count: number }>();

    expect(report.totals).toEqual({ openCount: 5, overdueCount: 2, undatedCount: 1 });
    expect(report.totals.openCount).toBe(results[0]?.count);
    const recorder = report.people.find((person) => person.assigneeUserId === RECORDER);
    expect(recorder).toMatchObject({ openCount: 3, overdueCount: 1, undatedCount: 0 });
    expect(report.people.at(-1)).toMatchObject({
      assigneeUserId: null,
      openCount: 1,
      overdueCount: 1,
    });
  });

  it("narrows to one office, leaving out the firm's own tasks", async () => {
    const fixture = await book();
    const report = await assembleTaskWorkload(
      fixture.database,
      { locationId: fixture.locationId },
      { computedAt: COMPUTED_AT },
    );
    expect(report.totals).toEqual({ openCount: 2, overdueCount: 0, undatedCount: 1 });
  });
});
