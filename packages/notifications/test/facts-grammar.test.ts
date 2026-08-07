import { describe, expect, it } from "vitest";
import {
  assertFacts,
  FactsValidationError,
  validateFacts,
  validateFactsSchema,
  type FactsSchema,
} from "../src/facts-grammar.ts";

// The redaction boundary is only structural if the validator actually refuses what it claims to.
// These are the cases that matter, phrased as the mistakes somebody would really make.

describe("the declared facts grammar", () => {
  it("accepts the five value kinds a notification may carry", () => {
    const schema: FactsSchema = {
      deadlineId: { kind: "identifier" },
      dayOffset: { kind: "integer" },
      reversal: { kind: "boolean" },
      bucket: { kind: "enum", labels: ["overdue", "31-90d"] },
      raisedAt: { kind: "instant" },
      dueOn: { kind: "civilDate" },
    };
    expect(validateFactsSchema(schema)).toEqual([]);
  });

  it("refuses an enum with no labels — an open enum is a free-text field wearing a closed name", () => {
    expect(validateFactsSchema({ note: { kind: "enum", labels: [] } })).toEqual([
      "note: an enum fact declares no labels, which is a free-text field",
    ]);
  });

  it("refuses an enum whose members are sentences", () => {
    const failures = validateFactsSchema({
      reason: {
        kind: "enum",
        labels: ["the uploaded file was quarantined because its type did not match"],
      },
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("is not a short label");
  });
});

describe("the supplied facts", () => {
  const schema: FactsSchema = {
    deadlineId: { kind: "identifier" },
    dayOffset: { kind: "integer" },
  };

  it("accepts values matching the declaration", () => {
    expect(
      validateFacts(schema, { deadlineId: "matterDeadline_abc123XYZ", dayOffset: -3 }),
    ).toEqual([]);
  });

  it("REFUSES an undeclared field rather than dropping it", () => {
    // Dropping would let a materializer add a title today and have it silently ignored — which is
    // the state where somebody later "fixes" the drop and ships the disclosure.
    const failures = validateFacts(schema, {
      deadlineId: "matterDeadline_abc123XYZ",
      dayOffset: 1,
      matterTitle: "Ellison v. Braddock",
    });
    expect(failures).toEqual(["matterTitle: not declared by the type"]);
  });

  it("refuses a declared field that was not supplied", () => {
    expect(validateFacts(schema, { deadlineId: "matterDeadline_abc123XYZ" })).toEqual([
      "dayOffset: declared but not supplied",
    ]);
  });

  it("refuses a sentence where an identifier was declared", () => {
    expect(
      validateFacts(schema, {
        deadlineId: "Response to motion for summary judgment",
        dayOffset: 0,
      }),
    ).toEqual(["deadlineId: not a platform identifier"]);
  });

  it("refuses a non-canonical instant, because a variant precision reorders a text sort", () => {
    const instantSchema: FactsSchema = { at: { kind: "instant" } };
    expect(validateFacts(instantSchema, { at: "2026-08-07T02:00:00Z" })).toEqual([
      "at: not a canonical instant",
    ]);
    expect(validateFacts(instantSchema, { at: "2026-08-07T02:00:00.000Z" })).toEqual([]);
  });

  it("refuses a label the type did not declare", () => {
    const enumSchema: FactsSchema = { bucket: { kind: "enum", labels: ["overdue"] } };
    expect(validateFacts(enumSchema, { bucket: "Smith custody hearing" })).toEqual([
      "bucket: not one of the labels the type declares",
    ]);
  });

  it("assertFacts throws with the field-level failures, not a bare 'invalid'", () => {
    expect(() => assertFacts("some.kind", schema, { matterTitle: "x" })).toThrowError(
      FactsValidationError,
    );
    try {
      assertFacts("some.kind", schema, { matterTitle: "x" });
    } catch (caught) {
      expect(caught).toBeInstanceOf(FactsValidationError);
      expect((caught as FactsValidationError).failures).toContain(
        "matterTitle: not declared by the type",
      );
      expect((caught as Error).message).toContain("some.kind");
    }
  });
});
