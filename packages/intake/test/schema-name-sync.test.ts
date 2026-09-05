// @repo-wide-fitness scope=schema — the statements are here, the tables they name are in
// packages/database, so the diff that renames one never touches this package.
import { getTableConfig } from "drizzle-orm/sqlite-core";
import {
  intakeProcedure,
  intakeProcedureStep,
  matterIntakeStepRecord,
} from "@magna-carta/database/per-firm-schema";
import { describe, expect, it } from "vitest";
import {
  INTAKE_PROCEDURE_STEP_TABLE,
  INTAKE_PROCEDURE_TABLE,
} from "../src/procedure-statements.ts";
import { MATTER_INTAKE_STEP_RECORD_TABLE } from "../src/record-statements.ts";
import { INTAKE_RECORD_OUTCOMES, INTAKE_STEP_KINDS } from "../src/types.ts";

// The table names the statements bind to are the schema's, and the closed vocabularies the
// statements write are the schema's CHECKs — pinned here so a rename or a widened enum on one side
// fails on the author's branch rather than at a firm's first write.
describe("intake statements name the per-firm schema's tables and vocabularies", () => {
  it("binds the three table names", () => {
    expect(INTAKE_PROCEDURE_TABLE).toBe(getTableConfig(intakeProcedure).name);
    expect(INTAKE_PROCEDURE_STEP_TABLE).toBe(getTableConfig(intakeProcedureStep).name);
    expect(MATTER_INTAKE_STEP_RECORD_TABLE).toBe(getTableConfig(matterIntakeStepRecord).name);
  });

  it("keeps the kind and outcome vocabularies in step with the schema's columns", () => {
    const kindColumn = getTableConfig(intakeProcedureStep).columns.find(
      (column) => column.name === "kind",
    );
    expect(kindColumn?.enumValues?.toSorted()).toEqual([...INTAKE_STEP_KINDS].toSorted());
    const outcomeColumn = getTableConfig(matterIntakeStepRecord).columns.find(
      (column) => column.name === "outcome",
    );
    expect(outcomeColumn?.enumValues?.toSorted()).toEqual([...INTAKE_RECORD_OUTCOMES].toSorted());
  });
});
