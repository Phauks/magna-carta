import type { TrustValidationError } from "@magna-carta/trust/trust-validation";
import type { Context } from "hono";
import { problemJson, type ProblemResponse } from "./contracts/problem.ts";

// THE code → problem mapping for the trust rules' own refusals, shared by every route that can reach
// them — the trust movement routes, and billing's apply-funds route, which composes trust's transfer
// through trust's own composer and therefore inherits every one of its refusals.
//
// It lives here rather than beside either caller for the reason the ledger mapping does: a refusal's
// HTTP status is a property of what the refusal MEANS, and two copies of that judgement drift. The
// first symptom of the drift would be one route answering 409 for a hold-blocked transfer while the
// other answered 422 for the same event.
//
// The status follows the meaning. A handle that does not resolve is a 404. A condition that may
// genuinely be different in a moment — the money is not available now, the request has already been
// decided — is a 409, because retrying against the ledger as it then stands is a real remedy.
// Everything the rules refuse about what the movement IS is a 422: the request is well-formed, and
// what it asks for is not a movement the rules permit. Nothing here maps to 500 — a refusal reaching
// this function is one the trust package made deliberately.
export function problemResponseForTrustRefusal(
  c: Context,
  error: TrustValidationError,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> {
  if (
    error.code === "unknown-trust-account" ||
    error.code === "unknown-trust-node" ||
    error.code === "unknown-trust-disbursement-request"
  ) {
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: error.message,
    });
  }
  // Available, not balance, is the ceiling: a positive balance whose disputed portion is under a hold
  // is not money the firm may take. `transfer-exceeds-available` is the same event on the earned-fee
  // path that `movement-exceeds-available` is on a disbursement.
  if (error.code === "movement-exceeds-available" || error.code === "transfer-exceeds-available") {
    return problemJson(c, {
      type: "trust-insufficient-available",
      title: "The client ledger does not have that much available",
      status: 409,
      detail: error.message,
    });
  }
  if (error.code === "trust-disbursement-request-already-decided") {
    return problemJson(c, {
      type: "trust-disbursement-not-pending",
      title: "This disbursement request has already been decided",
      status: 409,
      detail: error.message,
    });
  }
  // Not a permission failure: the member holds the trust capability, and the two-person rule is the
  // whole point of the control — they are the wrong PERSON for this particular decision.
  if (
    error.code === "trust-disbursement-decider-is-requester" ||
    error.code === "trust-disbursement-withdrawal-not-by-requester"
  ) {
    return problemJson(c, {
      type: "trust-disbursement-authorization-refused",
      title: "Another member has to make this decision",
      status: 422,
      detail: error.message,
    });
  }
  if (error.code === "jurisdiction-not-recorded" || error.code === "jurisdiction-not-encoded") {
    return problemJson(c, {
      type: "trust-jurisdiction-unavailable",
      title: "The trust account's jurisdiction cannot be resolved",
      status: 422,
      detail: error.message,
    });
  }
  // Everything else the trust rules refuse on their own terms: a commingled entry, a second client
  // on one entry, a posting aimed at a roll-up, a closed account, a currency the account does not
  // hold, a transfer to the matter it came from, an operating account that turns out to belong to a
  // trust account, a forbidden payment method, a matter with no client party to attribute the money
  // to, or an existing client ledger filed under a different client than the matter's own.
  return problemJson(c, {
    type: "trust-movement-refused",
    title: "The trust rules refuse this movement",
    status: 422,
    detail: error.message,
  });
}
