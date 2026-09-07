import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { MatterId, UserId } from "@magna-carta/identifiers/types";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";

// Shared scaffolding for the communications package tests: a migrated in-memory per-firm database, a
// fixed clock, and the one-line commit every service test needs (the services return effects; the
// caller commits them, so a test that forgets to commit is testing nothing).

export const ACTOR = "user_callTester0000" as UserId;
export const COLLEAGUE = "user_callColleague0" as UserId;

// Four matters, one per status the anchor rule has to answer for. OPEN is the ordinary case;
// CONSULTATION and INTAKE are the unnumbered anchors the owner's ruling admits and are the reason
// this file seeds four rather than two; CLOSED is the one a new filing is refused onto. HOLDING is
// the platform-owned custody matter, which must never appear on a read composing the predicate.
export const MATTER = "matter_callTest0000000000000" as MatterId;
export const CONSULTATION_MATTER = "matter_callConsult0000000000" as MatterId;
export const INTAKE_MATTER = "matter_callIntake00000000000" as MatterId;
export const CLOSED_MATTER = "matter_callClosed00000000000" as MatterId;
export const HOLDING_MATTER = "matter_callHolding0000000000" as MatterId;

export const clock = { now: () => "2026-09-07T12:00:00.000Z" };
export const visibility = visibleMatterPredicate();

/** The service options a member who may work the queue carries. */
export const options = {
  clock,
  actorUserId: ACTOR,
  visibility,
  mayReviewUnrouted: true,
};

/** The same options for a member who may not — the gate the unrouted rows sit behind. */
export const optionsWithoutQueue = { ...options, mayReviewUnrouted: false };

// A clock that advances a second per read, for the paths where two rows must not share an instant.
export function tickingClock(start = Date.parse("2026-09-07T12:00:00.000Z")) {
  let current = start;
  return {
    now: () => {
      current += 1000;
      return new Date(current).toISOString();
    },
  };
}

export function migratedDatabase() {
  return createMigratedNodeDatabase("per-firm");
}

export async function commit(database: BatchDatabase, effect: EffectWrite): Promise<void> {
  await commitEffectBatch(database, effect, { now: () => clock.now() });
}

export function seedFirm(raw: ReturnType<typeof migratedDatabase>["raw"]): void {
  const members: readonly [UserId, string][] = [
    [ACTOR, "Call Tester"],
    [COLLEAGUE, "A Colleague"],
  ];
  for (const [userId, displayName] of members) {
    raw.exec(
      `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('${userId}', '${displayName}', 'active', '2026-08-01T00:00:00.000Z')`,
    );
  }
  const columns =
    "id, title, status, responsible_member_id, matter_number, consultation_number, system_key, created_at, updated_at";
  const rows: readonly [MatterId, string, string, string, string, string][] = [
    [MATTER, "Herrera v Alvarez", "open", "'2026-0041'", "NULL", "NULL"],
    // No matter number, a tentative consultation number — the shape the anchor rule turns on.
    [CONSULTATION_MATTER, "Okafor consultation", "consultation", "NULL", "'C-2026-0009'", "NULL"],
    // No number of any kind. A first phone call from a stranger lands here.
    [INTAKE_MATTER, "Enquiry from R. Pell", "intake", "NULL", "NULL", "NULL"],
    [CLOSED_MATTER, "Brown estate", "closed", "'2026-0012'", "NULL", "NULL"],
    [HOLDING_MATTER, "Custody holdings", "open", "NULL", "NULL", "'custody-holding'"],
  ];
  for (const [id, title, status, matterNumber, consultationNumber, systemKey] of rows) {
    raw.exec(
      `INSERT INTO matter (${columns}) VALUES ('${id}', '${title}', '${status}', '${ACTOR}', ` +
        `${matterNumber}, ${consultationNumber}, ${systemKey}, ` +
        `'2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z')`,
    );
  }
}

/** A call as the service wants it, with only the fields a test cares about overridden. */
export function callInput(overrides: Record<string, unknown> = {}) {
  return {
    channel: "voice" as const,
    direction: "outbound" as const,
    counterpartyNumber: "(702) 555-0143",
    occurredAt: "2026-09-07T10:15:00.000Z",
    durationSeconds: 720,
    summary: "Talked the offer through. She wants to sleep on it.",
    ...overrides,
  };
}

/** A text as the service wants it. */
export function textInput(overrides: Record<string, unknown> = {}) {
  return {
    channel: "sms" as const,
    direction: "inbound" as const,
    counterpartyNumber: "+17025550143",
    occurredAt: "2026-09-07T10:20:00.000Z",
    body: "Can we push tomorrow to 3?",
    ...overrides,
  };
}
