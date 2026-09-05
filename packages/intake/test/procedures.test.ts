import { describe, expect, it } from "vitest";
import type { IntakeProcedureId, IntakeProcedureStepId } from "@magna-carta/identifiers/types";
import {
  addProcedureStep,
  createProcedure,
  editProcedure,
  editProcedureStep,
  retireProcedureStep,
  setProcedureActive,
} from "../src/procedure-service.ts";
import {
  readProcedure,
  readProcedureSteps,
  readProceduresBinding,
  selectProceduresStatement,
  type IntakeProcedureRow,
} from "../src/procedure-statements.ts";
import { INTAKE_STEP_KINDS, MAX_PROCEDURE_STEPS } from "../src/types.ts";
import {
  MATTER_TYPE,
  OTHER_MATTER_TYPE,
  commit,
  firmWithProcedure,
  migratedDatabase,
  options,
  seedFirm,
} from "./support.ts";

describe("authoring a procedure", () => {
  it("creates, edits and deactivates a procedure, never deleting it", async () => {
    const database = migratedDatabase();
    seedFirm(database.raw);
    const created = await createProcedure(
      database.database,
      { name: "  Injury intake  ", description: " ", matterTypeId: MATTER_TYPE },
      options,
    );
    await commit(database.database, created.effect);
    expect(await readProcedure(database.database, created.procedureId)).toMatchObject({
      name: "Injury intake",
      description: null,
      matter_type_id: MATTER_TYPE,
      active: 1,
    });

    const edited = await editProcedure(
      database.database,
      created.procedureId,
      {
        name: "Injury intake (Nevada)",
        description: "For every PI consultation",
        matterTypeId: null,
      },
      options,
    );
    await commit(database.database, edited.effect);
    expect(await readProcedure(database.database, created.procedureId)).toMatchObject({
      name: "Injury intake (Nevada)",
      description: "For every PI consultation",
      matter_type_id: null,
    });

    const off = await setProcedureActive(database.database, created.procedureId, false, options);
    await commit(database.database, off.effect);
    expect((await readProcedure(database.database, created.procedureId))?.active).toBe(0);
    const { results } = await selectProceduresStatement(database.database, {
      limit: 10,
      includeInactive: false,
    }).all<IntakeProcedureRow>();
    expect(results).toEqual([]);
    const all = await selectProceduresStatement(database.database, {
      limit: 10,
      includeInactive: true,
    }).all<IntakeProcedureRow>();
    expect(all.results.map((row) => row.id)).toEqual([created.procedureId]);
  });

  it("refuses a second procedure wearing the same name, with a code rather than a constraint error", async () => {
    const database = await firmWithProcedure([]);
    await expect(
      createProcedure(database.database, { name: "Injury intake", matterTypeId: null }, options),
    ).rejects.toMatchObject({ code: "procedure-name-taken" });
    // Editing a procedure onto its OWN name is fine.
    await expect(
      editProcedure(
        database.database,
        database.procedureId,
        { name: "Injury intake", matterTypeId: MATTER_TYPE },
        options,
      ),
    ).resolves.toBeDefined();
  });

  it("refuses an empty name and an unknown procedure by code", async () => {
    const database = migratedDatabase();
    seedFirm(database.raw);
    await expect(
      createProcedure(database.database, { name: "   ", matterTypeId: null }, options),
    ).rejects.toMatchObject({ code: "procedure-empty-name" });
    await expect(
      setProcedureActive(
        database.database,
        "intakeProcedure_missing" as IntakeProcedureId,
        false,
        options,
      ),
    ).rejects.toMatchObject({ code: "procedure-unknown" });
  });

  it("binds a procedure to its type and to every type when bound to none, never across types", async () => {
    const database = await firmWithProcedure([]);
    const everyKind = await createProcedure(
      database.database,
      { name: "Every consultation", matterTypeId: null },
      options,
    );
    await commit(database.database, everyKind.effect);
    const injury = await readProceduresBinding(database.database, MATTER_TYPE, 10);
    expect(injury.map((row) => row.name).toSorted()).toEqual([
      "Every consultation",
      "Injury intake",
    ]);
    const estate = await readProceduresBinding(database.database, OTHER_MATTER_TYPE, 10);
    expect(estate.map((row) => row.name)).toEqual(["Every consultation"]);
    const untyped = await readProceduresBinding(database.database, null, 10);
    expect(untyped.map((row) => row.name)).toEqual(["Every consultation"]);
  });
});

describe("authoring the steps", () => {
  it("adds steps in order, defaults them to required, and retires rather than deletes", async () => {
    const database = await firmWithProcedure([
      { kind: "conflicts-check", title: "Run the conflicts check" },
      { kind: "acknowledgement", title: "Explain the fee structure", required: false },
      {
        kind: "engagement-letter",
        title: "Send the engagement letter",
        referenceId: "documentTemplate_letter",
      },
    ]);
    const steps = await readProcedureSteps(database.database, database.procedureId);
    expect(
      steps.map((step) => [step.kind, step.required, step.position, step.reference_id]),
    ).toEqual([
      ["conflicts-check", 1, 0, null],
      ["acknowledgement", 0, 1, null],
      ["engagement-letter", 1, 2, "documentTemplate_letter"],
    ]);

    const retired = await retireProcedureStep(database.database, database.stepIds[1]!, options);
    await commit(database.database, retired.effect);
    expect(
      (await readProcedureSteps(database.database, database.procedureId)).map((step) => step.id),
    ).toEqual([database.stepIds[0], database.stepIds[2]]);
    // The row is still there for the records that name it.
    expect(
      (
        await readProcedureSteps(database.database, database.procedureId, {
          includeInactive: true,
        })
      ).length,
    ).toBe(3);
  });

  it("edits every field but the kind, and refuses a reference on a kind that is about nothing", async () => {
    const database = await firmWithProcedure([
      { kind: "document", title: "Collect the police report" },
    ]);
    const stepId = database.stepIds[0]!;
    const edited = await editProcedureStep(
      database.database,
      stepId,
      {
        title: "Collect the accident report",
        instructions: "Ask for the case number",
        required: false,
        referenceId: "documentTemplate_report",
        position: 4,
      },
      options,
    );
    await commit(database.database, edited.effect);
    expect((await readProcedureSteps(database.database, database.procedureId))[0]).toMatchObject({
      kind: "document",
      title: "Collect the accident report",
      instructions: "Ask for the case number",
      required: 0,
      reference_id: "documentTemplate_report",
      position: 4,
    });
    await expect(
      addProcedureStep(
        database.database,
        database.procedureId,
        { kind: "conflicts-check", title: "Check", referenceId: "documentTemplate_x" },
        options,
      ),
    ).rejects.toMatchObject({ code: "step-reference-not-applicable" });
  });

  it("refuses an unknown kind, an empty title, an unknown step, and steps past the ceiling", async () => {
    const database = await firmWithProcedure([]);
    await expect(
      addProcedureStep(
        database.database,
        database.procedureId,
        { kind: "vibe", title: "x" },
        options,
      ),
    ).rejects.toMatchObject({ code: "step-unknown-kind" });
    await expect(
      addProcedureStep(
        database.database,
        database.procedureId,
        { kind: "acknowledgement", title: "  " },
        options,
      ),
    ).rejects.toMatchObject({ code: "step-empty-title" });
    await expect(
      retireProcedureStep(
        database.database,
        "intakeProcedureStep_missing" as IntakeProcedureStepId,
        options,
      ),
    ).rejects.toMatchObject({ code: "step-unknown" });
    for (let index = 0; index < MAX_PROCEDURE_STEPS; index += 1) {
      const added = await addProcedureStep(
        database.database,
        database.procedureId,
        { kind: "acknowledgement", title: `Step ${String(index)}` },
        options,
      );
      await commit(database.database, added.effect);
    }
    await expect(
      addProcedureStep(
        database.database,
        database.procedureId,
        { kind: "acknowledgement", title: "One too many" },
        options,
      ),
    ).rejects.toMatchObject({ code: "step-too-many" });
  });

  it("refuses a step on a deactivated procedure", async () => {
    const database = await firmWithProcedure([]);
    const off = await setProcedureActive(database.database, database.procedureId, false, options);
    await commit(database.database, off.effect);
    await expect(
      addProcedureStep(
        database.database,
        database.procedureId,
        { kind: "acknowledgement", title: "Later" },
        options,
      ),
    ).rejects.toMatchObject({ code: "procedure-inactive" });
  });

  it("accepts every kind in the catalog", async () => {
    const database = await firmWithProcedure([]);
    for (const kind of INTAKE_STEP_KINDS) {
      const added = await addProcedureStep(
        database.database,
        database.procedureId,
        { kind, title: `A ${kind} step` },
        options,
      );
      await commit(database.database, added.effect);
    }
    expect((await readProcedureSteps(database.database, database.procedureId)).length).toBe(
      INTAKE_STEP_KINDS.length,
    );
  });
});
