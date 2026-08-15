import { beforeEach, describe, expect, it } from "vitest";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { UserId } from "@magna-carta/identifiers/types";
import { DOCUMENT_ASSEMBLY_COMPLETED_EMISSION_POINT } from "../src/emission-points.ts";
import { recordJobCompletionNotification } from "../src/job-completion.ts";

// The row for the tab that was closed. A job coordinator has no firm-database batch to ride, so this
// write is its own — which makes the assertions here about what lands and what deliberately does
// not, rather than about a batch's contents.

type Database = ReturnType<typeof createMigratedNodeDatabase>["database"];

const NOW = "2026-08-20T16:00:00.000Z";
const REQUESTER = "user_requester000000";
const BYSTANDER = "user_bystander000000";
const MATTER = "matter_visible000000";
const ASSEMBLY = "documentAssembly_a000";

async function seedFirm(database: Database): Promise<void> {
  for (const userId of [REQUESTER, BYSTANDER]) {
    await database
      .prepare(
        "INSERT INTO member (user_id, display_name, status, opted_out_of_usage_analytics, created_at) VALUES (?1, ?2, 'active', 0, ?3)",
      )
      .bind(userId, `Member ${userId}`, NOW)
      .run();
  }
  await database
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, e_billing, created_at, updated_at) VALUES (?1, ?2, 'open', ?3, 0, ?4, ?4)",
    )
    .bind(MATTER, "Visible Matter", BYSTANDER, NOW)
    .run();
}

function announce(
  database: Database,
  overrides: {
    readonly requestedByUserId?: string | null;
    readonly terminalOutcome?: string;
    readonly succeeded?: boolean;
    readonly matterId?: string | null;
  } = {},
) {
  const succeeded = overrides.succeeded ?? true;
  return recordJobCompletionNotification({
    database,
    emissionPoint: DOCUMENT_ASSEMBLY_COMPLETED_EMISSION_POINT,
    subjectId: ASSEMBLY,
    matterId: overrides.matterId === undefined ? MATTER : overrides.matterId,
    requestedByUserId: (overrides.requestedByUserId === undefined
      ? REQUESTER
      : overrides.requestedByUserId) as UserId | null,
    terminalOutcome: overrides.terminalOutcome ?? (succeeded ? "done" : "failed"),
    payload: { documentAssemblyId: ASSEMBLY, matterId: MATTER, succeeded },
    now: NOW,
  });
}

async function rows(database: Database): Promise<
  {
    kind: string;
    dedupe_key: string;
    facts: string | null;
    recipient_user_id: string;
  }[]
> {
  const { results } = await database
    .prepare(
      "SELECT event.kind AS kind, event.dedupe_key AS dedupe_key, event.facts AS facts, recipient.recipient_user_id AS recipient_user_id " +
        "FROM notification_event AS event JOIN notification_recipient AS recipient ON recipient.notification_event_id = event.id " +
        "ORDER BY event.dedupe_key, recipient.recipient_user_id",
    )
    .all<{ kind: string; dedupe_key: string; facts: string | null; recipient_user_id: string }>();
  return results;
}

describe("a job coordinator's completion row", () => {
  let database: Database;
  beforeEach(async () => {
    database = createMigratedNodeDatabase("per-firm").database;
    await seedFirm(database);
  });

  it("reaches the member who asked, and nobody else", async () => {
    const result = await announce(database);

    expect(result.materializedEvents).toBe(1);
    const written = await rows(database);
    expect(written).toHaveLength(1);
    expect(written[0]?.kind).toBe("jobs.documentAssembly.completed");
    // The requester, NOT the matter's responsible member. A job notification is a reply to a
    // request, which is the one case in this registry where reaching one person is the point.
    expect(written[0]?.recipient_user_id).toBe(REQUESTER);
    expect(written[0]?.facts).toBe('{"succeeded":true}');
  });

  it("writes nothing when the coordinator recorded nobody", async () => {
    // A system-triggered job has no reply to send. Writing a row nobody asked for would put it in
    // somebody's feed on the strength of a guess.
    const result = await announce(database, { requestedByUserId: null });
    expect(result.materializedEvents).toBe(0);
    expect(await rows(database)).toHaveLength(0);
  });

  it("is a no-op when the same terminal report arrives twice", async () => {
    await announce(database);
    await announce(database);
    expect(await rows(database)).toHaveLength(1);
  });

  it("records a later, truer terminal report rather than refusing it as a duplicate", async () => {
    // The timed-out-then-succeeded path. Both reports happened; keying on the job alone would leave
    // the timeout's row standing and tell the member their document failed while it sits filed.
    await announce(database, { succeeded: false });
    await announce(database, { succeeded: true });

    const written = await rows(database);
    expect(written.map((row) => row.dedupe_key)).toEqual([
      `jobs.documentAssembly.completed:${ASSEMBLY}:done`,
      `jobs.documentAssembly.completed:${ASSEMBLY}:failed`,
    ]);
    expect(written.map((row) => row.facts).sort()).toEqual([
      '{"succeeded":false}',
      '{"succeeded":true}',
    ]);
  });

  it("writes nothing for an anchored kind with no matter to anchor to", async () => {
    // The wall is a join on that column, so an anchored row without one is not unfiltered, it is
    // unfilterable.
    const result = await announce(database, { matterId: null });
    expect(result.materializedEvents).toBe(0);
    expect(await rows(database)).toHaveLength(0);
  });

  it("writes nothing for an emission point no type claims", async () => {
    const result = await recordJobCompletionNotification({
      database,
      emissionPoint: "jobs.somethingElse.completed",
      subjectId: ASSEMBLY,
      matterId: MATTER,
      requestedByUserId: REQUESTER as UserId,
      terminalOutcome: "done",
      payload: {},
      now: NOW,
    });
    expect(result.materializedEvents).toBe(0);
  });
});
