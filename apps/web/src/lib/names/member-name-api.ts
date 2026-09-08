/*
 * A member's own name — the read and the write behind the account profile.
 *
 * The name is held as parts and printed as one line, and the line is composed on the SERVER from
 * the parts in the same statement that stores them, so what is stored and what is printed cannot
 * disagree. A screen showing what a change WILL read as uses the same rule from the same module
 * (`renderPersonName` in @magna-carta/directory/person-name) — one renderer, two callers, never a
 * second answer to what somebody is called.
 *
 * Mirrors the `me.name` and `me.setName` operations in apps/api-worker/openapi/openapi.json.
 */
import { requestJson, type ApiOutcome } from "$lib/api/request.ts";

/** The five parts, each null where the person has not stated it. */
export interface MemberNameParts {
  prefix: string | null;
  given: string | null;
  middle: string | null;
  family: string | null;
  suffix: string | null;
}

export interface MemberName {
  parts: MemberNameParts;
  /** What the platform prints: the parts where they exist, else the name the account was made with. */
  displayName: string;
  /**
   * Whether the person has ever stated their parts. False means the display name is the single
   * line their account was created with, and the form may offer a reading of it for them to
   * confirm — a reading, never a stored fact.
   */
  partsStated: boolean;
}

/** The permission the write names. Seeded to every default role: one's own name is not a privilege. */
export const EDIT_OWN_PROFILE_PERMISSION = "firm:editOwnProfile";

export function readMemberName(fetchImpl: typeof fetch): Promise<ApiOutcome<MemberName>> {
  return requestJson(fetchImpl, "/api/v1/me/name");
}

/**
 * Writes the whole set of parts. Refused by the server when every one of them is empty — a person
 * always has a name, and clearing it would leave every record they touched unnamed.
 */
export function writeMemberName(
  fetchImpl: typeof fetch,
  parts: MemberNameParts,
): Promise<ApiOutcome<MemberName>> {
  return requestJson(fetchImpl, "/api/v1/me/name", { method: "PUT", body: parts });
}
