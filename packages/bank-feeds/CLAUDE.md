# @magna-carta/bank-feeds — CLAUDE.md

**Purpose.** The bank feed: the port a bank-data provider sits behind, the Plaid adapter, the rule
that labels a bank line In Books or Not in Books, the Banking API contract, and the per-firm
statements over `bank_connection`, `bank_feed_account` and `bank_feed_transaction`. Pure package: no
`env`, no UI; the adapter's `fetch` is injected and the Worker picks the port
(`apps/api-worker/src/banking/bank-feed-engine.ts`).

**Spec:** [`docs/specs/2026-11-20-bank-feeds-design.md`](../../docs/specs/2026-11-20-bank-feeds-design.md).

## Key files / entry points

- `src/port.ts`: `BankFeedPort`, its four failure reasons, `unconfiguredBankFeedPort()`,
  `decimalToMinor()`
- `src/plaid.ts`: `plaidBankFeedPort(credentials, fetch)` over Plaid's JSON API
- `src/matching.ts`: `matchBankLines()` and `DATE_WINDOW_DAYS`
- `src/contract.ts`: the `/api/v1/banking/*` bodies as plain zod named with `.meta({ id })`
- `src/statements.ts`: every read and write the Worker makes on the three tables

## Local conventions

- **Positive is money in, everywhere past the adapter.** Plaid reports money out as positive; the
  adapter negates once, and nothing else may.
- **The bank's own description wins** over Plaid's cleaned-up name, because a person reads a line
  against their statement.
- **The sync cursor is written last.** A sync that fails partway re-reads the same changes next time;
  writing the cursor first would lose them.

## Invariants that apply here

- **Read only, and never over the books.** No product that moves money, and nothing here posts,
  clears or edits a ledger entry. Matching decides a label and nothing else.
- **Never sums.** A bank line matches one book entry of the same amount or none (the owner's
  reconciliation ruling).
- **The access token never leaves the Worker.** It is never logged, echoed, put in a URL or returned
  in a failure; a failure carries a reason and at most Plaid's error code. The client id and secret
  ride in the JSON body.

## Dependencies & contracts

- Depends on `@magna-carta/data-access`, `@magna-carta/identifiers` and `zod`.
- Used by `apps/api-worker` (`src/banking/`, `src/http/routes/banking/`) and, for the contract types,
  `apps/web` through the generated client.
- Secrets: `PLAID_CLIENT_ID`, `PLAID_SECRET`, optional `PLAID_ENVIRONMENT` (`sandbox`), as
  per-Worker secrets on `magna-carta-api`. A `SECRETS_STORE_PLAID_*` binding in `wrangler.jsonc` is
  added only after the store holds the secret: a binding to a missing store secret fails the deploy.
