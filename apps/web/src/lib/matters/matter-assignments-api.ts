/*
 * Who else is on a matter — the assignments beside the responsible attorney.
 *
 * A matter is rarely one lawyer's. It has a responsible attorney, who is accountable and whose
 * identity is a field on the matter itself, and it has a working team: other attorneys on the file
 * and the support staff assigned to it. Those are two different kinds of fact and the contract keeps
 * them apart deliberately — the create operation takes the responsible member, and this operation
 * refuses that role precisely so the accountable person cannot be recorded twice and disagree with
 * themselves.
 *
 * AN ASSIGNMENT IS DATED, NOT A FLAG. It holds from a day and optionally until one, because staffing
 * changes and a matter's history has to be able to answer who was on it in March. Leaving both dates
 * off records a current, open-ended assignment, which is what opening a matter with a team means.
 *
 * Mirrors the matter-assignment operations in apps/api-worker/openapi/openapi.json; the transport
 * envelope lives in $lib/api/request.ts.
 */
import { requestJson, type ApiOutcome, type Page } from "$lib/api/request.ts";

/** One person's place on a matter, as the listing answers it. */
export interface MatterAssignmentRecord {
  id: string;
  matterId: string;
  memberUserId: string;
  assignmentRole: string;
  validFrom: string | null;
  validTo: string | null;
}

/**
 * What staffing somebody onto a matter needs.
 *
 * The role is the firm's own wording, matched by its letters and digits, so "Billing Attorney" and
 * "billing-attorney" are the same role. The responsible attorney is refused here.
 */
export interface CreateMatterAssignmentRequest {
  memberUserId: string;
  assignmentRole: string;
  validFrom?: string | null;
  validTo?: string | null;
}

/**
 * The working roles the intake staffs a new matter with.
 *
 * Two, deliberately, and they are the two the firm actually decides at the moment it takes work on:
 * which other attorneys are on the file, and which support staff. Everything finer — originating,
 * supervising, billing — is a distinction made later against a matter that exists, and offering all
 * of them on the intake would ask a question nobody has answered yet.
 */
export const ASSIGNED_ATTORNEY_ROLE = "Assigned Attorney";
export const SUPPORT_STAFF_ROLE = "Support Staff";

export function listMatterAssignments(
  fetchImpl: typeof fetch,
  matterId: string,
): Promise<ApiOutcome<Page<MatterAssignmentRecord>>> {
  return requestJson(fetchImpl, `/api/v1/matters/${encodeURIComponent(matterId)}/assignments`);
}

/**
 * Staff one person onto a matter.
 *
 * The idempotency key is the caller's, so a retried intake cannot staff the same person twice.
 */
export function createMatterAssignment(
  fetchImpl: typeof fetch,
  matterId: string,
  request: CreateMatterAssignmentRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(fetchImpl, `/api/v1/matters/${encodeURIComponent(matterId)}/assignments`, {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}
