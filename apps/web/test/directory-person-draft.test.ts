import { describe, expect, it } from "vitest";
import {
  emptyPersonDraft,
  personCreateRequest,
  personDraftRefusal,
  personDraftStarted,
  personDraftSummary,
  personSectionCounts,
  pronounChoiceFor,
  pronounSetForChoice,
  PRONOUNS_ANOTHER_SET,
  PRONOUNS_NOT_STATED,
} from "../src/lib/directory/person-draft.ts";

function filled() {
  const draft = emptyPersonDraft();
  draft.name = { prefix: "Dr.", given: "Margaret", middle: "", family: "Okafor", suffix: "" };
  draft.otherNames.push({
    id: "n1",
    prefix: "",
    given: "Margaret",
    middle: "",
    family: "Adeyemi",
    suffix: "",
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
      ["pronouns", null],
      ["dates", 1],
      ["identifiers", 1],
      ["organizations", 1],
    ]);
    expect(personDraftSummary(draft)).toEqual([
      { label: "Names", value: "Dr. Margaret Okafor · 1 other name" },
      { label: "Contact", value: "1 email · 1 number" },
      { label: "Pronouns", value: "she / her / hers" },
      { label: "Dates", value: "Born 1978-03-14" },
      { label: "Identifiers", value: "1 sealed" },
      { label: "Organizations", value: "Okafor Actuarial LLC" },
    ]);
  });

  it("is refused until it has a given and a family name, and knows when it has been started", () => {
    const draft = emptyPersonDraft();
    expect(personDraftRefusal(draft)).toBe("Give the person's given name and family name.");
    expect(personDraftStarted(draft)).toBe(false);
    draft.name.given = "Margaret";
    expect(personDraftStarted(draft)).toBe(true);
    expect(personDraftRefusal(draft)).toBeDefined();
    draft.name.family = "Okafor";
    expect(personDraftRefusal(draft)).toBeUndefined();
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
