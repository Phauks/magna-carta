import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { UserId } from "@magna-carta/identifiers/types";

// Shared scaffolding for the Custodian package tests: a migrated in-memory per-firm database, a
// fixed clock, and the one-line commit every service test needs (the services return effects; the
// caller commits them, so a test that forgets to commit is testing nothing).

export const ACTOR = "user_custodyTester" as UserId;

export const clock = { now: () => "2026-08-04T12:00:00.000Z" };
export const laterClock = { now: () => "2026-09-01T09:00:00.000Z" };

export const options = { clock, actorUserId: ACTOR };

export function migratedDatabase() {
  return createMigratedNodeDatabase("per-firm");
}

export async function commit(database: BatchDatabase, effect: EffectWrite): Promise<void> {
  await commitEffectBatch(database, effect, { now: () => clock.now() });
}

// A firm member row, because a matter's responsible_member_id is a foreign key onto it — which the
// custody holding matter needs the moment a matterless packet is logged.
// A release that satisfies the gate: it names who collected the property, the authority it left on,
// and the identity check made before it did. Every test whose subject is something ELSE (a hold, a
// report, a terminal status) uses this so the gate is not silently the thing under test.
export const AUTHORIZED_RELEASE = {
  kind: "released",
  borrower: { kind: "external", name: "A. Collector" },
  releaseAuthorization: {
    authorityBasis: "owner collecting their own original in person",
    identityEvidence: "photographic identification checked against the Directory record",
    identityVerifiedByUserId: ACTOR,
  },
} as const;

export function seedMember(raw: ReturnType<typeof migratedDatabase>["raw"]): UserId {
  raw.exec(
    `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('${ACTOR}', 'Custody Tester', 'active', '2026-08-04T00:00:00.000Z')`,
  );
  return ACTOR;
}
