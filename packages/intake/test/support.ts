import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { MatterId, MatterTypeId, UserId } from "@magna-carta/identifiers/types";
import type { IntakeStepReaders } from "../src/checklist.ts";
import { addProcedureStep, createProcedure } from "../src/procedure-service.ts";

// Shared scaffolding for the intake tests: a migrated in-memory per-firm database, a fixed clock,
// and the one-line commit every service test needs (the services return effects; the caller commits
// them, so a test that forgets to commit is testing nothing).

export const ACTOR = "user_intakeTester000" as UserId;
export const PARTNER = "user_intakePartner00" as UserId;
export const CONSULTATION = "matter_intakeConsult0000000000000" as MatterId;
export const OTHER_CONSULTATION = "matter_intakeOtherKind00000000000" as MatterId;
export const OPEN_MATTER = "matter_intakeOpened00000000000000" as MatterId;
export const HOLDING_MATTER = "matter_intakeHolding0000000000000" as MatterId;
export const MATTER_TYPE = "matterType_intakeInjury0000000" as MatterTypeId;
export const OTHER_MATTER_TYPE = "matterType_intakeEstate0000000" as MatterTypeId;

export const clock = { now: () => "2026-09-03T12:00:00.000Z" };
export const options = { clock, actorUserId: ACTOR };
export const partnerOptions = { clock, actorUserId: PARTNER };

export function migratedDatabase() {
  return createMigratedNodeDatabase("per-firm");
}

export async function commit(database: BatchDatabase, effect: EffectWrite): Promise<void> {
  await commitEffectBatch(database, effect, { now: () => clock.now() });
}

// Two members, two matter types, and four matters: a consultation of the injury type, one of the
// estate type (to prove a bound procedure does not reach across), an open matter (which takes no
// record), and the platform-owned custody holding matter, which has no intake at all.
export function seedFirm(raw: ReturnType<typeof migratedDatabase>["raw"]): void {
  for (const [userId, name] of [
    [ACTOR, "Intake Tester"],
    [PARTNER, "A Partner"],
  ] as const) {
    raw.exec(
      `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('${userId}', '${name}', 'active', '2026-08-01T00:00:00.000Z')`,
    );
  }
  for (const [id, name] of [
    [MATTER_TYPE, "Personal injury"],
    [OTHER_MATTER_TYPE, "Estate"],
  ] as const) {
    raw.exec(
      `INSERT INTO matter_type (id, name, active, created_at, updated_at) VALUES ('${id}', '${name}', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    );
  }
  const columns =
    "id, title, status, matter_type_id, responsible_member_id, system_key, opened_at, created_at, updated_at";
  const matters: readonly [MatterId, string, string, MatterTypeId | null, string | null][] = [
    [CONSULTATION, "Herrera consultation", "prospective", MATTER_TYPE, null],
    [OTHER_CONSULTATION, "Brown estate consultation", "prospective", OTHER_MATTER_TYPE, null],
    [OPEN_MATTER, "Nakamura sale", "open", MATTER_TYPE, null],
    [HOLDING_MATTER, "Custody holdings", "open", null, "custody-holding"],
  ];
  for (const [id, title, status, typeId, systemKey] of matters) {
    const key = systemKey === null ? "NULL" : `'${systemKey}'`;
    const type = typeId === null ? "NULL" : `'${typeId}'`;
    const opened = status === "open" ? "'2026-06-09'" : "NULL";
    raw.exec(
      `INSERT INTO matter (${columns}) VALUES ('${id}', '${title}', '${status}', ${type}, '${ACTOR}', ${key}, ${opened}, '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z')`,
    );
  }
}

// A procedure bound to the injury type with the steps given, committed, with its step ids in order.
export async function firmWithProcedure(
  steps: readonly Parameters<typeof addProcedureStep>[2][],
  matterTypeId: MatterTypeId | null = MATTER_TYPE,
) {
  const database = migratedDatabase();
  seedFirm(database.raw);
  const created = await createProcedure(
    database.database,
    { name: "Injury intake", matterTypeId },
    options,
  );
  await commit(database.database, created.effect);
  const stepIds = [];
  for (const step of steps) {
    const added = await addProcedureStep(database.database, created.procedureId, step, options);
    await commit(database.database, added.effect);
    stepIds.push(added.stepId);
  }
  return { ...database, procedureId: created.procedureId, stepIds };
}

// Readers whose answers a test sets, so the checklist's own logic is what is under test.
export function fakeReaders(
  answers: Partial<Record<string, { satisfied: boolean; statement: string } | null>>,
): IntakeStepReaders {
  const readers: Record<string, IntakeStepReaders[keyof IntakeStepReaders]> = {};
  for (const [kind, answer] of Object.entries(answers)) {
    readers[kind] = () => Promise.resolve(answer ?? null);
  }
  return readers as IntakeStepReaders;
}
