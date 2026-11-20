---
slug: bank-feeds-run-on-plaid-read-only
status: Accepted
area: Banking
date: 2026-11-20
summary: "The bank feed runs on Plaid, Transactions product only (which carries balances), read only, as evidence beside the books and never over them. The owner picked the Banking screen (option B) on 2026-11-20. Plaid's access token is sealed in the integration credential store and never reaches the browser; the client id and secret live in the Secrets Store with a Worker-secret fallback, and their store binding is added only once the store holds them, because a binding to a missing store secret fails the deploy. A bank line is marked In Books when the account's book holds an entry of the same signed amount within seven days that no other line has taken, and a match never adds entries together."
---

**The owner asked on 2026-11-20 for the bank connected "so we have accurate bank information in the
app for the various accounts", and picked the Banking screen (option B) from three mockups.**

**Context.** The general ledger design already places a bank feed as evidence, like a statement, that
lands beside the books and never over them
([`../specs/2026-08-17-general-ledger-design.md`](../specs/2026-08-17-general-ledger-design.md)). The
provider comparison is [`../specs/2026-11-20-bank-feeds-design.md`](../specs/2026-11-20-bank-feeds-design.md).

**Decision.**

- **Plaid**, because it reaches the most banks, its sign-in window keeps the bank password away from
  the platform, Clio uses it for operating and trust feeds, and its Trial plan covers ten live
  connections at no cost. Teller is the named fallback behind the same `BankFeedPort`
  (`packages/bank-feeds/src/port.ts`).
- **Read only.** Only the Transactions product. No Auth, no Transfer, no Identity. The sign-in window
  is limited to checking and savings accounts.
- **Nothing is posted from the feed.** The screen labels lines; a person adds an entry to the books
  through the ordinary entry path.
- **The secret stays in the Worker.** The browser sees a short-lived sign-in token and hands back a
  one-time public token. The access token is sealed under `bankFeed:<connection id>` and is never
  logged, echoed or put in a URL.
- **Matching never sums.** Same rule the owner gave the reconciliation screen: a sum that happens to
  agree is how a misposted deposit hides.
- **Refreshed when the screen is opened**, at most every 30 minutes per connection, because balance
  reads are billed per call. Plaid webhooks are a later step.

**Consequences.** A firm's bank transaction descriptions are stored per firm
(`bank_feed_transaction`), with the description registered as personal data. A bank that asks for a
new sign-in shows Sign In Again; nothing else stops. Check images are not available through Plaid and
need a bank's own API.
