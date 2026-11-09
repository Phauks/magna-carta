import type { LedgerValidationError } from "@magna-carta/ledger/validate";
import type { Context } from "hono";
import { problemJson, type ProblemResponse } from "./contracts/problem.ts";

// THE code → problem mapping for the ledger's own refusals, shared by every money route.
//
// `validateEntry` runs on every entry any of them composes — a trust deposit, a matter transfer, an
// invoice's accounts-receivable posting — and it throws `LedgerValidationError`, which is neither a
// `TrustValidationError` nor a `BillingValidationError`. Each money route module used to catch only
// its own domain's error class and rethrow everything else, so every one of these codes escaped to
// the `app.onError` boundary and became a 500 with an Error ID: a member typing next week's date, or
// 2026-02-30, was told the platform had a bug. The route contracts declare a 422 for a refused
// movement and a 404 for an unknown account, and these are exactly those cases.
//
// The status follows what the refusal MEANS, on the same principle the domain mappings use. A code
// that names something the caller can fix is a 422; a code that names a handle that does not resolve
// is a 404. Nothing here maps to 500 — a refusal reaching this function is by definition a refusal
// the ledger made deliberately, and a deliberate refusal is never a server fault.
export function problemResponseForLedgerRefusal(
  c: Context,
  error: LedgerValidationError,
): ProblemResponse<404> | ProblemResponse<422> {
  if (error.code === "unknown-account") {
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: error.message,
    });
  }
  return problemJson(c, {
    type: "ledger-entry-refused",
    title: "The ledger refuses this entry",
    status: 422,
    detail: error.message,
  });
}
