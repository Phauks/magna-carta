# Bank feeds — design

Status: built on branch `claude/project-thread-0r7370`; owner picked the Banking screen (option B) on
2026-11-20. Decision record: `docs/decisions/pending/bank-feeds-run-on-plaid-read-only.md`.

## Goal

Show, for each of the firm's operating and trust bank accounts, what the bank holds beside what the
books hold, and which of the bank's lines the books already carry. Evidence beside the books, never a
change to them (general ledger design, _The bank feed, which is the one import that would be
legitimate_).

## Provider

|                    | Plaid                                                                                                                                                                                                                                                                                                  | Teller                                                                                                                               | MX, Finicity, Akoya |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| Price              | No public list. Third-party figure about $0.25 per account per month for Transactions ([Activepieces, Nov 2026](https://www.activepieces.com/blog/plaid-pricing-2026-cost-per-connection-and-request)); Trial plan 10 live connections free ([Plaid billing](https://plaid.com/docs/account/billing/)) | $0.30 per account per month, 100 connections free ([teller.io](https://teller.io/))                                                  | Sales call          |
| Access             | Bank APIs where offered, else the bank's sign-in                                                                                                                                                                                                                                                       | Reverse-engineered ([Open Banking Tracker](https://www.openbankingtracker.com/blog/best-open-banking-api-providers-developers-2026)) | Bank APIs           |
| Legal-software use | Clio Accounting, operating and trust ([Clio help](https://help.clio.com/hc/articles/21004158222235-Clio-Accounting-Banking))                                                                                                                                                                           | none found                                                                                                                           | none found          |

Plaid, with Teller as the fallback adapter. Plaid's own SDK is not used; the adapter calls its JSON API
with `fetch`.

## Shape

- `packages/bank-feeds`: the port, the Plaid adapter, the matching rule, the API contract, the
  per-firm statements.
- Per-firm tables: `bank_connection` (one sign-in at one bank, the sync cursor, sign-in-needed flag),
  `bank_feed_account` (one bank account, its last balances, the book account it is tied to, unique
  per book account), `bank_feed_transaction` (one bank line, the bank's id, pending flag, removed
  flag).
- Worker: `apps/api-worker/src/banking/` (engine choice, the sealed credential, the sync, the
  overview read) and `apps/api-worker/src/http/routes/banking/` (six routes, `banking:read` and
  `banking:manage`).
- Screen: `apps/web` `/banking`, Plaid Link loaded from `cdn.plaid.com` only when Connect Bank is
  pressed.

## Flow

1. Connect Bank asks for a sign-in token (`POST /api/v1/banking/sign-in-token`), opens Plaid's window,
   and hands back the public token (`POST /api/v1/banking/connections`). The Worker exchanges it,
   seals the access token, records the connection and its accounts, and syncs.
2. The firm ties each bank account to a book account (`PUT .../book-account`), or chooses not to use
   it. A book account takes one bank account at most.
3. Opening the screen (`GET /api/v1/banking`) syncs any connection older than 30 minutes, waiting at
   most 8 seconds before answering with what is stored.
4. A bank that asks for a new sign-in marks the connection; Sign In Again opens Plaid's window in
   update mode for that connection.
5. Disconnect removes the item at Plaid, deletes the sealed token, and closes the connection; the
   stored lines stay as history.

## Matching rule

`packages/bank-feeds/src/matching.ts`: same signed amount, dated within 7 days, one book entry per bank
line, closest date first, never a sum, pending lines take nothing. It decides a label only.

## Not in this slice

Webhooks; check and deposit images (Plaid does not carry them; a bank's own API would); Add to Books
pre-filling a new entry from a bank line beyond opening the entry window; operating accounts beyond
the one `operating_bank` role row until the operating bank account table lands.
