import { describe, expect, it } from "vitest";
import {
  emptyPersonDraft,
  personCreateRequest,
  personDraftRefusal,
  personDraftStarted,
  personDraftSummary,
  personDraftWarning,
  personSectionCounts,
  pronounChoiceFor,
  pronounSetForChoice,
  PRONOUNS_ANOTHER_SET,
  PRONOUNS_NOT_STATED,
} from "../src/lib/directory/person-draft.ts";

function filled() {
  const draft = emptyPersonDraft();
  draft.name = {
    prefix: "Dr.",
    given: "Margaret",
    middle: "",
    family: "Okafor",
    suffixes: ["Ph.D.", "Esq."],
  };
  draft.otherNames.push({
    id: "n1",
    prefix: "",
    given: "Margaret",
    middle: "",
    family: "Adeyemi",
    suffixes: [],
    nameRole: "maiden",
  });
  draft.pronouns = pronounSetForChoice("she");
  draft.dateOfBirth = "1978-03-14";
  draft.contacts.push(
    { id: "c1", kind: "email", address: "m.okafor@example.com", use: "work" },
    {
      id: "c2",
      kind: "telephone",
      region: "US",
      number: "(312) 555-0148",
      extension: "",
      use: "mobile",
    },
  );
  draft.identifiers.push({
    id: "i1",
    type: "ssn",
    label: "",
    number: "123-45-6789",
    username: "",
    secret: "",
  });
  draft.organizations.push({
    id: "o1",
    organizationId: "directoryOrganization_x",
    organizationName: "Okafor Actuarial LLC",
    edgeType: "employment",
    role: "Principal",
  });
  return draft;
}

describe("the draft knows what it holds", () => {
  it("counts each section for the rail and summarizes the whole for the context pane", () => {
    const draft = filled();
    expect(personSectionCounts(draft).map((section) => [section.id, section.count])).toEqual([
      ["names", 2],
      ["contact", 2],
      ["address", 0],
      ["pronouns", null],
      ["dates", 1],
      ["identifiers", 1],
      ["organizations", 1],
    ]);
    expect(personDraftSummary(draft)).toEqual([
      { label: "Names", value: "Dr. Margaret Okafor Ph.D., Esq. · 1 other name" },
      { label: "Contact", value: "1 email · 1 number" },
      { label: "Pronouns", value: "she / her / hers" },
      { label: "Dates", value: "Born 1978-03-14" },
      { label: "Identifiers", value: "1 sealed" },
      { label: "Organizations", value: "Okafor Actuarial LLC" },
    ]);
  });

  it("is refused until it has a first name, and knows when it has been started", () => {
    const draft = emptyPersonDraft();
    expect(personDraftRefusal(draft)).toBe("Give the person's first name.");
    expect(personDraftStarted(draft)).toBe(false);
    draft.name.given = "Margaret";
    expect(personDraftStarted(draft)).toBe(true);
    // A NAME, NOT TWO NAMES. A person with one name is an ordinary person, and refusing them files
    // them under a name they do not have.
    expect(personDraftRefusal(draft)).toBeUndefined();
  });

  it("warns about a missing last name rather than refusing it, and stops warning once one is given", () => {
    const draft = emptyPersonDraft();
    // Nothing to warn about yet: the panel is refusing the draft outright.
    expect(personDraftWarning(draft)).toBeNull();

    draft.name.given = "Prince";
    expect(personDraftWarning(draft)).toContain("no last name");
    expect(personDraftRefusal(draft)).toBeUndefined();

    draft.name.family = "Okafor";
    expect(personDraftWarning(draft)).toBeNull();
  });
});

describe("the pronoun dropdown", () => {
  it("names the preset a set is, or another set, or not stated", () => {
    expect(pronounChoiceFor(null)).toBe(PRONOUNS_NOT_STATED);
    expect(pronounChoiceFor(pronounSetForChoice("they"))).toBe("they");
    expect(
      pronounChoiceFor({
        subject: "ze",
        object: "zir",
        possessiveDeterminer: "zir",
        possessivePronoun: "zirs",
        reflexive: "zirself",
        verbNumber: "singular",
      }),
    ).toBe(PRONOUNS_ANOTHER_SET);
  });
});

describe("the one request", () => {
  it("carries every section, with the edge direction the type decides", () => {
    const request = personCreateRequest(filled());
    expect(request).toMatchObject({
      given: "Margaret",
      family: "Okafor",
      prefix: "Dr.",
      middle: null,
      // Several suffixes, in the one column, comma-separated — the way they are written on an
      // envelope and the way `normalizeName` already reads them.
      suffix: "Ph.D., Esq.",
      dateOfBirth: "1978-03-14",
      pronouns: { subject: "she" },
    });
    expect(request.otherNames).toEqual([
      {
        given: "Margaret",
        family: "Adeyemi",
        nameRole: "maiden",
        prefix: null,
        middle: null,
        suffix: null,
      },
    ]);
    expect(request.emails).toEqual([{ address: "m.okafor@example.com", contactUse: "work" }]);
    expect(request.phones?.[0]).toMatchObject({
      number: "+13125550148",
      contactSystem: "voice",
      countryRegionCode: "US",
    });
    expect(request.identifiers).toEqual([{ type: "ssn", number: "123-45-6789" }]);
    expect(request.organizations).toEqual([
      {
        organizationId: "directoryOrganization_x",
        edgeType: "employment",
        personIs: "from",
        role: "Principal",
      },
    ]);
    expect(request.dateOfDeath).toBeUndefined();
    expect(request.addresses).toBeUndefined();
  });
});

describe("a person who has one name", () => {
  it("sends no family name at all, rather than an empty one", () => {
    const draft = emptyPersonDraft();
    draft.name.given = "Prince";

    const request = personCreateRequest(draft);

    // Absent, not empty: the contract reads an omitted field as "there is none" and an empty string
    // as a value that cannot be a name.
    expect(request.given).toBe("Prince");
    expect("family" in request).toBe(false);
  });
});
