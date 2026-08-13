import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  ClosePrecondition,
  ClosePreconditionContext,
  ClosePreconditionFailure,
} from "@magna-carta/matters/close-preconditions";
import { format, fromMinor } from "@magna-carta/money/format";
import { currencyFromCode } from "@magna-carta/money/money";
import {
  readOpenClientCreditsForMatter,
  refuseMatterCloseWithOpenClientCreditStatement,
} from "./statements.ts";

// THE MATTER-CLOSE GATE ON MONEY THE FIRM OWES BACK. A matter does not close over an open client
// credit, and this is a hard block with no override.
//
// It is the same shape as the trust gate next to it and for a closely related reason. A client
// credit is money the firm has ALREADY CONCEDED is not its own — it exists because a correction
// outran what the client still owed, so the excess is sitting in the firm's operating account. That
// is nearer to holding somebody else's money than it is to an unpaid bill: an uncollectable
// receivable is an ordinary business outcome with a lawful exit one click away, whereas a matter
// closed over an open credit is a firm quietly keeping money it said it would give back.
//
// The refusal names the amount and the three exits, because a person told no without being told
// which of the operations on the screen is the lawful one will guess.
//
// Proven twice, at two layers, as every money rule here is:
//   this module            the named refusal a person can act on, read before the batch is built
//   the guard statement    the same question re-asked INSIDE the close batch, where the answer is
//                          the committed one — the only place a credit opened in the meantime
//                          cannot hide

export const CLIENT_CREDIT_BLOCKS_CLOSE = "client-credit-open";

const WAYS_OUT =
  "refund it from the operating account, return it to the client's trust ledger, or set it against another of this client's bills";

function display(amountMinor: number, currency: string): string {
  return format(fromMinor(amountMinor, currencyFromCode(currency)));
}

async function check(
  context: ClosePreconditionContext,
): Promise<readonly ClosePreconditionFailure[]> {
  const credits = await readOpenClientCreditsForMatter(context.database, context.matterId);
  return credits.map((credit) => ({
    code: CLIENT_CREDIT_BLOCKS_CLOSE,
    message: `this matter carries ${display(credit.remainingMinor, credit.currency)} the firm owes back to the client, opened by a credit note on ${credit.openedAt.slice(0, 10)}. A matter does not close over money the firm has conceded is not its own: ${WAYS_OUT}.`,
  }));
}

function commitGuard(context: ClosePreconditionContext): readonly SqlStatement[] {
  return [refuseMatterCloseWithOpenClientCreditStatement(context.database, context.matterId)];
}

// What the composition root registers against the matter shell's close hook, beside trust's. The
// matter shell knows nothing about money and must not: it runs whatever rules it is handed.
export const matterClientCreditClosePrecondition: ClosePrecondition = { check, commitGuard };

// There is deliberately no gate here on an UNPAID RECEIVABLE. That block is a soft one — closable
// with the override recorded — and the close hook has no override mechanism, so building it now
// would mean shipping a hard block that stopped firms closing matters over ordinary bad debt. The
// lawful exit for an uncollectable balance is a write-off, which this package composes.
