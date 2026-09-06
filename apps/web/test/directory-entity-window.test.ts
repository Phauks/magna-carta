/*
 * What the entity window says before any pane is opened, pinned.
 *
 * The window is the one surface a directory record opens in, from the directory's own list and
 * from a matter alike, so its header and its context pane have to be assembled one way. Each case
 * below is a place where a quiet slip would read as a fact about a person: a pronoun set invented
 * where none was stated, a legal name printed twice, a role listed for a party who is not on the
 * matter, a capacity inferred from a role.
 */
import { describe, expect, it } from "vitest";
import {
  entityWindowFacts,
  entityWindowHeading,
  entityWindowSubtitle,
  UNREAD_RECORD_HEADING,
} from "../src/lib/directory/entity-window-model.ts";
import { partyStandingLines, standingOnMatter } from "../src/lib/matters/party-standing.ts";
import type {
  DirectoryEntityDetail,
  DirectoryOrganizationDetail,
  DirectoryPersonDetail,
  PronounSet,
} from "../src/lib/directory/directory-api.ts";
import type { MatterPartyEntry } from "../src/lib/matters/party-api.ts";

const SHE: PronounSet = {
  subject: "she",
  object: "her",
  possessiveDeterminer: "her",
  possessivePronoun: "hers",
  reflexive: "herself",
  verbNumber: "singular",
};

function person(overrides: Partial<DirectoryPersonDetail> = {}): DirectoryEntityDetail {
  return {
    kind: "person",
    person: {
      id: "directoryPerson_one",
      prefix: null,
      given: "Rosalind",
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
      legalName: "Pemberton Holdings, Incorporated",
      displayName: null,
      status: "active",
      mergedIntoId: null,
      ...overrides,
    },
  };
}

function party(overrides: Partial<MatterPartyEntry> = {}): MatterPartyEntry {
  return {
    id: "matterParty_one",
    matterId: "matter_one",
    entityId: "directoryPerson_one",
    role: "client",
    capacity: null,
    entityKind: "person",
    displayName: "Rosalind Chase",
    ...overrides,
  };
}

describe("the window's header", () => {
  it("names the record, and says what it is while the read is out", () => {
    expect(entityWindowHeading(person())).toBe("Rosalind Chase");
    expect(entityWindowHeading(null)).toBe(UNREAD_RECORD_HEADING);
  });

  it("states the kind, then only the pronouns a person stated", () => {
    expect(entityWindowSubtitle(person())).toBe("Person");
    expect(entityWindowSubtitle(person({ pronouns: SHE }))).toBe("Person · she/her");
  });

  it("states an organization's legal name only where it differs from what the firm calls it", () => {
    expect(entityWindowSubtitle(organization())).toBe("Organization");
    expect(entityWindowSubtitle(organization({ displayName: "Pemberton" }))).toBe(
      "Organization · Pemberton Holdings, Incorporated",
    );
  });
});

describe("the record's own facts", () => {
  it("lists only what the record holds", () => {
    expect(entityWindowFacts(person())).toEqual([{ label: "Kind", value: "Person" }]);
    expect(entityWindowFacts(organization())).toEqual([{ label: "Kind", value: "Organization" }]);
  });

  it("adds the dates a person has, and says when a death has no date", () => {
    expect(
      entityWindowFacts(person({ pronouns: SHE, dateOfBirth: "1961-04-02", deceased: true })),
    ).toEqual([
      { label: "Kind", value: "Person" },
      { label: "Pronouns", value: "she/her" },
      { label: "Born", value: "1961-04-02" },
      { label: "Died", value: "Date not recorded" },
    ]);
    expect(entityWindowFacts(person({ dateOfDeath: "2024-01-09", deceased: true }))).toEqual([
      { label: "Kind", value: "Person" },
      { label: "Died", value: "2024-01-09" },
    ]);
  });
});

describe("a matter's standing for a party", () => {
  it("lists one line per association the entity holds, capacity beside the role", () => {
    const parties = [
      party({ id: "a", role: "executor", capacity: "Trustee" }),
      party({ id: "b", role: "beneficiary" }),
      party({ id: "c", entityId: "directoryPerson_two", role: "client" }),
    ];
    expect(partyStandingLines(parties, "directoryPerson_one")).toEqual([
      { label: "Executor", value: "Trustee" },
      { label: "Beneficiary", value: "" },
    ]);
  });

  it("hands the window nothing for an entity that is not on the matter", () => {
    expect(standingOnMatter("Pemberton v. Hale", [party()], "directoryPerson_two")).toBeNull();
    expect(standingOnMatter("Pemberton v. Hale", [party()], "directoryPerson_one")).toEqual({
      heading: "On Pemberton v. Hale",
      lines: [{ label: "Client", value: "" }],
    });
  });
});
