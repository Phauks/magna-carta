/*
 * Opening a matter, pinned.
 *
 * These are the places on the intake where a quiet mistake would look right on screen and be wrong
 * in a way somebody acts on: a person holding two seats, a request that reaches the server missing
 * the one identifier it requires, a conflict check that says it searched a name it never had, and a
 * client list that offers the same client twice under two spellings.
 */
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
  knownClientNames,
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

describe("the intake's sections", () => {
  it("names each section once, in the order the work is done", () => {
    expect(INTAKE_SECTIONS.map((section) => section.id)).toEqual([
      "matter",
      "client",
      "people",
      "clearance",
    ]);
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
  it("asks for a title first and a responsible attorney second", () => {
    const empty = draft();
    expect(intakeBlockedOn(empty)).toBe("A matter needs a title.");
    expect(intakeBlockedSection(empty)).toBe("matter");

    const titled = draft({ title: "Pemberton v. Hale Construction Co." });
    expect(intakeBlockedOn(titled)).toBe("A matter needs a responsible attorney.");
    expect(intakeBlockedSection(titled)).toBe("people");
  });

  it("treats whitespace as no title at all", () => {
    expect(intakeBlockedOn(draft({ title: "   " }))).toBe("A matter needs a title.");
  });

  it("is clear once both are answered", () => {
    const ready = draft({
      title: "Pemberton v. Hale Construction Co.",
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
    clientName: "Eleanor Pemberton",
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
      clientDisplayName: "Eleanor Pemberton",
    });
    expect(request).not.toHaveProperty("matterNumber");
  });

  it("records an untouched optional field as absent, never as an empty string", () => {
    const request = intakeRequest(draft({ ...ready, clientName: "  ", description: "" }));
    expect(request?.clientDisplayName).toBeNull();
    expect(request?.description).toBeNull();
  });

  it("refuses to assemble a request that is not ready", () => {
    expect(intakeRequest(draft({ title: "A title, no attorney" }))).toBeNull();
    expect(intakeRequest(draft({ team: ready.team }))).toBeNull();
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
  it("names the client and the caption, which carries the other side", () => {
    expect(
      conflictSubjects(
        draft({ clientName: "Eleanor Pemberton", title: "Pemberton v. Hale Construction Co." }),
      ),
    ).toEqual(["Eleanor Pemberton", "Pemberton v. Hale Construction Co."]);
  });

  it("does not say it searched the same name twice", () => {
    expect(
      conflictSubjects(draft({ clientName: "Bexley Holdings LLC", title: "Bexley Holdings LLC" })),
    ).toEqual(["Bexley Holdings LLC"]);
  });

  it("has nothing to search before anything is entered", () => {
    expect(conflictSubjects(draft())).toEqual([]);
  });
});

describe("the clients the firm already has", () => {
  it("offers each client once, in reading order, skipping matters with none", () => {
    expect(
      knownClientNames([
        { clientDisplayName: "Marguerite Wren" },
        { clientDisplayName: "Eleanor Pemberton" },
        { clientDisplayName: " Eleanor Pemberton " },
        { clientDisplayName: null },
        { clientDisplayName: "   " },
      ]),
    ).toEqual(["Eleanor Pemberton", "Marguerite Wren"]);
  });
});
