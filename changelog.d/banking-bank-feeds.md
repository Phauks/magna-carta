---
category: Added
audience: public
---

**Bank feeds and the Banking screen.** New `packages/bank-feeds` (the `BankFeedPort`, a Plaid adapter over its JSON API with no SDK, the In Books matching rule that never sums, the `/api/v1/banking/*` contract), three per-firm tables (`bank_connection`, `bank_feed_account`, `bank_feed_transaction`), six routes behind `banking:read` and `banking:manage`, and `apps/web` `/banking` with Plaid Link loaded on demand. The access token is sealed in the integration credential store and never leaves the Worker; `PLAID_CLIENT_ID`, `PLAID_SECRET` and optional `PLAID_ENVIRONMENT` come from the Secrets Store. Read only: nothing is posted from the feed.

## Public

**Banking.** Connect the firm's bank and see each operating and trust account's bank balance beside the balance in the books, with the bank's recent lines marked In Books, Not in Books or Pending. Banking only reads: nothing the bank reports goes into the books unless someone adds it.
