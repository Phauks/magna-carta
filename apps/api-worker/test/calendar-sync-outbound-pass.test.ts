/*
 * One account's outbound pass, over a real firm database, with the provider played by a recorder.
 * What is pinned: nothing leaves without a rule; a rule's scope decides whose events leave; the
 * firm's limit decides how much of each; a second pass over an unchanged calendar sends nothing; an
 * edit sends one update; a cancelled event, a removed rule and a closed subject each take the copy
 * back; a create whose answer was lost is repeated under the same identifier; and a refused sign-in
 * stops the pass where it stands.
 */
import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CalendarSyncPort, ProviderEventWrite } from "@magna-carta/calendar/sync-port";
import type { FirmId, IntegrationConnectionId, UserId } from "@magna-carta/identifiers/types";
import { adapterError, ok } from "@magna-carta/integrations/dispatch";
import { integrationProblem } from "@magna-carta/integrations/problem";
import { runOutboundPass } from "../src/calendar-sync/outbound-pass.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { mirrorMemberWithRole, seedCredentialedUser, seedFirm } from "./support/test-auth.ts";

const NOW = "2026-11-10T12:00:00.000Z";
const CONNECTION = "integrationConnection_outboundpass0001" as IntegrationConnectionId;
const MATTER = "matter_outboundpass00000001";
const OTHER_MATTER = "matter_outboundpass00000002";

let firmDatabase: ReturnType<typeof firmDatabaseFor>;
let memberUserId: UserId;
let hearingTypeId: string;
let trialTypeId: string;

type Call =
  | { op: "create"; calendar: string; event: ProviderEventWrite; transactionId: string }
  | { op: "update"; remoteId: string; event: ProviderEventWrite }
  | { op: "delete"; remoteId: string };

function recorder(): { port: CalendarSyncPort; calls: Call[]; failNext: (kind: string) => void } {
  const calls: Call[] = [];
  let failing: string | null = null;
  const refusal = () => {
    const kind = failing;
    failing = null;
    if (kind === "auth") return adapterError(integrationProblem("auth", 401, "refused"));
    if (kind === "network") return adapterError(integrationProblem("network", 503, "down"));
    if (kind === "validation") return adapterError(integrationProblem("validation", 400, "bad"));
    return null;
  };
  return {
    calls,
    failNext: (kind) => {
      failing = kind;
    },
    port: {
      listCalendars: () => Promise.resolve(ok([])),
      createEvent: (calendar, event, transactionId) => {
        calls.push({ op: "create", calendar, event, transactionId });
        return Promise.resolve(
          refusal() ?? ok({ remoteId: `remote-${transactionId}`, versionTag: "v1" }),
        );
      },
      updateEvent: (remoteId, event) => {
        calls.push({ op: "update", remoteId, event });
        return Promise.resolve(refusal() ?? ok({ found: true as const, versionTag: "v2" }));
      },
      deleteEvent: (remoteId) => {
        calls.push({ op: "delete", remoteId });
        return Promise.resolve(refusal() ?? ok(null));
      },
    },
  };
}

let nextTransaction = 0;
async function pass(port: CalendarSyncPort) {
  return await runOutboundPass({
    database: firmDatabase,
    connectionId: CONNECTION,
    memberUserId,
    port,
    now: () => new Date(NOW),
    newTransactionId: () => `txn-${(nextTransaction += 1)}`,
  });
}

async function run(sql: string, ...bindings: unknown[]): Promise<void> {
  await firmDatabase
    .prepare(sql)
    .bind(...bindings)
    .run();
}

async function setRule(subject: string, calendar: string, scope: "mine" | "my_matters") {
  await run(
    "DELETE FROM calendar_sync_rule WHERE connection_id = ?1 AND subject = ?2",
    CONNECTION,
    subject,
  );
  await run(
    "INSERT INTO calendar_sync_rule (connection_id, subject, event_type_id, calendar_remote_id, calendar_name, scope, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'Calendar', ?5, ?6, ?6)",
    CONNECTION,
    subject,
    subject === "deadline" ? null : subject,
    calendar,
    scope,
    NOW,
  );
}

async function seedEvent(
  id: string,
  matterId: string,
  typeId: string,
  title: string,
  startsOn: string,
  takesPart: boolean,
): Promise<void> {
  await run(
    "INSERT INTO matter_event (id, matter_id, event_type_id, title, description, status, starts_on, starts_at_time, ends_at_time, time_zone, location_text, recorded_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'Bring the exhibits', 'scheduled', ?5, '09:30', '11:00', 'America/Chicago', 'Courtroom 4', ?6, ?6, ?6)",
    id,
    matterId,
    typeId,
    title,
    startsOn,
    NOW,
  );
  if (takesPart) {
    await run(
      "INSERT INTO matter_event_participant (id, event_id, participant_kind, member_user_id, created_at, updated_at) VALUES (?1, ?2, 'member', ?3, ?4, ?4)",
      `matterEventParticipant_${id.slice(-12)}`,
      id,
      memberUserId,
      NOW,
    );
  }
}

async function links(): Promise<
  { local_id: string; state: string; remote_event_id: string | null }[]
> {
  const { results } = await firmDatabase
    .prepare(
      "SELECT local_id, state, remote_event_id FROM calendar_sync_link WHERE connection_id = ?1 ORDER BY local_id",
    )
    .bind(CONNECTION)
    .all<{ local_id: string; state: string; remote_event_id: string | null }>();
  return results;
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  const firmId: FirmId = (await seedFirm({ name: "Outbound Pass Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);
  const member = await seedCredentialedUser("outbound-member@example.com", {
    userName: "Jane Doe",
    firmId,
  });
  await mirrorMemberWithRole(member.userId, "Jane Doe", firmId, "Attorney");
  memberUserId = member.userId as UserId;

  const { results } = await firmDatabase
    .prepare("SELECT id, name FROM matter_event_type WHERE name IN ('Hearing', 'Trial')")
    .all<{ id: string; name: string }>();
  hearingTypeId = results.find((row) => row.name === "Hearing")?.id ?? "";
  trialTypeId = results.find((row) => row.name === "Trial")?.id ?? "";

  await run(
    "INSERT INTO integration_connection (id, category, adapter_id, scope, principal_ref, credential_ref, status, capability_snapshot, created_at, updated_at) VALUES (?1, 'calendar-sync', 'microsoft-graph', 'user', ?2, 'integration:calendar-sync:x', 'connected', '{}', ?3, ?3)",
    CONNECTION,
    memberUserId,
    NOW,
  );
  for (const [id, number] of [
    [MATTER, "2026-0001"],
    [OTHER_MATTER, "2026-0002"],
  ] as const) {
    await run(
      "INSERT INTO matter (id, title, status, responsible_member_id, matter_number, created_at, updated_at) VALUES (?1, 'Doe v. Roe', 'open', ?2, ?3, ?4, ?4)",
      id,
      memberUserId,
      number,
      NOW,
    );
  }
  await run(
    "INSERT INTO matter_assignment (id, matter_id, member_user_id, assignment_role, valid_from, valid_to, created_at, updated_at) VALUES ('matterAssignment_outbound0001', ?1, ?2, 'assigned_attorney', '2026-01-01', NULL, ?3, ?3)",
    MATTER,
    memberUserId,
    NOW,
  );
});

beforeEach(async () => {
  nextTransaction = 0;
  for (const table of [
    "calendar_sync_link",
    "calendar_sync_rule",
    "calendar_sync_firm_limit",
    "matter_event_participant",
    "matter_deadline",
    "matter_event",
  ]) {
    await run(`DELETE FROM ${table}`);
  }
});

describe("one account's outbound pass", () => {
  it("sends nothing while the member has no rule", async () => {
    await seedEvent(
      "matterEvent_outbound000001",
      MATTER,
      hearingTypeId,
      "Motion hearing",
      "2026-12-01",
      true,
    );
    const provider = recorder();
    expect(await pass(provider.port)).toMatchObject({ kind: "settled" });
    expect(provider.calls).toEqual([]);
    expect(await links()).toEqual([]);
  });

  it("sends an event the member takes part in to the calendar its type's rule names", async () => {
    await seedEvent(
      "matterEvent_outbound000001",
      MATTER,
      hearingTypeId,
      "Motion hearing",
      "2026-12-01",
      true,
    );
    await seedEvent("matterEvent_outbound000002", MATTER, trialTypeId, "Trial", "2026-12-08", true);
    await setRule(hearingTypeId, "cal-court", "mine");
    const provider = recorder();
    const outcome = await pass(provider.port);
    expect(outcome).toMatchObject({ kind: "settled", report: { created: 1 } });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toMatchObject({
      op: "create",
      calendar: "cal-court",
      event: {
        title: "Motion hearing",
        location: "Courtroom 4",
        startsOn: "2026-12-01",
        startsAtTime: "09:30",
        endsAtTime: "11:00",
        timeZone: "America/Chicago",
      },
    });
    expect(provider.calls[0]?.op === "create" && provider.calls[0].event.notes).toContain(
      "Matter 2026-0001",
    );
    expect(await links()).toEqual([
      { local_id: "matterEvent_outbound000001", state: "synced", remote_event_id: "remote-txn-1" },
    ]);
  });

  it("keeps an event on the member's matter out unless the rule covers their matters", async () => {
    await seedEvent(
      "matterEvent_outbound000001",
      MATTER,
      hearingTypeId,
      "Their matter",
      "2026-12-01",
      false,
    );
    await seedEvent(
      "matterEvent_outbound000002",
      OTHER_MATTER,
      hearingTypeId,
      "Not theirs",
      "2026-12-02",
      false,
    );
    await setRule(hearingTypeId, "cal-court", "mine");
    const narrow = recorder();
    await pass(narrow.port);
    expect(narrow.calls).toEqual([]);

    await setRule(hearingTypeId, "cal-court", "my_matters");
    const wide = recorder();
    await pass(wide.port);
    expect(wide.calls.map((call) => call.op === "create" && call.event.title)).toEqual([
      "Their matter",
    ]);
  });

  it("sends only the type and the matter number where the firm allows minimal detail", async () => {
    await seedEvent(
      "matterEvent_outbound000001",
      MATTER,
      hearingTypeId,
      "Motion to suppress",
      "2026-12-01",
      true,
    );
    await setRule(hearingTypeId, "cal-court", "mine");
    await run(
      "INSERT INTO calendar_sync_firm_limit (subject, event_type_id, may_leave, detail, updated_at, updated_by) VALUES (?1, ?1, 1, 'minimal', ?2, ?3)",
      hearingTypeId,
      NOW,
      memberUserId,
    );
    const provider = recorder();
    await pass(provider.port);
    expect(provider.calls[0]).toMatchObject({
      op: "create",
      event: { title: "Hearing (2026-0001)", notes: null, location: null },
    });
  });

  it("sends nothing of a type the firm has closed, even past a rule that outlived it", async () => {
    await seedEvent(
      "matterEvent_outbound000001",
      MATTER,
      hearingTypeId,
      "Motion hearing",
      "2026-12-01",
      true,
    );
    await setRule(hearingTypeId, "cal-court", "mine");
    const before = recorder();
    await pass(before.port);
    expect(before.calls).toHaveLength(1);

    await run(
      "INSERT INTO calendar_sync_firm_limit (subject, event_type_id, may_leave, detail, updated_at, updated_by) VALUES (?1, ?1, 0, 'full', ?2, ?3)",
      hearingTypeId,
      NOW,
      memberUserId,
    );
    const after = recorder();
    expect(await pass(after.port)).toMatchObject({ report: { removed: 1 } });
    expect(after.calls).toEqual([{ op: "delete", remoteId: "remote-txn-1" }]);
    expect(await links()).toEqual([]);
  });

  it("sends nothing on a second pass, one update after an edit, and takes a cancelled event back", async () => {
    await seedEvent(
      "matterEvent_outbound000001",
      MATTER,
      hearingTypeId,
      "Motion hearing",
      "2026-12-01",
      true,
    );
    await setRule(hearingTypeId, "cal-court", "mine");
    await pass(recorder().port);

    const unchanged = recorder();
    await pass(unchanged.port);
    expect(unchanged.calls).toEqual([]);

    await run(
      "UPDATE matter_event SET starts_on = '2026-12-03' WHERE id = 'matterEvent_outbound000001'",
    );
    const edited = recorder();
    expect(await pass(edited.port)).toMatchObject({ report: { updated: 1 } });
    expect(edited.calls).toMatchObject([
      { op: "update", remoteId: "remote-txn-1", event: { startsOn: "2026-12-03" } },
    ]);

    await run(
      "UPDATE matter_event SET status = 'cancelled' WHERE id = 'matterEvent_outbound000001'",
    );
    const cancelled = recorder();
    await pass(cancelled.port);
    expect(cancelled.calls).toEqual([{ op: "delete", remoteId: "remote-txn-1" }]);
    expect(await links()).toEqual([]);
  });

  it("moves a copy when its rule names another calendar, over two passes", async () => {
    await seedEvent(
      "matterEvent_outbound000001",
      MATTER,
      hearingTypeId,
      "Motion hearing",
      "2026-12-01",
      true,
    );
    await setRule(hearingTypeId, "cal-court", "mine");
    await pass(recorder().port);
    await setRule(hearingTypeId, "cal-main", "mine");
    const first = recorder();
    await pass(first.port);
    expect(first.calls.map((call) => call.op)).toEqual(["delete"]);
    const second = recorder();
    await pass(second.port);
    expect(second.calls).toMatchObject([{ op: "create", calendar: "cal-main" }]);
  });

  it("sends an open deadline on the member's matter as a whole day, and takes it back once satisfied", async () => {
    await run(
      "INSERT INTO matter_deadline (id, matter_id, title, due_on, due_at_time, time_zone, source, state, recorded_at, created_at, updated_at) VALUES ('matterDeadline_outbound00001', ?1, 'Answer due', '2026-12-15', '17:00', 'America/Chicago', 'member', 'open', ?2, ?2, ?2)",
      MATTER,
      NOW,
    );
    await setRule("deadline", "cal-main", "mine");
    const provider = recorder();
    await pass(provider.port);
    expect(provider.calls).toMatchObject([
      {
        op: "create",
        event: {
          title: "Deadline: Answer due at 17:00",
          startsOn: "2026-12-15",
          startsAtTime: null,
        },
      },
    ]);

    await run(
      "UPDATE matter_deadline SET state = 'vacated', state_reason = 'order' WHERE id = 'matterDeadline_outbound00001'",
    );
    const after = recorder();
    await pass(after.port);
    expect(after.calls.map((call) => call.op)).toEqual(["delete"]);
  });

  it("repeats a create whose answer never came under the same identifier", async () => {
    await seedEvent(
      "matterEvent_outbound000001",
      MATTER,
      hearingTypeId,
      "Motion hearing",
      "2026-12-01",
      true,
    );
    await setRule(hearingTypeId, "cal-court", "mine");
    const down = recorder();
    down.failNext("network");
    expect(await pass(down.port)).toMatchObject({ kind: "unavailable" });
    expect(await links()).toMatchObject([{ state: "pending", remote_event_id: null }]);

    const up = recorder();
    await pass(up.port);
    const first = down.calls[0];
    const again = up.calls[0];
    expect(first?.op === "create" && again?.op === "create" && again.transactionId).toBe(
      first?.op === "create" ? first.transactionId : "",
    );
    expect(await links()).toMatchObject([{ state: "synced" }]);
  });

  it("stops at a refused sign-in, and does not retry one refused event until it changes", async () => {
    await seedEvent(
      "matterEvent_outbound000001",
      MATTER,
      hearingTypeId,
      "Motion hearing",
      "2026-12-01",
      true,
    );
    await seedEvent(
      "matterEvent_outbound000002",
      MATTER,
      hearingTypeId,
      "Status hearing",
      "2026-12-02",
      true,
    );
    await setRule(hearingTypeId, "cal-court", "mine");
    const refused = recorder();
    refused.failNext("auth");
    expect(await pass(refused.port)).toMatchObject({ kind: "sign-in-again" });
    expect(refused.calls).toHaveLength(1);

    await run("DELETE FROM calendar_sync_link");
    const oneBad = recorder();
    oneBad.failNext("validation");
    expect(await pass(oneBad.port)).toMatchObject({
      kind: "settled",
      report: { created: 1, refused: 1 },
    });
    const quiet = recorder();
    await pass(quiet.port);
    expect(quiet.calls).toEqual([]);
  });
});
