import { civilDateOf } from "@magna-carta/civil-time/civil-date";
import { env, runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, MatterId, UserId } from "@magna-carta/identifiers/types";
import type { DocumentAssemblyJob } from "../src/assemblies/assembly-coordinator.ts";
import type { DocumentAssemblyMessage } from "../src/assemblies/assembly-types.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { runNotificationComparisonSweep } from "../src/background/scheduled.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";

// The two production paths that are not the queue, driven through the real cron entry point and the
// real Durable Object rather than through their package-level seams: the per-firm comparison pass,
// and a job coordinator reaching a terminal state.

// A zone with no daylight saving, so the assertions do not change with the month the suite runs in.
const COURT_ZONE = "America/Phoenix"; // UTC-07:00 all year
const TS = "2026-08-20T16:00:00.000Z";

// The cron entry point reads the real clock, as it must — it is the thing under test. So the fixture
// deadline's date is derived from that clock rather than written as a literal: a hard-coded date is
// a test that passes until the day the calendar catches up with it.
const OVERDUE_ON = civilDateOf(new Date(Date.now() - 3 * 86_400_000));

const RESPONSIBLE = "user_comparisonOwner0" as UserId;
const ASSIGNED = "user_comparisonTeam00" as UserId;

let firmId: FirmId;
let matterId: MatterId;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

async function eventKinds(): Promise<string[]> {
  const { results } = await firmDatabase
    .prepare("SELECT kind FROM notification_event ORDER BY dedupe_key, id")
    .all<{ kind: string }>();
  return results.map((row) => row.kind);
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = newIdentifier("firm");
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);
  await env.DB_CONTROL.prepare(
    "INSERT INTO firm (id, name, bucket_name, status, created_at) VALUES (?1, ?2, ?3, 'active', ?4)",
  )
    .bind(firmId, "Comparison Sweep Firm", "comparison-sweep-bucket", TS)
    .run();

  for (const userId of [RESPONSIBLE, ASSIGNED]) {
    await firmDatabase
      .prepare(
        "INSERT INTO member (user_id, display_name, status, opted_out_of_usage_analytics, created_at) VALUES (?1, ?2, 'active', 0, ?3)",
      )
      .bind(userId, `Member ${userId}`, TS)
      .run();
  }
  matterId = newIdentifier("matter");
  await firmDatabase
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, e_billing, created_at, updated_at) VALUES (?1, ?2, 'open', ?3, 0, ?4, ?4)",
    )
    .bind(matterId, "Comparison Matter", RESPONSIBLE, TS)
    .run();
  await firmDatabase
    .prepare(
      "INSERT INTO matter_assignment (id, matter_id, member_user_id, assignment_role, valid_from, valid_to, created_at, updated_at) VALUES (?1, ?2, ?3, 'assigned_paralegal', '2026-01-01', NULL, ?4, ?4)",
    )
    .bind(newIdentifier("matterAssignment"), matterId, ASSIGNED, TS)
    .run();
  // Three days past its date, no recorded hour: overdue by the calendar's own comparison, in every
  // zone, however the pass's own clock reads.
  await firmDatabase
    .prepare(
      "INSERT INTO matter_deadline (id, matter_id, title, due_on, due_at_time, time_zone, source, state, recorded_at, created_at, updated_at) " +
        "VALUES (?1, ?2, ?3, ?4, NULL, ?5, 'member', 'open', ?6, ?6, ?6)",
    )
    .bind(
      newIdentifier("matterDeadline"),
      matterId,
      "Response to motion",
      OVERDUE_ON,
      COURT_ZONE,
      TS,
    )
    .run();
});

describe("the comparison sweep on the cron pass", () => {
  it("materializes an overdue deadline for the whole team, once", async () => {
    const firmsSwept = await runNotificationComparisonSweep(env);
    // The pass runs over every active firm the control plane lists, so it may pick up firms other
    // suites seeded; what matters is that it reached at least this one and did not throw.
    expect(firmsSwept).toBeGreaterThanOrEqual(1);

    expect(await eventKinds()).toEqual(["deadlines.deadline.overdue"]);

    const { results } = await firmDatabase
      .prepare("SELECT recipient_user_id FROM notification_recipient ORDER BY recipient_user_id")
      .all<{ recipient_user_id: string }>();
    // Two people, and the assertion is the count: an audience that resolved to the responsible
    // member alone would satisfy "somebody was told" forever.
    expect(results.map((row) => row.recipient_user_id).sort()).toEqual(
      [ASSIGNED, RESPONSIBLE].sort(),
    );
  });

  it("writes nothing on a second pass in the same civil day", async () => {
    await runNotificationComparisonSweep(env);
    expect(await eventKinds()).toEqual(["deadlines.deadline.overdue"]);
  });
});

describe("a document assembly reaching a terminal state", () => {
  it("writes the row for the tab that was closed, addressed to whoever asked", async () => {
    const assemblyId = newIdentifier("documentAssembly");
    const requester = "user_assemblyAsked000" as UserId;
    await firmDatabase
      .prepare(
        "INSERT INTO member (user_id, display_name, status, opted_out_of_usage_analytics, created_at) VALUES (?1, ?2, 'active', 0, ?3)",
      )
      .bind(requester, "Requesting Member", TS)
      .run();

    const message: DocumentAssemblyMessage = {
      firmId,
      bucketName: "comparison-sweep-bucket",
      assemblyId,
      matterId,
      templateVersionId: newIdentifier("fileVersion"),
      folderId: null,
      requestedBy: requester,
    };
    const stub = env.DOCUMENT_ASSEMBLY_JOB.get(
      env.DOCUMENT_ASSEMBLY_JOB.idFromName(`${firmId}:${assemblyId}`),
    );
    await runInDurableObject(stub, async (instance: DocumentAssemblyJob) => {
      // start() enqueues, which the local pool accepts; the terminal transition is what is under
      // test and it is driven directly, exactly as the consumer drives it.
      await instance.start(message);
      await instance.markDone(newIdentifier("file"), newIdentifier("fileVersion"));
    });

    const { results } = await firmDatabase
      .prepare(
        "SELECT event.kind AS kind, event.subject_id AS subject_id, recipient.recipient_user_id AS recipient_user_id " +
          "FROM notification_event AS event JOIN notification_recipient AS recipient ON recipient.notification_event_id = event.id " +
          "WHERE event.kind = 'jobs.documentAssembly.completed' ORDER BY event.id, recipient.recipient_user_id",
      )
      .all<{ kind: string; subject_id: string; recipient_user_id: string }>();
    expect(results).toHaveLength(1);
    expect(results[0]?.subject_id).toBe(assemblyId);
    // The requester, not the matter's responsible member: a job notification is a reply to a request.
    expect(results[0]?.recipient_user_id).toBe(requester);
  });
});
