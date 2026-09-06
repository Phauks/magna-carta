/*
 * How the directory presents an entity, pinned.
 *
 * Each case below is a place where a quiet mistake would be invisible on screen and wrong in a way
 * somebody would act on: a name assembled with a gap where a person has no middle name, a pronoun
 * short form built from anything but the forms the person stated, an organization's legal name
 * printed twice, and a search sent to a record that cannot answer it.
 */
import { describe, expect, it } from "vitest";
import {
  directoryOrganizationName,
  directoryPersonName,
  entityKindLabel,
  entityRecordFromAddress,
  entityRecordHref,
  organizationLegalNameAside,
  pronounShortForm,
  searchHitKindLabel,
  UNNAMED_ENTITY,
} from "../src/lib/directory/entity-presentation.ts";
import {
  entityKindFromIdentifier,
  type DirectoryOrganizationDetail,
  type DirectoryPersonDetail,
  type PronounSet,
} from "../src/lib/directory/directory-api.ts";
import {
  isAskableQuery,
  searchableQuery,
  MINIMUM_QUERY_LENGTH,
} from "../src/lib/directory/directory-search.ts";
import {
  appendableNameRoles,
  edgeTypeLabel,
  identifierTypeLabel,
  identifierShapesFor,
  nameRoleLabel,
} from "../src/lib/directory/directory-vocabulary.ts";

function person(overrides: Partial<DirectoryPersonDetail> = {}): DirectoryPersonDetail {
  return {
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
  };
}

function organization(
  overrides: Partial<DirectoryOrganizationDetail> = {},
): DirectoryOrganizationDetail {
  return {
    id: "directoryOrganization_one",
    legalName: "Pemberton Holdings, Incorporated",
    displayName: null,
    status: "active",
    mergedIntoId: null,
    ...overrides,
  };
}

describe("a person's name", () => {
  it("assembles the recorded parts with no gap where a part is absent", () => {
    expect(directoryPersonName(person())).toBe("Marguerite Chase");
  });

  it("keeps every part the firm recorded, in reading order", () => {
    expect(directoryPersonName(person({ prefix: "Dr.", middle: "Aurelia", suffix: "III" }))).toBe(
      "Dr. Marguerite Aurelia Chase III",
    );
  });

  it("prefers the name the firm chose to render over the parts", () => {
    expect(directoryPersonName(person({ displayName: "M. Chase" }))).toBe("M. Chase");
  });

  it("states the gap rather than rendering an empty name", () => {
    expect(directoryPersonName(person({ given: null, family: null }))).toBe(UNNAMED_ENTITY);
    expect(directoryPersonName(person({ given: "  ", family: "  " }))).toBe(UNNAMED_ENTITY);
  });
});

describe("an organization's name", () => {
  it("falls back to the legal name when the firm has chosen no display name", () => {
    expect(directoryOrganizationName(organization())).toBe("Pemberton Holdings, Incorporated");
  });

  it("shows the legal name beside the display name only when the two differ", () => {
    expect(organizationLegalNameAside(organization())).toBeNull();
    expect(organizationLegalNameAside(organization({ displayName: "Pemberton" }))).toBe(
      "Pemberton Holdings, Incorporated",
    );
  });
});

describe("pronouns", () => {
  const stated: PronounSet = {
    subject: "they",
    object: "them",
    possessiveDeterminer: "their",
    possessivePronoun: "theirs",
    reflexive: "themselves",
    verbNumber: "plural",
  };

  it("builds the short form from the forms the person stated and from nothing else", () => {
    expect(pronounShortForm(stated)).toBe("they/their");
  });

  it("renders a set nothing has a lookup table for", () => {
    expect(
      pronounShortForm({
        subject: "xe",
        object: "xem",
        possessiveDeterminer: "xyr",
        possessivePronoun: "xyrs",
        reflexive: "xemself",
        verbNumber: "singular",
      }),
    ).toBe("xe/xyr");
  });
});

describe("the entity handle", () => {
  it("names the side of the directory from its own prefix", () => {
    expect(entityKindFromIdentifier("directoryPerson_abc")).toBe("person");
    expect(entityKindFromIdentifier("directoryOrganization_abc")).toBe("organization");
  });

  it("refuses anything that cannot name a directory record", () => {
    expect(entityKindFromIdentifier("matter_abc")).toBeNull();
    expect(entityKindFromIdentifier("")).toBeNull();
  });

  it("addresses a record one way: the directory, carrying which record's window to open", () => {
    expect(entityRecordHref("directoryPerson_abc")).toBe("/directory?record=directoryPerson_abc");
    expect(
      entityRecordFromAddress(new URL("https://firm.example/directory?record=directoryPerson_abc")),
    ).toBe("directoryPerson_abc");
    expect(entityRecordFromAddress(new URL("https://firm.example/directory"))).toBeNull();
    expect(entityRecordFromAddress(new URL("https://firm.example/directory?record="))).toBeNull();
  });

  it("labels both kinds, and passes an unrecognized one through as it came", () => {
    expect(entityKindLabel("person")).toBe("Person");
    expect(entityKindLabel("organization")).toBe("Organization");
    expect(searchHitKindLabel("something-else")).toBe("something-else");
  });
});

describe("what the firm's search can be asked", () => {
  it("counts the letters and digits the record will actually see", () => {
    expect(searchableQuery("  A. B.  ")).toBe("ab");
    expect(searchableQuery("O'Hara")).toBe("ohara");
  });

  it("refuses a query too short to match anything at all", () => {
    expect(isAskableQuery("ab")).toBe(false);
    expect(isAskableQuery("a. b.")).toBe(false);
    expect(isAskableQuery("abc")).toBe(true);
    expect(MINIMUM_QUERY_LENGTH).toBe(3);
  });
});

describe("the vocabularies", () => {
  it("never offers the current name as a name to append", () => {
    for (const kind of ["person", "organization"] as const) {
      expect(appendableNameRoles(kind).some((entry) => entry.role === "current")).toBe(false);
    }
  });

  it("offers each kind only the name roles that kind can hold", () => {
    const personRoles = appendableNameRoles("person").map((entry) => entry.role);
    expect(personRoles).toContain("maiden");
    expect(personRoles).not.toContain("dba");
    const organizationRoles = appendableNameRoles("organization").map((entry) => entry.role);
    expect(organizationRoles).toContain("dba");
    expect(organizationRoles).not.toContain("maiden");
  });

  it("offers each kind only the identifier types that kind can hold", () => {
    const personTypes = identifierShapesFor("person").map((entry) => entry.type);
    expect(personTypes).toContain("ssn");
    expect(personTypes).not.toContain("ein");
    const organizationTypes = identifierShapesFor("organization").map((entry) => entry.type);
    expect(organizationTypes).toContain("ein");
    expect(organizationTypes).not.toContain("ssn");
  });

  it("labels a stored code, and shows an unknown one as it came", () => {
    expect(nameRoleLabel("maiden")).toBe("Maiden");
    expect(nameRoleLabel("something-else")).toBe("something-else");
    expect(identifierTypeLabel("ein")).toBe("Employer identification number");
    expect(identifierTypeLabel("something-else")).toBe("something-else");
    expect(edgeTypeLabel("corporate_parent")).toBe("Corporate parent");
    expect(edgeTypeLabel("something-else")).toBe("something-else");
  });
});
