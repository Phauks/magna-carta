/*
 * The roles a participant is offered, and what a typed one settles to.
 *
 * The control is the product's dropdown-with-add, so the vocabulary is a SUGGESTION and never a
 * gate: the record's column is free text because the roles a practice needs do not close. What the
 * offered list is actually for is that the twenty roles a firm writes over and over get written the
 * same way each time, and that is what these assert — the list's order (a vocabulary ordered by
 * whoever thought of each entry has no order at all) and the collapse onto an offered spelling.
 */
import { describe, expect, it } from "vitest";
import {
  PARTICIPANT_ROLE_OPTIONS,
  settledParticipantRole,
} from "$lib/calendar/calendar-vocabulary.ts";

describe("the offered roles", () => {
  it("are alphabetical, so an addition cannot land in the middle unnoticed", () => {
    expect([...PARTICIPANT_ROLE_OPTIONS]).toEqual([...PARTICIPANT_ROLE_OPTIONS].toSorted());
  });

  it("hold no two spellings of one role", () => {
    const lowered = PARTICIPANT_ROLE_OPTIONS.map((role) => role.toLowerCase());
    expect(new Set(lowered).size).toBe(PARTICIPANT_ROLE_OPTIONS.length);
  });

  it("read as a person writes them, capitalized once", () => {
    for (const role of PARTICIPANT_ROLE_OPTIONS) {
      expect(role).toBe(role.trim());
      expect(role.charAt(0)).toBe(role.charAt(0).toUpperCase());
    }
  });

  it("cover the roles the schema itself names as the ordinary ones", () => {
    // The per-firm schema's own examples for this column. If the list stops offering one of them,
    // the field has stopped covering the cases it was built for.
    for (const named of [
      "Appearing counsel",
      "Judge",
      "Court reporter",
      "Witness",
      "Interpreter",
    ]) {
      expect(PARTICIPANT_ROLE_OPTIONS).toContain(named);
    }
  });
});

describe("what a typed role settles to", () => {
  it("collapses any casing onto the offered spelling", () => {
    expect(settledParticipantRole("court reporter")).toBe("Court reporter");
    expect(settledParticipantRole("COURT REPORTER")).toBe("Court reporter");
    expect(settledParticipantRole("Court Reporter")).toBe("Court reporter");
  });

  it("collapses around the whitespace somebody typed as well", () => {
    expect(settledParticipantRole("  judge  ")).toBe("Judge");
  });

  it("keeps a role the list does not offer, exactly as written", () => {
    // The reason this is a dropdown-WITH-ADD: the roles a practice needs do not close.
    expect(settledParticipantRole("Rule 30(b)(6) designee")).toBe("Rule 30(b)(6) designee");
    expect(settledParticipantRole("special master")).toBe("special master");
  });

  it("trims an unlisted role rather than storing the spacing", () => {
    expect(settledParticipantRole("  Parenting coordinator ")).toBe("Parenting coordinator");
  });

  it("answers an empty field with nothing, not with a guess", () => {
    expect(settledParticipantRole("")).toBe("");
    expect(settledParticipantRole("   ")).toBe("");
  });
});
