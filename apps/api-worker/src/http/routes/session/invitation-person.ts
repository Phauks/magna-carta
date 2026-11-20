import { z } from "@hono/zod-openapi";
import { selectPersonStatement } from "@magna-carta/directory/statements";
import type { DirectoryPersonId } from "@magna-carta/identifiers/types";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { problemJson, type ProblemResponse } from "../../contracts/problem.ts";

// The Directory person a client invitation is for. Required for `clientOfFirm` and refused for
// `firmMember`: a portal client is always somebody the firm already has on record, so the account it
// creates is tied to that record from the start.
export const InvitationDirectoryEntityId = z
  .string()
  .regex(/^directoryPerson_[A-Za-z0-9_-]+$/)
  .optional()
  .openapi({
    description:
      "The Directory person this client invitation is for. Required when `kind` is " +
      "`clientOfFirm`; not allowed when it is `firmMember`.",
  });

// The 422 for a client invitation that does not name a person the firm has, or a staff invitation
// that names one. Null when the request is consistent. Checked before a code exists, so a refusal
// costs nothing; the database also refuses a client invitation with no person.
export async function invitationPersonProblem(
  c: Context<{ Bindings: Bindings; Variables: AppVariables }>,
  request: { kind: "firmMember" | "clientOfFirm"; directoryEntityId?: string | undefined },
): Promise<ProblemResponse<422> | null> {
  const refuse = (code: string, detail: string): ProblemResponse<422> =>
    problemJson(c, {
      type: "validation",
      status: 422,
      title: "Validation failed",
      errors: [{ path: "directoryEntityId", code, detail }],
    });
  if (request.kind === "firmMember") {
    return request.directoryEntityId === undefined
      ? null
      : refuse("not-allowed", "Leave this out when inviting staff.");
  }
  if (request.directoryEntityId === undefined) {
    return refuse("required", "Choose the person in the Directory this invitation is for.");
  }
  const { firmDatabase } = requireChokepointFirmContext(c);
  const row = await selectPersonStatement(
    firmDatabase,
    request.directoryEntityId as DirectoryPersonId,
  ).first<{ status: string; merged_into_id: string | null }>();
  if (row === null || row.status !== "active" || row.merged_into_id !== null) {
    return refuse("unknown-person", "That person isn't in the Directory.");
  }
  const existing = await c.env.DB_CONTROL.prepare(
    "SELECT 1 AS present FROM portal_membership WHERE firm_id = ?1 AND directory_entity_id = ?2",
  )
    .bind(requireChokepointFirmId(c), request.directoryEntityId)
    .first<{ present: number }>();
  if (existing !== null) {
    return refuse("already-has-access", "That person already has portal access.");
  }
  return null;
}
