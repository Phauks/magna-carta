import { describe, expect, it } from "vitest";
import type { IntakeProcedureStepId, MatterId } from "@magna-carta/identifiers/types";
import { readIntakeChecklist } from "../src/checklist.ts";
import {
  INTAKE_STEP_OUTSTANDING,
  matterIntakeGraduationPrecondition,
} from "../src/graduation-precondition.ts";
import { recordStepCompleted, reopenStep, waiveStep } from "../src/record-service.ts";
import { readStepRecordHistory } from "../src/record-statements.ts";
import {
  CONSULTATION,
  HOLDING_MATTER,
  OPEN_MATTER,
  OTHER_CONSULTATION,
  PARTNER,
  commit,
  fakeReaders,
  firmWithProcedure,
  options,
  partnerOptions,
} from "./support.ts";

const STEPS = [
  { kind: "conflicts-check", title: "Run the conflicts check" },
  { kind: "fee-agreement", title: "Agree the fee" },
  { kind: "identity-verification", title: "Verify the client's identity" },
  { kind: "acknowledgement", title: "Give the client the privacy notice", required: false },
] as const;

describe("the derived checklist", () => {
  it("lists the binding procedure's steps with a subsystem's answer, a record, or nobody", async () => {
    const database = await firmWithProcedure(STEPS);
    const readers = fakeReaders({
      "conflicts-check": { satisfied: false, statement: "A conflicts check has not yet run." },
      "fee-agreement": { satisfied: true, statement: "In force since 2026-09-01: hourly." },
    });
    const checklist = await readIntakeChecklist(database.database, CONSULTATION, readers);
    expect(checklist.matterStatus).toBe("intake");
    expect(checklist.procedures.map((procedure) => procedure.name)).toEqual(["Injury intake"]);
    expect(
      checklist.steps.map((step) => [
        step.kind,
        step.required,
        step.recordable,
        step.standing.answeredBy,
        step.standing.satisfied,
      ]),
    ).toEqual([
      ["conflicts-check", true, false, "subsystem", false],
      ["fee-agreement", true, false, "subsystem", true],
      ["identity-verification", true, true, "nobody", false],
      ["acknowledgement", false, true, "nobody", false],
    ]);
    // Two required steps unanswered; the optional one does not count.
    expect(checklist.outstandingRequired).toBe(2);
  });

  it("binds nothing to a consultation of another kind, and refuses a system matter", async () => {
    const database = await firmWithProcedure(STEPS);
    const other = await readIntakeChecklist(database.database, OTHER_CONSULTATION, {});
    expect(other.procedures).toEqual([]);
    expect(other.steps).toEqual([]);
    expect(other.outstandingRequired).toBe(0);
    await expect(readIntakeChecklist(database.database, HOLDING_MATTER, {})).rejects.toMatchObject({
      code: "matter-unknown",
    });
  });

  it("asks a subsystem once per kind and reference, however many steps share them", async () => {
    const database = await firmWithProcedure([
      { kind: "document", title: "Letter one", referenceId: "documentTemplate_a" },
      { kind: "document", title: "Letter one again", referenceId: "documentTemplate_a" },
      { kind: "document", title: "Letter two", referenceId: "documentTemplate_b" },
    ]);
    let asked = 0;
    const checklist = await readIntakeChecklist(database.database, CONSULTATION, {
      document: () => {
        asked += 1;
        return Promise.resolve({ satisfied: true, statement: "Assembled." });
      },
    });
    expect(asked).toBe(2);
    expect(checklist.steps.every((step) => step.standing.satisfied)).toBe(true);
  });

  it("treats a reader that declines as nobody having answered", async () => {
    const database = await firmWithProcedure([{ kind: "document", title: "Any document" }]);
    const checklist = await readIntakeChecklist(database.database, CONSULTATION, {
      document: () => Promise.resolve(null),
    });
    expect(checklist.steps[0]?.standing).toEqual({
      satisfied: false,
      answeredBy: "nobody",
      statement: "Not yet recorded.",
    });
  });
});

describe("a member's record", () => {
  it("records a step completed, with a note, and the checklist reads the record over the reader", async () => {
    const database = await firmWithProcedure(STEPS);
    const identity = database.stepIds[2]!;
    const recorded = await recordStepCompleted(
      database.database,
      { matterId: CONSULTATION, stepId: identity, note: "  Driving licence sighted  " },
      options,
    );
    await commit(database.database, recorded.effect);
    const checklist = await readIntakeChecklist(database.database, CONSULTATION, {});
    const step = checklist.steps.find((candidate) => candidate.stepId === identity);
    expect(step?.standing).toEqual({
      satisfied: true,
      answeredBy: "record",
      statement: "Recorded as completed: Driving licence sighted",
    });
    expect(step?.record).toMatchObject({
      outcome: "completed",
      note: "Driving licence sighted",
      recordedBy: options.actorUserId,
    });
  });

  it("refuses to record a kind the platform answers itself, and accepts a waiver of it", async () => {
    const database = await firmWithProcedure(STEPS);
    const conflicts = database.stepIds[0]!;
    await expect(
      recordStepCompleted(
        database.database,
        { matterId: CONSULTATION, stepId: conflicts },
        options,
      ),
    ).rejects.toMatchObject({ code: "step-not-recordable" });
    await expect(
      waiveStep(
        database.database,
        { matterId: CONSULTATION, stepId: conflicts, rationale: "   " },
        partnerOptions,
      ),
    ).rejects.toMatchObject({ code: "record-rationale-required" });
    const waived = await waiveStep(
      database.database,
      {
        matterId: CONSULTATION,
        stepId: conflicts,
        rationale: "Existing client; comprehensive check ran on the related matter last week.",
      },
      partnerOptions,
    );
    await commit(database.database, waived.effect);
    const checklist = await readIntakeChecklist(
      database.database,
      CONSULTATION,
      fakeReaders({
        "conflicts-check": { satisfied: false, statement: "A conflicts check has not yet run." },
      }),
    );
    const step = checklist.steps.find((candidate) => candidate.stepId === conflicts);
    expect(step?.standing.answeredBy).toBe("record");
    expect(step?.standing.satisfied).toBe(true);
    expect(step?.standing.statement).toContain("Waived:");
    expect(step?.record?.recordedBy).toBe(PARTNER);
  });

  it("is append-and-flip: recording again supersedes, reopening supersedes, the history keeps all", async () => {
    const database = await firmWithProcedure(STEPS);
    const identity = database.stepIds[2]!;
    const first = await recordStepCompleted(
      database.database,
      { matterId: CONSULTATION, stepId: identity },
      options,
    );
    await commit(database.database, first.effect);
    const second = await recordStepCompleted(
      database.database,
      { matterId: CONSULTATION, stepId: identity, note: "Passport this time" },
      partnerOptions,
    );
    await commit(database.database, second.effect);
    const reopened = await reopenStep(
      database.database,
      { matterId: CONSULTATION, stepId: identity },
      options,
    );
    await commit(database.database, reopened.effect);

    const checklist = await readIntakeChecklist(database.database, CONSULTATION, {});
    expect(checklist.steps.find((step) => step.stepId === identity)?.standing.answeredBy).toBe(
      "nobody",
    );
    const history = await readStepRecordHistory(database.database, CONSULTATION);
    expect(history.map((record) => [record.id, record.superseded_at !== null])).toEqual([
      [first.recordId, true],
      [second.recordId, true],
    ]);
    expect(history[0]?.superseded_by).toBe(PARTNER);
    expect(history[1]?.superseded_by).toBe(options.actorUserId);
    await expect(
      reopenStep(database.database, { matterId: CONSULTATION, stepId: identity }, options),
    ).rejects.toMatchObject({ code: "record-none-live" });
  });

  it("refuses a record on an open matter, on another kind's consultation, and on an unknown step", async () => {
    const database = await firmWithProcedure(STEPS);
    const identity = database.stepIds[2]!;
    await expect(
      recordStepCompleted(database.database, { matterId: OPEN_MATTER, stepId: identity }, options),
    ).rejects.toMatchObject({ code: "matter-not-intake" });
    await expect(
      recordStepCompleted(
        database.database,
        { matterId: OTHER_CONSULTATION, stepId: identity },
        options,
      ),
    ).rejects.toMatchObject({ code: "step-not-bound" });
    await expect(
      recordStepCompleted(
        database.database,
        { matterId: CONSULTATION, stepId: "intakeProcedureStep_missing" as IntakeProcedureStepId },
        options,
      ),
    ).rejects.toMatchObject({ code: "step-unknown" });
    await expect(
      recordStepCompleted(
        database.database,
        { matterId: "matter_missing" as MatterId, stepId: identity },
        options,
      ),
    ).rejects.toMatchObject({ code: "matter-unknown" });
  });
});

describe("the graduation gate", () => {
  it("refuses while any required step is outstanding, naming each, and passes once each is answered", async () => {
    const database = await firmWithProcedure(STEPS);
    const readers = fakeReaders({
      "conflicts-check": { satisfied: false, statement: "A conflicts check has not yet run." },
      "fee-agreement": { satisfied: true, statement: "In force." },
    });
    const gate = matterIntakeGraduationPrecondition(readers);
    const context = { database: database.database, matterId: CONSULTATION };
    let failures = await gate.check(context);
    expect(failures.map((failure) => failure.code)).toEqual([
      INTAKE_STEP_OUTSTANDING,
      INTAKE_STEP_OUTSTANDING,
    ]);
    expect(failures[0]?.message).toContain('"Run the conflicts check"');
    expect(failures[0]?.message).toContain("A conflicts check has not yet run.");
    expect(failures[1]?.message).toContain('"Verify the client\'s identity"');

    const identity = await recordStepCompleted(
      database.database,
      { matterId: CONSULTATION, stepId: database.stepIds[2]! },
      options,
    );
    await commit(database.database, identity.effect);
    const waived = await waiveStep(
      database.database,
      {
        matterId: CONSULTATION,
        stepId: database.stepIds[0]!,
        rationale: "Check ran on the related file.",
      },
      partnerOptions,
    );
    await commit(database.database, waived.effect);
    failures = await gate.check(context);
    expect(failures).toEqual([]);
  });

  it("imposes nothing on a consultation no procedure binds", async () => {
    const database = await firmWithProcedure(STEPS);
    const gate = matterIntakeGraduationPrecondition({});
    expect(await gate.check({ database: database.database, matterId: OTHER_CONSULTATION })).toEqual(
      [],
    );
  });
});
