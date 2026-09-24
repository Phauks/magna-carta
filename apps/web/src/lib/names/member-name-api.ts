/*
 * A member's own name — the read and the write behind the account profile.
 *
 * The name is held as parts and printed as one line, and the line is composed on the SERVER from
 * the parts in the same statement that stores them, so what is stored and what is printed cannot
 * disagree. A screen showing what a change WILL read as uses the same rule from the same module
 * (`renderPersonName` in @magna-carta/directory/person-name) — one renderer, two callers, never a
 * second answer to what somebody is called.
 *
 * THROUGH THE GENERATED CLIENT, which is what this module is FOR now that the operations exist in
 * it: the two calls below are `meName` and `meSetName` from @magna-carta/api-client, generated from
 * the committed contract snapshot and diff-gated against it, so a change to either operation's
 * shape breaks this file at compile time rather than at a member's screen. What is left here is the
 * thing the generated client deliberately does not do — the generated factories throw, and every
 * failure surface in this app renders a `Failure` record rather than catching — so each call is
 * turned back into the three-outcome `ApiOutcome` the profile page already renders from.
 */
import { meName, meSetName } from "@magna-carta/api-client";
import { outcomeOf } from "$lib/api/api-client.ts";
import type { ApiOutcome } from "$lib/api/request.ts";

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

export async function readMemberName(): Promise<ApiOutcome<MemberName>> {
  try {
    const { data } = await meName({ throwOnError: true });
    return { kind: "ok", value: data };
  } catch (error) {
    return outcomeOf(error);
  }
}

/**
 * Writes the whole set of parts. Refused by the server when every one of them is empty — a person
 * always has a name, and clearing it would leave every record they touched unnamed.
 */
export async function writeMemberName(parts: MemberNameParts): Promise<ApiOutcome<MemberName>> {
  try {
    const { data } = await meSetName({ body: parts, throwOnError: true });
    return { kind: "ok", value: data };
  } catch (error) {
    return outcomeOf(error);
  }
}
