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
