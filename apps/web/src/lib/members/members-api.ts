/*
 * The firm's member roster — the read that lets a screen put a NAME to a colleague.
 *
 * Every listing in the app answers identifiers for the people on a record: a matter's responsible
 * attorney, a time entry's timekeeper, a file's uploader. Without this read a screen has exactly two
 * options for those cells, and both are wrong — print the raw `user_…` handle at a person, or print
 * nothing and say nothing. The matters list shipped doing the second.
 *
 * Un-paged on the contract, deliberately, and the reasoning is recorded where the pagination gate
 * can be argued with (tooling/lint-list-pagination/unpaged-baseline.mjs): a member row exists only
 * where somebody was added to the firm, so the roster is bounded by headcount rather than by
 * activity — and a lookup that resolves names for the rows on screen has to be whole before any row
 * renders honestly.
 *
 * Mirrors the `members.list` operation in apps/api-worker/openapi/openapi.json.
 */
import { requestJson, type ApiOutcome } from "$lib/api/request.ts";

/** One member as the firm's roster answers them. */
export interface FirmMemberSummary {
  userId: string;
  displayName: string;
  /**
   * A departed colleague is LISTED, with their status saying so. They remain the responsible
   * attorney on matters they carried; dropping them would print those cells as an unfilled gap.
   */
  status: "active" | "deactivated";
  /** The roles held — the line under the name that says whom to ask. Empty where none is held. */
  roleNames: string[];
  /** Whether a professional profile (title, admissions, signature block) has been written. */
  hasProfessionalProfile: boolean;
}

/** The permission the roster read names. A member without it is refused server-side. */
export const READ_MEMBERS_PERMISSION = "firm:readMembers";

/** The firm's members. Un-paged on the contract: a roster is bounded by the firm's headcount. */
export function listFirmMembers(
  fetchImpl: typeof fetch,
): Promise<ApiOutcome<{ data: FirmMemberSummary[] }>> {
  return requestJson(fetchImpl, "/api/v1/members");
}

/** The role line shown beside a name. Several roles read as one line, in the order held. */
export function memberRoleLine(member: FirmMemberSummary): string {
  return member.roleNames.join(", ");
}

// ---- Administering the firm's members --------------------------------------------------------
//
// Reading who is here is one thing; deciding what they may do is another, and the two are split
// across two permissions on the server for that reason. Everything below rides `firm:manageMembers`
// except the roles read, which rides the roster read — a member who can see that a colleague is an
// Attorney can see what the firm decided that means.
//
// Mirrors the `roles.list`, `members.invite`, `members.setRoles`, `members.deactivate` and
// `members.reactivate` operations in apps/api-worker/openapi/openapi.json.

/** One of the firm's roles, with what holding it means. */
export interface FirmRole {
  id: string;
  name: string;
  /** The role this one is a sub-role of, or null for a top-level role. */
  parentRoleId: string | null;
  /** The permission keys the role carries, in registry form. Empty where it carries none. */
  permissions: string[];
  /** How many ACTIVE members hold it — who a change to the role would reach. */
  memberCount: number;
}

/** The permission every act below names, bar the roles read. */
export const MANAGE_MEMBERS_PERMISSION = "firm:manageMembers";

/** The firm's roles. Un-paged on the contract: a firm has as many roles as it has authored. */
export function listFirmRoles(fetchImpl: typeof fetch): Promise<ApiOutcome<{ data: FirmRole[] }>> {
  return requestJson(fetchImpl, "/api/v1/roles");
}

/** What an invitation says: who, where to reach them, and what they arrive holding. */
export interface MemberInvitation {
  email: string;
  name: string;
  /** A role of this firm by name, or null to invite somebody who arrives holding nothing. */
  roleName: string | null;
}

/**
 * Invites a member. The person is created unverified and account-less; the activation email is a
 * password-reset link, and the credential is made when they follow it. Naming a role is what
 * decides whether they can do anything at all when they arrive.
 */
export function inviteMember(
  fetchImpl: typeof fetch,
  invitation: MemberInvitation,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string; email: string; name: string; roleName: string | null }>> {
  return requestJson(fetchImpl, "/api/v1/members", {
    method: "POST",
    body:
      invitation.roleName === null
        ? { email: invitation.email, name: invitation.name }
        : invitation,
    idempotencyKey,
  });
}

/**
 * Sets the roles a member holds, as a whole set rather than a change to it — the server diffs
 * against what they hold now. Refused when the actor is the subject, and refused when it would
 * leave the firm with nobody who can administer its members.
 */
export function setMemberRoles(
  fetchImpl: typeof fetch,
  userId: string,
  roleIds: readonly string[],
  idempotencyKey: string,
): Promise<ApiOutcome<{ userId: string; roleIds: string[] }>> {
  return requestJson(fetchImpl, `/api/v1/members/${encodeURIComponent(userId)}/roles`, {
    method: "PUT",
    body: { roleIds: [...roleIds] },
    idempotencyKey,
  });
}

/**
 * Deactivates or reactivates a member. Deactivation suspends access and keeps everything else: the
 * roster still lists them, they are still the responsible attorney on the matters they carried, and
 * a return does not mean re-granting their roles by hand.
 */
export function setMemberActive(
  fetchImpl: typeof fetch,
  userId: string,
  active: boolean,
  idempotencyKey: string,
): Promise<ApiOutcome<{ userId: string; status: "active" | "deactivated" }>> {
  const act = active ? "reactivation" : "deactivation";
  return requestJson(fetchImpl, `/api/v1/members/${encodeURIComponent(userId)}/${act}`, {
    method: "POST",
    idempotencyKey,
  });
}
