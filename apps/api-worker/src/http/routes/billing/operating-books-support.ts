import { todayInUtc } from "@magna-carta/civil-time/civil-date";
import { CostValidationError } from "@magna-carta/costs/cost-validation";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { GeneralLedgerValidationError } from "@magna-carta/general-ledger/general-ledger-validation";
import type { GeneralLedgerServiceOptions } from "@magna-carta/general-ledger/types";
import type { UserId } from "@magna-carta/identifiers/types";
import { LedgerValidationError } from "@magna-carta/ledger/validate";
import type { Context } from "hono";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import type { RouteMeta } from "../../contracts/route-meta.ts";
import { problemResponseForIdempotencyConflict } from "../../idempotency-conflict-problems.ts";

// What the operating books' two route modules share: the route meta, the problem answers, and the
// one way a write commits. ledger-accounts.ts holds the chart and the bank accounts;
// vendor-bills.ts the bills and their payments.
//
// Reading any of it rides on billing:read. Opening a bank account, editing the chart and choosing
// the accounts the app posts to ride on billing:configure, which already covered the account-role
// map. Entering, paying and reversing a vendor bill is payables:manage, because it spends the
// firm's money. Every write is idempotent and audited; every refusal is a 404 (unknown thing) or a
// 422 naming what to change.

const problem = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: Problem } },
});

export const booksErrors = {
  400: problem("Missing Idempotency-Key (this operation requires one)"),
  401: problem("No valid session"),
  403: problem("The session member lacks the capability"),
  404: problem("The account or bill is unknown"),
  409: problem("Someone else changed this first, or the Idempotency-Key is still in progress"),
  422: problem("The books refuse this"),
  429: problem("Rate limit exceeded"),
} as const;

export const booksReadErrors = {
  401: booksErrors[401],
  403: booksErrors[403],
  404: booksErrors[404],
  429: booksErrors[429],
};

export function booksReadMeta(operationId: string): RouteMeta {
  return {
    operationId,
    surface: "app",
    authenticated: true,
    permission: "billing:read",
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };
}

export function booksWriteMeta(
  operationId: string,
  permission: "billing:configure" | "payables:manage",
): RouteMeta {
  return {
    operationId,
    surface: "app",
    authenticated: true,
    permission,
    resource: "firm",
    audited: true,
    // A retried payment that posted twice would pay a vendor twice.
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

export const booksToday = (asOf: string | undefined): string => asOf ?? todayInUtc();

function serviceOptions(actorUserId: UserId): GeneralLedgerServiceOptions {
  return {
    clock: { now: () => new Date().toISOString(), today: () => todayInUtc() },
    actorUserId,
  };
}

// The words for a refusal. An unknown thing is a 404; everything else is something the person can
// change, so a 422 carrying the service's own sentence.
export function booksRefusal(c: Context, caught: unknown) {
  if (caught instanceof GeneralLedgerValidationError) {
    if (caught.code.startsWith("unknown-")) {
      return problemJson(c, {
        type: "not-found",
        title: "Not found",
        status: 404,
        detail: caught.message,
      });
    }
    return problemJson(c, {
      type: "books-refused",
      title: "The books refuse this",
      status: 422,
      detail: caught.message,
    });
  }
  if (caught instanceof LedgerValidationError || caught instanceof CostValidationError) {
    return problemJson(c, {
      type: "books-refused",
      title: "The books refuse this",
      status: 422,
      detail: caught.message,
    });
  }
  return null;
}

// A batch the database aborted (a trigger or a bounds CHECK) means someone else's write landed
// first: two payments racing for one bill's remainder, or a payment beside a reversal.
function isConstraintAbort(caught: unknown): boolean {
  const message = caught instanceof Error ? caught.message : "";
  return /constraint|CHECK|RAISE|abort|vendor bill|operating bank account/i.test(message);
}

export async function commitBooksWrite<Body>(
  c: Context,
  compose: (options: GeneralLedgerServiceOptions) => Promise<{ write: EffectWrite; body: Body }>,
) {
  const firm = requireChokepointFirmContext(c);
  const userId = requireChokepointUserId(c);
  const idempotency = requireChokepointIdempotency(c);
  let result;
  try {
    result = await runIdempotentEffect({
      database: firm.firmDatabase,
      key: idempotency.key,
      fingerprint: idempotency.fingerprint,
      now: () => new Date().toISOString(),
      effect: async () => {
        const composed = await compose(serviceOptions(userId));
        return {
          write: composed.write,
          responseCode: 201,
          responseBody: canonicalJsonStringify(composed.body),
        };
      },
    });
  } catch (caught) {
    const refused = booksRefusal(c, caught);
    if (refused) return refused;
    if (isConstraintAbort(caught)) {
      return problemJson(c, {
        type: "conflict",
        title: "Someone else changed this first",
        status: 409,
        detail: "The bill or account changed while this was being saved. Open it again and retry.",
      });
    }
    throw caught;
  }
  if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch") {
    return problemResponseForIdempotencyConflict(c, result);
  }
  if (result.kind === "replayed") c.header("Idempotency-Replayed", "true");
  return c.json(JSON.parse(result.responseBody ?? "{}") as Body, 201);
}

const today = (asOf: string | undefined) => asOf ?? todayInUtc();
