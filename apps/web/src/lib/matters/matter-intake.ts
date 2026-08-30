/*
 * Opening a matter, as a model.
 *
 * Opening a matter is not filling in a form. A firm that takes on work does four separable things,
 * and they are separable because a different person often does each one: it records what the work
 * IS, it records WHO the work is for, it decides WHO INSIDE THE FIRM carries it, and it clears the
 * work to be taken at all — the conflict check, and whatever money has to change hands before the
 * firm starts. Those four are the sections of the intake, and this module is what they are before
 * anything renders them.
 *
 * WHY THE MODEL IS SEPARATE FROM THE SCREEN. Every question worth arguing about here is a question
 * about data: whether a draft is complete enough to send, which member holds which seat, what a
 * conflict check would actually be run against, and exactly which fields reach the create request.
 * Answering them in pure functions is what lets them be asserted without a browser, and it keeps
 * the dialog to arranging controls.
 *
 * WHAT THE SERVER TAKES TODAY, STATED ONCE. Opening a matter is TWO writes, not one. The create
 * operation accepts a title, a starting status, an optional description, an optional matter type and
 * Location, ONE responsible member, and a client display name. The rest of the team is a second
 * operation, one write per person, and it refuses the responsible role on purpose — that fact lives
 * on the matter itself, so the accountable person cannot be recorded twice and disagree with
 * themselves. This model therefore produces both: `intakeRequest` for the matter and
 * `intakeAssignments` for the people who join it.
 *
 * Money and the conflict check are genuinely not writable from here, and for a reason worth stating
 * rather than working around: a trust deposit and an invoice are both recorded AGAINST a matter, so
 * neither can happen before one exists; and the conflict check searches directory entities, which a
 * typed client name is not. Both are rendered as real controls that cannot yet be used, saying so.
 */
import {
  ASSIGNED_ATTORNEY_ROLE,
  SUPPORT_STAFF_ROLE,
  type CreateMatterAssignmentRequest,
} from "./matter-assignments-api.ts";
import type { CreateMatterRequest } from "./matters-api.ts";

/** Which of the two starting states a matter is opened into. Closed is somewhere a matter arrives. */
export type StartingStatus = "open" | "prospective";

/** The seats a member can hold on a matter. One person holds at most one of them. */
export type TeamSeat = "responsible" | "assignedAttorney" | "supportStaff";

/** The sections the intake is walked through, in the order the work is actually done. */
export type IntakeSectionIdentifier = "matter" | "client" | "people" | "clearance";

export interface IntakeSection {
  readonly id: IntakeSectionIdentifier;
  /** The tab's own word. Title case, and short enough that five of them fit one strip. */
  readonly label: string;
}

/**
 * The sections, fixed here so the dialog cannot quietly grow a sixth.
 *
 * Conflicts and money are ONE section, deliberately. Both are clearance — questions of whether the
 * firm may take the work and on what terms — both are answered before the file is worked, and
 * neither has a server surface yet. Two tabs that are each half-empty teach the reader that tabs
 * are decoration; one tab that holds the whole gate reads as the gate it is.
 */
export const INTAKE_SECTIONS: readonly IntakeSection[] = [
  { id: "matter", label: "The Matter" },
  { id: "client", label: "Client" },
  { id: "people", label: "People" },
  { id: "clearance", label: "Conflicts & Money" },
];

/**
 * Who inside the firm carries the matter.
 *
 * One responsible attorney is the accountable person and is what the contract stores. The other two
 * lists are the rest of the team: attorneys working the file beside the responsible one, and the
 * support staff assigned to it. A matter with one lawyer on it is the exception, not the shape to
 * design for.
 */
export interface MatterTeam {
  readonly responsibleMemberId: string | null;
  readonly assignedAttorneyIds: readonly string[];
  readonly supportStaffIds: readonly string[];
}

export const EMPTY_MATTER_TEAM: MatterTeam = {
  responsibleMemberId: null,
  assignedAttorneyIds: [],
  supportStaffIds: [],
};

/** Which seat a member holds, or null when they are not on the matter at all. */
export function teamSeatOf(team: MatterTeam, memberId: string): TeamSeat | null {
  if (team.responsibleMemberId === memberId) return "responsible";
  if (team.assignedAttorneyIds.includes(memberId)) return "assignedAttorney";
  if (team.supportStaffIds.includes(memberId)) return "supportStaff";
  return null;
}

/** Everyone on the matter, responsible first — what a picker excludes from what it offers. */
export function teamMemberIds(team: MatterTeam): readonly string[] {
  return [
    ...(team.responsibleMemberId === null ? [] : [team.responsibleMemberId]),
    ...team.assignedAttorneyIds,
    ...team.supportStaffIds,
  ];
}

/**
 * Put a member in a seat.
 *
 * A person holds ONE seat, so taking a new one releases the old one first. That rule is here rather
 * than in the screen because the alternative — a member who is both the responsible attorney and an
 * assigned attorney — is a record two surfaces would then have to decide how to read, and neither
 * would be wrong to read it differently.
 *
 * Naming somebody responsible when the seat is already taken RETURNS the previous holder to no
 * seat rather than to the assigned list: being replaced as the responsible attorney is a decision
 * the firm makes, and quietly demoting somebody into a different seat would make it look automatic.
 */
export function teamAfterAssign(team: MatterTeam, memberId: string, seat: TeamSeat): MatterTeam {
  const released = teamAfterRelease(team, memberId);
  if (seat === "responsible") return { ...released, responsibleMemberId: memberId };
  if (seat === "assignedAttorney") {
    return { ...released, assignedAttorneyIds: [...released.assignedAttorneyIds, memberId] };
  }
  return { ...released, supportStaffIds: [...released.supportStaffIds, memberId] };
}

/** Take a member off the matter, whichever seat they held. */
export function teamAfterRelease(team: MatterTeam, memberId: string): MatterTeam {
  return {
    responsibleMemberId: team.responsibleMemberId === memberId ? null : team.responsibleMemberId,
    assignedAttorneyIds: team.assignedAttorneyIds.filter((id) => id !== memberId),
    supportStaffIds: team.supportStaffIds.filter((id) => id !== memberId),
  };
}

/** Everything the intake has gathered, across every section. */
export interface IntakeDraft {
  readonly title: string;
  readonly startingStatus: StartingStatus;
  /** The client's name as it should print. Chosen from the firm's existing clients, or newly named. */
  readonly clientName: string;
  readonly matterTypeId: string | null;
  readonly locationId: string | null;
  readonly description: string;
  readonly team: MatterTeam;
}

export const EMPTY_INTAKE_DRAFT: IntakeDraft = {
  title: "",
  startingStatus: "open",
  clientName: "",
  matterTypeId: null,
  locationId: null,
  description: "",
  team: EMPTY_MATTER_TEAM,
};

/** An untouched optional field is "not recorded" — a null, never an empty string. */
function orNull(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * What still stands between this draft and a matter, or null when nothing does.
 *
 * The sentence is written to be read on a disabled control's hover, so it names the missing thing
 * and stops. The order is the order the sections are walked, so a reader is sent to the earliest
 * section that is not yet answered rather than the last.
 */
export function intakeBlockedOn(draft: IntakeDraft): string | null {
  if (draft.title.trim() === "") return "A matter needs a title.";
  if (draft.team.responsibleMemberId === null) return "A matter needs a responsible attorney.";
  return null;
}

/** Which section a reader should be sent to for what is missing, or null when nothing is. */
export function intakeBlockedSection(draft: IntakeDraft): IntakeSectionIdentifier | null {
  if (draft.title.trim() === "") return "matter";
  if (draft.team.responsibleMemberId === null) return "people";
  return null;
}

/**
 * The draft narrowed to what the create operation accepts, or null when it is not ready.
 *
 * The matter NUMBER is absent and always will be: it is drawn by the firm's own counter at the
 * moment the matter opens, atomically, so that two people opening a matter at once cannot be handed
 * the same one. Offering a field for it would be offering to break that.
 */
export function intakeRequest(draft: IntakeDraft): CreateMatterRequest | null {
  const responsibleMemberId = draft.team.responsibleMemberId;
  const title = draft.title.trim();
  if (title === "" || responsibleMemberId === null) return null;
  return {
    title,
    status: draft.startingStatus,
    description: orNull(draft.description),
    matterTypeId: draft.matterTypeId,
    locationId: draft.locationId,
    responsibleMemberId,
    clientDisplayName: orNull(draft.clientName),
  };
}

/**
 * The team, as the writes that staff them onto the matter once it exists.
 *
 * The responsible attorney is deliberately absent: they are recorded on the matter itself by the
 * create operation, and the assignment operation refuses that role. Sending it would be asking the
 * server to record the same accountable person twice.
 */
export function intakeAssignments(draft: IntakeDraft): readonly CreateMatterAssignmentRequest[] {
  return [
    ...draft.team.assignedAttorneyIds.map((memberUserId) => ({
      memberUserId,
      assignmentRole: ASSIGNED_ATTORNEY_ROLE,
    })),
    ...draft.team.supportStaffIds.map((memberUserId) => ({
      memberUserId,
      assignmentRole: SUPPORT_STAFF_ROLE,
    })),
  ];
}

/**
 * What a conflict check would actually be run against.
 *
 * Derived from what the intake has genuinely captured, never from a field invented to feed it: the
 * client the firm would be acting for, and the matter's own caption, which in litigation carries the
 * other side's name inside it. Adverse parties are recorded on the matter's own Parties section
 * once the matter exists, so they join the subjects there rather than being typed into a box here
 * that nothing would store.
 */
export function conflictSubjects(draft: IntakeDraft): readonly string[] {
  const subjects: string[] = [];
  const clientName = draft.clientName.trim();
  const title = draft.title.trim();
  if (clientName !== "") subjects.push(clientName);
  if (title !== "" && title !== clientName) subjects.push(title);
  return subjects;
}

/**
 * The distinct clients the firm already has matters for, in the order they read.
 *
 * This is the whole client list the screen can honestly offer: nothing on the server publishes a
 * client directory, so the clients that exist are the ones the docket already names. Opening a
 * second matter for an existing client therefore picks them rather than re-typing them, which is
 * what stops the same client being spelled two ways across two matters.
 */
export function knownClientNames(
  matters: readonly { clientDisplayName: string | null }[],
): readonly string[] {
  const seen = new Set<string>();
  for (const matter of matters) {
    const name = matter.clientDisplayName?.trim() ?? "";
    if (name !== "") seen.add(name);
  }
  return [...seen].sort((left, right) => left.localeCompare(right));
}
