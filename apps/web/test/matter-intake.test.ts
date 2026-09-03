/*
 * Opening a matter, pinned.
 *
 * These are the places on the intake where a quiet mistake would look right on screen and be wrong
 * in a way somebody acts on: a person holding two seats, a request that reaches the server missing
 * the one identifier it requires, a matter created without the client every later reader derives
 * from its party link, and a conflict check that says it searched a name it never had.
 */
import type { PickableEntity } from "@magna-carta/design-system/entity-picker";
import { describe, expect, it } from "vitest";
import {
  ASSIGNED_ATTORNEY_ROLE,
  SUPPORT_STAFF_ROLE,
} from "../src/lib/matters/matter-assignments-api.ts";
import {
  conflictSubjects,
  intakeAssignments,
  intakeBlockedOn,
  intakeBlockedSection,
  intakeRequest,
  teamAfterAssign,
  teamAfterRelease,
  teamMemberIds,
  teamSeatOf,
  EMPTY_INTAKE_DRAFT,
  EMPTY_MATTER_TEAM,
  INTAKE_SECTIONS,
  type IntakeDraft,
} from "../src/lib/matters/matter-intake.ts";

function draft(overrides: Partial<IntakeDraft> = {}): IntakeDraft {
  return { ...EMPTY_INTAKE_DRAFT, ...overrides };
}

/** The client, as the directory picker hands it over. */
const PEMBERTON: PickableEntity = {
  identifier: "directoryPerson_pemberton",
  name: "Eleanor Pemberton",
  kind: "person",
};
const BEXLEY: PickableEntity = {
  identifier: "directoryOrganization_bexley",
  name: "Bexley Holdings LLC",
  kind: "organization",
};

describe("the intake's sections", () => {
  it("tabs only what genuinely takes turns: the matter, then the people who carry it", () => {
    expect(INTAKE_SECTIONS.map((section) => section.id)).toEqual(["matter", "people"]);
    expect(INTAKE_SECTIONS.map((section) => section.label)).toEqual(["Matter", "People"]);
  });

  it("keeps the client and the clearance OUT of the tabs, because both stay in view", () => {
    // Who the work is for is the fact every other answer is about, and the conflict check plus the
    // money are the gate all of it has to pass. Behind a tab, the first is a client somebody writes
    // the caption without and the second is a gate somebody has to remember to go and look at.
    const identifiers = INTAKE_SECTIONS.map((section) => section.id);
    expect(identifiers).not.toContain("client");
    expect(identifiers).not.toContain("clearance");
  });
});

describe("the team", () => {
  it("gives a member exactly one seat, releasing the one they held", () => {
    const withAssignment = teamAfterAssign(EMPTY_MATTER_TEAM, "user_okonkwo", "assignedAttorney");
    expect(teamSeatOf(withAssignment, "user_okonkwo")).toBe("assignedAttorney");

    const promoted = teamAfterAssign(withAssignment, "user_okonkwo", "responsible");
    expect(teamSeatOf(promoted, "user_okonkwo")).toBe("responsible");
    expect(promoted.assignedAttorneyIds).toEqual([]);
  });

  it("returns a replaced responsible attorney to no seat rather than demoting them quietly", () => {
    const first = teamAfterAssign(EMPTY_MATTER_TEAM, "user_osei", "responsible");
    const replaced = teamAfterAssign(first, "user_cardoza", "responsible");
    expect(replaced.responsibleMemberId).toBe("user_cardoza");
    expect(teamSeatOf(replaced, "user_osei")).toBeNull();
  });

  it("takes a member off the matter whichever seat they held", () => {
    const staffed = teamAfterAssign(EMPTY_MATTER_TEAM, "user_haddad", "supportStaff");
    expect(teamAfterRelease(staffed, "user_haddad")).toEqual(EMPTY_MATTER_TEAM);
  });

  it("lists everyone on the matter, responsible first", () => {
    let team = teamAfterAssign(EMPTY_MATTER_TEAM, "user_osei", "responsible");
    team = teamAfterAssign(team, "user_cardoza", "assignedAttorney");
    team = teamAfterAssign(team, "user_haddad", "supportStaff");
    expect(teamMemberIds(team)).toEqual(["user_osei", "user_cardoza", "user_haddad"]);
  });
});

describe("what stands between a draft and a matter", () => {
  it("asks for a title first, the client second, and a responsible attorney third", () => {
    const empty = draft();
    expect(intakeBlockedOn(empty)).toBe("A matter needs a title.");
    expect(intakeBlockedSection(empty)).toBe("matter");

    const titled = draft({ title: "Pemberton v. Hale Construction Co." });
    expect(intakeBlockedOn(titled)).toBe("A matter needs a client.");

    const withClient = draft({ ...titled, client: PEMBERTON });
    expect(intakeBlockedOn(withClient)).toBe("A matter needs a responsible attorney.");
    expect(intakeBlockedSection(withClient)).toBe("people");
  });

  it("treats whitespace as no title at all", () => {
    expect(intakeBlockedOn(draft({ title: "   " }))).toBe("A matter needs a title.");
  });

  it("needs a client whatever the starting status, and sends nobody to a tab for it", () => {
    // A prospective matter's conflict check needs a person, so there is no matter without a client.
    const titled = draft({
      title: "Pemberton v. Hale Construction Co.",
      startingStatus: "prospective",
      team: teamAfterAssign(EMPTY_MATTER_TEAM, "user_osei", "responsible"),
    });
    expect(intakeBlockedOn(titled)).toBe("A matter needs a client.");
    // The client sits on the right-hand side, in view whichever tab is open.
    expect(intakeBlockedSection(titled)).toBeNull();
  });

  it("is clear once all three are answered", () => {
    const ready = draft({
      title: "Pemberton v. Hale Construction Co.",
      client: PEMBERTON,
      team: teamAfterAssign(EMPTY_MATTER_TEAM, "user_osei", "responsible"),
    });
    expect(intakeBlockedOn(ready)).toBeNull();
    expect(intakeBlockedSection(ready)).toBeNull();
  });
});

describe("the create request", () => {
  const ready = draft({
    title: "  Pemberton v. Hale Construction Co.  ",
    startingStatus: "open",
    client: PEMBERTON,
    matterTypeId: "matterType_construction",
    locationId: "location_clark",
    description: "Defect claim over the east elevation.",
    team: teamAfterAssign(EMPTY_MATTER_TEAM, "user_osei", "responsible"),
  });

  it("carries what the contract takes, trimmed, and never a matter number", () => {
    const request = intakeRequest(ready);
    expect(request).toEqual({
      title: "Pemberton v. Hale Construction Co.",
      status: "open",
      description: "Defect claim over the east elevation.",
      matterTypeId: "matterType_construction",
      locationId: "location_clark",
      responsibleMemberId: "user_osei",
      clientEntityId: "directoryPerson_pemberton",
      clientDisplayName: "Eleanor Pemberton",
    });
    expect(request).not.toHaveProperty("matterNumber");
  });

  it("records an untouched optional field as absent, never as an empty string", () => {
    const request = intakeRequest(draft({ ...ready, description: "" }));
    expect(request?.description).toBeNull();
  });

  it("refuses to assemble a request that is not ready", () => {
    expect(intakeRequest(draft({ title: "A title, no attorney", client: PEMBERTON }))).toBeNull();
    expect(intakeRequest(draft({ team: ready.team, client: PEMBERTON }))).toBeNull();
    expect(intakeRequest(draft({ ...ready, client: null }))).toBeNull();
  });
});

describe("the writes that staff the team", () => {
  it("sends one assignment per person, with the seat's role", () => {
    let team = teamAfterAssign(EMPTY_MATTER_TEAM, "user_osei", "responsible");
    team = teamAfterAssign(team, "user_cardoza", "assignedAttorney");
    team = teamAfterAssign(team, "user_haddad", "supportStaff");
    expect(intakeAssignments(draft({ team }))).toEqual([
      { memberUserId: "user_cardoza", assignmentRole: ASSIGNED_ATTORNEY_ROLE },
      { memberUserId: "user_haddad", assignmentRole: SUPPORT_STAFF_ROLE },
    ]);
  });

  it("never sends the responsible attorney, whom the assignment operation refuses", () => {
    const team = teamAfterAssign(EMPTY_MATTER_TEAM, "user_osei", "responsible");
    expect(intakeAssignments(draft({ team }))).toEqual([]);
  });
});

describe("what a conflict check would search", () => {
  it("names the client and nothing else, because that is all the check is sent", () => {
    expect(
      conflictSubjects(draft({ client: PEMBERTON, title: "Pemberton v. Hale Construction Co." })),
    ).toEqual(["Eleanor Pemberton"]);
  });

  it("does not list the caption even when it is the client's own name", () => {
    expect(conflictSubjects(draft({ client: BEXLEY, title: "Bexley Holdings LLC" }))).toEqual([
      "Bexley Holdings LLC",
    ]);
  });

  it("has nothing to search before anything is entered", () => {
    expect(conflictSubjects(draft())).toEqual([]);
  });
});
