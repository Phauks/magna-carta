/*
 * The merge plan, pinned.
 *
 * A merge is the one act in the directory the product cannot take back, and every case below is a
 * way it could go wrong silently: a survivorship map that sends a choice nobody made, a field
 * presented as a decision when the two records agree, a fold in the wrong direction, and a refusal
 * the screen should have made before the server had to.
 *
 * The all-or-nothing pronoun draft is here too, because its failure mode has the same shape: a half
 * set is invisible on the page and wrong everywhere it is read.
 */
import { describe, expect, it } from "vitest";
import {
  defaultMergeChoices,
  mergePlan,
  survivorshipFrom,
  MERGE_CONSEQUENCES,
  MERGE_IRREVERSIBLE_STATEMENT,
} from "../src/lib/directory/merge-plan.ts";
import type {
  DirectoryEntityDetail,
  DirectoryOrganizationDetail,
  DirectoryPersonDetail,
} from "../src/lib/directory/directory-api.ts";
import {
  emptyPronounDraft,
  missingPronounForms,
  pronounDraftFrom,
  pronounDraftPayload,
  pronounDraftState,
} from "../src/lib/directory/pronoun-draft.ts";

function person(overrides: Partial<DirectoryPersonDetail> = {}): DirectoryEntityDetail {
  return {
    kind: "person",
    person: {
      id: "directoryPerson_one",
      prefix: null,
      given: "Marguerite",
      middle: null,
      family: "Chase",
      suffix: null,
      displayName: null,
      status: "active",
      mergedIntoId: null,
      pronouns: null,
      dateOfBirth: null,
      dateOfDeath: null,
      deceased: false,
      ...overrides,
    },
  };
}

function organization(overrides: Partial<DirectoryOrganizationDetail> = {}): DirectoryEntityDetail {
  return {
    kind: "organization",
    organization: {
      id: "directoryOrganization_one",
      legalName: "Pemberton Holdings",
      displayName: null,
      status: "active",
      mergedIntoId: null,
      ...overrides,
    },
  };
}

describe("what a merge is about to do", () => {
  const master = person({ id: "directoryPerson_master", middle: "Aurelia" });
  const subordinate = person({ id: "directoryPerson_subordinate", middle: null, family: "Chace" });

  it("names both sides in the direction the merge will run", () => {
    const plan = mergePlan(master, subordinate);
    expect(plan.masterId).toBe("directoryPerson_master");
    expect(plan.subordinateId).toBe("directoryPerson_subordinate");
    expect(plan.refusal).toBeNull();
  });

  it("marks only the fields the two records actually disagree about", () => {
    const plan = mergePlan(master, subordinate);
    const differing = plan.fields.filter((field) => field.differs).map((field) => field.column);
    expect(differing).toEqual(["name_middle", "name_family"]);
  });

  it("keeps the surviving record's value unless somebody chose otherwise", () => {
    const plan = mergePlan(master, subordinate);
    expect(survivorshipFrom(plan, defaultMergeChoices(plan))).toEqual({});
  });

  it("sends only the fields taken from the folded record", () => {
    const plan = mergePlan(master, subordinate);
    const choices = { ...defaultMergeChoices(plan), name_family: "subordinate" as const };
    expect(survivorshipFrom(plan, choices)).toEqual({ name_family: "subordinate" });
  });

  it("keys survivorship by the column names the merge endpoint accepts", () => {
    const plan = mergePlan(master, subordinate);
    expect(plan.fields.map((field) => field.column)).toEqual([
      "name_prefix",
      "name_given",
      "name_middle",
      "name_family",
      "name_suffix",
      "display_name",
    ]);
    expect(
      mergePlan(organization(), organization({ id: "directoryOrganization_two" })).fields.map(
        (field) => field.column,
      ),
    ).toEqual(["legal_name", "display_name"]);
  });

  it("treats an empty string and an absent value as the same absence", () => {
    const plan = mergePlan(
      person({ id: "directoryPerson_a", middle: "" }),
      person({ id: "directoryPerson_b" }),
    );
    const middle = plan.fields.find((field) => field.column === "name_middle");
    expect(middle?.differs).toBe(false);
    expect(middle?.masterValue).toBeNull();
  });
});

describe("the merges the screen refuses before the server has to", () => {
  it("refuses a record folded into itself", () => {
    expect(mergePlan(person(), person()).refusal).not.toBeNull();
  });

  it("refuses two different kinds of record", () => {
    expect(mergePlan(person(), organization()).refusal).not.toBeNull();
  });

  it("refuses a record that has already been folded away, on either side", () => {
    const folded = person({ id: "directoryPerson_two", mergedIntoId: "directoryPerson_three" });
    expect(mergePlan(person(), folded).refusal).not.toBeNull();
    expect(mergePlan(folded, person()).refusal).not.toBeNull();
  });
});

describe("what the confirmation has to say", () => {
  it("states that nothing is deleted, and that nothing here undoes it", () => {
    expect(MERGE_CONSEQUENCES.length).toBeGreaterThan(0);
    expect(MERGE_CONSEQUENCES.join(" ")).toContain("archived, not deleted");
    expect(MERGE_IRREVERSIBLE_STATEMENT).toContain("can't be undone");
  });

  it("carries no em dash, which the product's copy does not use", () => {
    for (const line of [...MERGE_CONSEQUENCES, MERGE_IRREVERSIBLE_STATEMENT]) {
      expect(line).not.toContain("—");
    }
  });
});

describe("a pronoun set is recorded whole or not at all", () => {
  it("treats an untouched draft as a set to clear rather than a set to record", () => {
    const draft = emptyPronounDraft();
    expect(pronounDraftState(draft)).toBe("empty");
    expect(pronounDraftPayload(draft)).toBeNull();
  });

  it("has nothing to send while the set is half written, and names what is missing", () => {
    const draft = { ...emptyPronounDraft(), subject: "she", object: "her" };
    expect(pronounDraftState(draft)).toBe("partial");
    expect(pronounDraftPayload(draft)).toBeUndefined();
    expect(missingPronounForms(draft)).toEqual([
      "Possessive determiner",
      "Possessive pronoun",
      "Reflexive",
    ]);
  });

  it("sends every form the person stated, trimmed, with the agreement they chose", () => {
    const draft = {
      subject: " she ",
      object: "her",
      possessiveDeterminer: "her",
      possessivePronoun: "hers",
      reflexive: "herself",
      verbNumber: "singular" as const,
    };
    expect(pronounDraftState(draft)).toBe("complete");
    expect(pronounDraftPayload(draft)).toEqual({
      subject: "she",
      object: "her",
      possessiveDeterminer: "her",
      possessivePronoun: "hers",
      reflexive: "herself",
      verbNumber: "singular",
    });
  });

  it("round-trips a stated set without changing a single form", () => {
    const stated = {
      subject: "they",
      object: "them",
      possessiveDeterminer: "their",
      possessivePronoun: "theirs",
      reflexive: "themselves",
      verbNumber: "plural" as const,
    };
    expect(pronounDraftPayload(pronounDraftFrom(stated))).toEqual(stated);
  });

  it("reads a person who stated none as an empty draft, never as a guess", () => {
    expect(pronounDraftState(pronounDraftFrom(null))).toBe("empty");
  });
});
