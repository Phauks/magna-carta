/*
 * One account's outbound pass, over a real firm database, with the provider played by a recorder.
 * What is pinned: nothing leaves without a rule; a rule's scope decides whose events leave; the
 * firm's limit decides how much of each; a second pass over an unchanged calendar sends nothing; an
 * edit sends one update; a cancelled event, a removed rule and a closed subject each take the copy
 * back; a create whose answer was lost is repeated under the same identifier; and a refused sign-in
 * stops the pass where it stands.
 *
 * And for what the member does to a copy afterwards: a copy left alone raises nothing; a copy moved
 * or deleted becomes one question for the member and no write anywhere; a deadline's copy is put
 * back without asking; and a question whose event changes or is cancelled goes away.
 *
 * And for a series: it leaves as one event carrying its rule, whenever it began; a changed day
 * leaves as its own event and is named as skipped on the series; a series that has run its course
 * is not sent; and one the provider will not take is a question for the member, not a silence.
 */
import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  CalendarSyncPort,
  ProviderEventSnapshot,
  ProviderEventWrite,
} from "@magna-carta/calendar/sync-port";
import { instantForCivilDateTime } from "@magna-carta/civil-time/time-zone";
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

interface RemoteCopy {
  event: ProviderEventWrite;
  versionTag: string;
}

// The copy as a provider would hand it back: a whole day as civil dates, a timed copy as instants.
function snapshotOf(remoteId: string, copy: RemoteCopy): ProviderEventSnapshot {
  const event = copy.event;
  const lastDay = event.endsOn ?? event.startsOn;
  return {
    remoteId,
    versionTag: copy.versionTag,
    title: event.title,
    location: event.location,
    when:
      event.startsAtTime === null
        ? { kind: "days", startsOn: event.startsOn, endsOn: lastDay }
        : {
            kind: "instants",
            startsAtMilliseconds: instantForCivilDateTime(
              event.startsOn,
              event.startsAtTime,
              event.timeZone,
            ),
            endsAtMilliseconds: instantForCivilDateTime(
              lastDay,
              event.endsAtTime ?? event.startsAtTime,
              event.timeZone,
            ),
          },
  };
}

// A provider played from memory. `remote` is the member's calendar: a test that hands the same map
// to two recorders is the same account on two passes, and a test that edits the map is the member
// changing a copy themselves.
function recorder(remote = new Map<string, RemoteCopy>()): {
  port: CalendarSyncPort;
  calls: Call[];
  remote: Map<string, RemoteCopy>;
  listed: { complete: boolean; hide: Set<string> };
  failNext: (kind: string) => void;
} {
  const calls: Call[] = [];
  const listed = { complete: true, hide: new Set<string>() };
  let failing: string | null = null;
  let writes = 0;
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
    remote,
    listed,
    failNext: (kind) => {
      failing = kind;
    },
    port: {
      listCalendars: () => Promise.resolve(ok([])),
      createEvent: (calendar, event, transactionId) => {
        calls.push({ op: "create", calendar, event, transactionId });
        const refused = refusal();
        if (refused !== null) return Promise.resolve(refused);
        const remoteId = `remote-${transactionId}`;
        remote.set(remoteId, { event, versionTag: "v1" });
        return Promise.resolve(ok({ remoteId, versionTag: "v1" }));
      },
      updateEvent: (remoteId, event) => {
        calls.push({ op: "update", remoteId, event });
        const refused = refusal();
        if (refused !== null) return Promise.resolve(refused);
        if (!remote.has(remoteId)) return Promise.resolve(ok({ found: false as const }));
        const versionTag = `w${(writes += 1)}`;
        remote.set(remoteId, { event, versionTag });
        return Promise.resolve(ok({ found: true as const, versionTag }));
      },
      deleteEvent: (remoteId) => {
        calls.push({ op: "delete", remoteId });
        const refused = refusal();
        if (refused !== null) return Promise.resolve(refused);
        remote.delete(remoteId);
        return Promise.resolve(ok(null));
      },
      listWrittenEvents: () =>
        Promise.resolve(
          ok({
            events: [...remote]
              .filter(([remoteId]) => !listed.hide.has(remoteId))
              .map(([remoteId, copy]) => snapshotOf(remoteId, copy)),
            complete: listed.complete,
          }),
        ),
      readEvent: (remoteId) => {
        const copy = remote.get(remoteId);
        return Promise.resolve(ok(copy === undefined ? null : snapshotOf(remoteId, copy)));
      },
      watchChanges: (request) =>
        Promise.resolve(ok({ watchId: "watch-1", expiresAt: request.expiresAt })),
      renewWatch: (watchId, expiresAt) => Promise.resolve(ok({ watchId, expiresAt })),
      stopWatch: () => Promise.resolve(ok(null)),
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
    "connection_sync_issue",
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
    const account = recorder().remote;
    await pass(recorder(account).port);

    const unchanged = recorder(account);
    await pass(unchanged.port);
    expect(unchanged.calls).toEqual([]);

    await run(
      "UPDATE matter_event SET starts_on = '2026-12-03' WHERE id = 'matterEvent_outbound000001'",
    );
    const edited = recorder(account);
    expect(await pass(edited.port)).toMatchObject({ report: { updated: 1 } });
    expect(edited.calls).toMatchObject([
      { op: "update", remoteId: "remote-txn-1", event: { startsOn: "2026-12-03" } },
    ]);

    await run(
      "UPDATE matter_event SET status = 'cancelled' WHERE id = 'matterEvent_outbound000001'",
    );
    const cancelled = recorder(account);
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

interface IssueRow {
  local_id: string;
  kind: string;
  state: string;
  sent_json: string;
  found_json: string | null;
  provider_refused: number;
}

async function issues(): Promise<IssueRow[]> {
  const { results } = await firmDatabase
    .prepare(
      "SELECT local_id, kind, state, sent_json, found_json, provider_refused FROM connection_sync_issue WHERE connection_id = ?1 ORDER BY local_id",
    )
    .bind(CONNECTION)
    .all<IssueRow>();
  return results;
}

// The member changing a copy in their own calendar: the provider gives it a tag of its own.
function memberEdits(
  remote: Map<string, RemoteCopy>,
  remoteId: string,
  change: Partial<ProviderEventWrite>,
  versionTag = "member-1",
): void {
  const copy = remote.get(remoteId);
  if (copy === undefined) throw new Error(`no copy ${remoteId}`);
  remote.set(remoteId, { event: { ...copy.event, ...change }, versionTag });
}

describe("what a member did to a copy in their own calendar", () => {
  const HEARING = "matterEvent_outbound000001";

  async function sendHearing() {
    await seedEvent(HEARING, MATTER, hearingTypeId, "Motion hearing", "2026-12-01", true);
    await setRule(hearingTypeId, "cal-court", "mine");
    const provider = recorder();
    expect(await pass(provider.port)).toMatchObject({ report: { created: 1, flagged: 0 } });
    return provider;
  }

  it("raises nothing for a copy nobody touched, pass after pass", async () => {
    const provider = await sendHearing();
    const again = recorder(provider.remote);
    expect(await pass(again.port)).toMatchObject({
      kind: "settled",
      report: { flagged: 0, putBack: 0 },
    });
    expect(again.calls).toEqual([]);
    expect(await issues()).toEqual([]);
  });

  it("asks the member about a copy they moved, once, and writes nothing anywhere", async () => {
    const provider = await sendHearing();
    memberEdits(provider.remote, "remote-txn-1", { startsAtTime: "14:00", endsAtTime: "15:30" });

    const second = recorder(provider.remote);
    expect(await pass(second.port)).toMatchObject({ kind: "settled", report: { flagged: 1 } });
    expect(second.calls).toEqual([]);
    const [issue] = await issues();
    expect(issue).toMatchObject({ local_id: HEARING, kind: "changed", state: "open" });
    expect(JSON.parse(issue?.sent_json ?? "{}")).toMatchObject({
      title: "Motion hearing",
      startsOn: "2026-12-01",
      startsAtTime: "09:30",
      endsAtTime: "11:00",
    });
    // Read back on the wall clock of the zone the hearing was recorded in.
    expect(JSON.parse(issue?.found_json ?? "{}")).toMatchObject({
      startsOn: "2026-12-01",
      startsAtTime: "14:00",
      endsAtTime: "15:30",
      timeZone: "America/Chicago",
    });
    const event = await firmDatabase
      .prepare("SELECT starts_at_time FROM matter_event WHERE id = ?1")
      .bind(HEARING)
      .first<{ starts_at_time: string }>();
    expect(event?.starts_at_time).toBe("09:30");

    // The member answered "leave it". The same copy is not raised again.
    await run("UPDATE connection_sync_issue SET state = 'left', settled_at = ?1", NOW);
    const third = recorder(provider.remote);
    expect(await pass(third.port)).toMatchObject({ report: { flagged: 0 } });
    expect(third.calls).toEqual([]);
    expect((await issues()).map((row) => row.state)).toEqual(["left"]);

    // They move it again: that is a new question.
    memberEdits(provider.remote, "remote-txn-1", { startsAtTime: "16:00" }, "member-2");
    expect(await pass(recorder(provider.remote).port)).toMatchObject({ report: { flagged: 1 } });
    expect((await issues()).map((row) => row.state)).toEqual(["open"]);
  });

  it("raises nothing when the provider's tag moved and the copy reads as it was sent", async () => {
    const provider = await sendHearing();
    // A reminder dismissed: a new tag, and the title handed back with a trailing space.
    memberEdits(provider.remote, "remote-txn-1", { title: "Motion hearing " }, "reminder-1");
    expect(await pass(recorder(provider.remote).port)).toMatchObject({ report: { flagged: 0 } });
    expect(await issues()).toEqual([]);
    const link = await firmDatabase
      .prepare("SELECT remote_version_tag FROM calendar_sync_link WHERE local_id = ?1")
      .bind(HEARING)
      .first<{ remote_version_tag: string }>();
    expect(link?.remote_version_tag).toBe("reminder-1");
  });

  it("asks about a copy the member deleted, and only once the provider confirms it is gone", async () => {
    const provider = await sendHearing();
    // Missing from the list and still there when asked for by itself: not gone.
    const hidden = recorder(provider.remote);
    hidden.listed.hide.add("remote-txn-1");
    expect(await pass(hidden.port)).toMatchObject({ report: { flagged: 0 } });
    expect(await issues()).toEqual([]);

    provider.remote.delete("remote-txn-1");
    const after = recorder(provider.remote);
    expect(await pass(after.port)).toMatchObject({ kind: "settled", report: { flagged: 1 } });
    expect(after.calls).toEqual([]);
    expect(await issues()).toMatchObject([
      { local_id: HEARING, kind: "removed", found_json: null },
    ]);
    // The copy stays deleted and the question is not raised twice.
    const later = recorder(provider.remote);
    expect(await pass(later.port)).toMatchObject({ report: { flagged: 0, created: 0 } });
    expect(later.calls).toEqual([]);
  });

  it("puts a deadline's copy back without asking", async () => {
    await run(
      "INSERT INTO matter_deadline (id, matter_id, title, due_on, due_at_time, time_zone, source, state, recorded_at, created_at, updated_at) VALUES ('matterDeadline_outbound00001', ?1, 'Answer due', '2026-12-15', NULL, 'America/Chicago', 'member', 'open', ?2, ?2, ?2)",
      MATTER,
      NOW,
    );
    await setRule("deadline", "cal-main", "mine");
    const provider = recorder();
    await pass(provider.port);
    memberEdits(provider.remote, "remote-txn-1", { startsOn: "2026-12-16", endsOn: "2026-12-16" });

    const second = recorder(provider.remote);
    expect(await pass(second.port)).toMatchObject({ report: { flagged: 0, putBack: 1 } });
    expect(second.calls).toMatchObject([{ op: "update", event: { startsOn: "2026-12-15" } }]);
    expect(await issues()).toEqual([]);
    // And the pass after that finds nothing to do.
    const third = recorder(provider.remote);
    expect(await pass(third.port)).toMatchObject({ report: { putBack: 0 } });
    expect(third.calls).toEqual([]);
  });

  it("drops a question when the event changes, and when the event is cancelled", async () => {
    const provider = await sendHearing();
    memberEdits(provider.remote, "remote-txn-1", { startsAtTime: "14:00" });
    await pass(recorder(provider.remote).port);
    expect(await issues()).toHaveLength(1);

    // The firm's calendar moves the hearing: its version is written over the member's.
    await run("UPDATE matter_event SET starts_on = '2026-12-02' WHERE id = ?1", HEARING);
    const moved = recorder(provider.remote);
    expect(await pass(moved.port)).toMatchObject({ report: { updated: 1, flagged: 0 } });
    expect(await issues()).toEqual([]);

    memberEdits(provider.remote, "remote-txn-1", { startsAtTime: "15:00" }, "member-3");
    await pass(recorder(provider.remote).port);
    expect(await issues()).toHaveLength(1);
    await run("UPDATE matter_event SET status = 'cancelled' WHERE id = ?1", HEARING);
    await pass(recorder(provider.remote).port);
    expect(await issues()).toEqual([]);
    expect(await links()).toEqual([]);
  });

  it("concludes nothing when the provider will not hand back the list", async () => {
    const provider = await sendHearing();
    provider.remote.delete("remote-txn-1");
    const failing = recorder(provider.remote);
    failing.port.listWrittenEvents = () =>
      Promise.resolve(adapterError(integrationProblem("validation", 502, "unreadable")));
    expect(await pass(failing.port)).toMatchObject({ kind: "settled", report: { flagged: 0 } });
    expect(await issues()).toEqual([]);
  });
});

describe("a repeating event", () => {
  const SERIES = "matterEvent_outbound0series";

  async function seedSeries(startsOn: string, rule: string): Promise<void> {
    await seedEvent(SERIES, MATTER, hearingTypeId, "Status conference", startsOn, true);
    await run("UPDATE matter_event SET recurrence_rule = ?1 WHERE id = ?2", rule, SERIES);
    await setRule(hearingTypeId, "cal-court", "mine");
  }

  it("leaves as one event with its rule, though it began before the window", async () => {
    // Weekly since the start of the year: far outside the month the window reaches back.
    await seedSeries("2026-01-06", "FREQ=WEEKLY");
    const provider = recorder();
    expect(await pass(provider.port)).toMatchObject({ kind: "settled", report: { created: 1 } });
    expect(provider.calls).toMatchObject([
      {
        op: "create",
        event: {
          title: "Status conference",
          startsOn: "2026-01-06",
          repeats: { line: "FREQ=WEEKLY", skippedDays: [] },
        },
      },
    ]);
    // And nothing more on the next pass.
    const again = recorder(provider.remote);
    await pass(again.port);
    expect(again.calls).toEqual([]);
  });

  it("sends a changed day as its own event and names it as skipped on the series", async () => {
    await seedSeries("2026-11-03", "FREQ=WEEKLY");
    const provider = recorder();
    await pass(provider.port);

    // The 1 December conference is moved to the afternoon: a row of its own stands in for it.
    await seedEvent(
      "matterEvent_outbound0changed",
      MATTER,
      hearingTypeId,
      "Status conference (moved)",
      "2026-12-01",
      true,
    );
    await run(
      "UPDATE matter_event SET recurrence_parent_id = ?1, recurrence_occurrence_on = '2026-12-01', starts_at_time = '14:00', ends_at_time = '15:00' WHERE id = 'matterEvent_outbound0changed'",
      SERIES,
    );
    const second = recorder(provider.remote);
    expect(await pass(second.port)).toMatchObject({ report: { created: 1, updated: 1 } });
    expect(second.calls).toMatchObject([
      { op: "update", event: { repeats: { skippedDays: ["2026-12-01"] } } },
      { op: "create", event: { title: "Status conference (moved)", startsAtTime: "14:00" } },
    ]);
    expect(second.calls[1]?.op === "create" && second.calls[1].event.repeats).toBeUndefined();

    // The 8th is called off: a cancelled row, which is skipped on the series and sent nowhere.
    await seedEvent(
      "matterEvent_outbound0calledoff",
      MATTER,
      hearingTypeId,
      "Status conference",
      "2026-12-08",
      true,
    );
    await run(
      "UPDATE matter_event SET recurrence_parent_id = ?1, recurrence_occurrence_on = '2026-12-08', status = 'cancelled' WHERE id = 'matterEvent_outbound0calledoff'",
      SERIES,
    );
    const third = recorder(provider.remote);
    await pass(third.port);
    expect(third.calls).toMatchObject([
      { op: "update", event: { repeats: { skippedDays: ["2026-12-01", "2026-12-08"] } } },
    ]);
  });

  it("does not send a series whose last day is behind the window", async () => {
    await seedSeries("2026-01-06", "FREQ=WEEKLY;COUNT=4");
    const provider = recorder();
    await pass(provider.port);
    expect(provider.calls).toEqual([]);
  });

  it("tells the member when the provider will not take an event, and tries again only when asked", async () => {
    await seedSeries("2026-12-01", "FREQ=WEEKLY");
    const provider = recorder();
    provider.failNext("validation");
    expect(await pass(provider.port)).toMatchObject({ kind: "settled", report: { refused: 1 } });
    expect(await issues()).toMatchObject([
      // Stored as a copy the provider does not hold, flagged as one it never took.
      { local_id: SERIES, kind: "removed", provider_refused: 1, state: "open", found_json: null },
    ]);
    expect(await links()).toMatchObject([{ local_id: SERIES, state: "failed" }]);

    // Not tried again by itself, and the question stays.
    const quiet = recorder(provider.remote);
    await pass(quiet.port);
    expect(quiet.calls).toEqual([]);
    expect(await issues()).toHaveLength(1);

    // The member presses Try Again, which clears what was agreed. This time it is taken.
    await run("UPDATE calendar_sync_link SET agreed_hash = '' WHERE local_id = ?1", SERIES);
    await run("DELETE FROM connection_sync_issue");
    const retried = recorder(provider.remote);
    expect(await pass(retried.port)).toMatchObject({ report: { created: 1 } });
    expect(await issues()).toEqual([]);
    expect(await links()).toMatchObject([{ local_id: SERIES, state: "synced" }]);
  });
});
