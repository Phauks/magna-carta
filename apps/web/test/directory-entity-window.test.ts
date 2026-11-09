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
import { formatDate } from "@magna-carta/design-system/formatters";
import {
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
    // The separator is the design system's now, so what is asserted here is the PARTS. A record
    // found by name carries no number, which is what the null reference says.
    expect(entityWindowSubtitle(person())).toEqual({
      reference: { kind: "Person", number: null },
      facts: [],
    });
    expect(entityWindowSubtitle(person({ pronouns: SHE }))).toEqual({
      reference: { kind: "Person", number: null },
      facts: ["she/her"],
    });
  });

  it("states an organization's legal name only where it differs from what the firm calls it", () => {
    expect(entityWindowSubtitle(organization())).toEqual({
      reference: { kind: "Organization", number: null },
      facts: [],
    });
    expect(entityWindowSubtitle(organization({ displayName: "Pemberton" }))).toEqual({
      reference: { kind: "Organization", number: null },
      facts: ["Pemberton Holdings, Incorporated"],
    });
  });
});

describe("the record's own facts, in the header", () => {
  it("adds the dates a person has after the pronouns, and says when a death has no date", () => {
    expect(
      entityWindowSubtitle(person({ pronouns: SHE, dateOfBirth: "1961-04-02", deceased: true })),
    ).toEqual({
      reference: { kind: "Person", number: null },
      facts: ["she/her", `Born ${formatDate("1961-04-02")}`, "Deceased"],
    });
    expect(entityWindowSubtitle(person({ dateOfDeath: "2024-01-09", deceased: true }))).toEqual({
      reference: { kind: "Person", number: null },
      facts: [`Died ${formatDate("2024-01-09")}`],
    });
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
