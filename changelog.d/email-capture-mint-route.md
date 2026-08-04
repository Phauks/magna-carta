---
category: Added
---

- **Forward/CC capture addresses can now be minted, rotated, and revoked — the forward path works.**
  The email filing slice shipped the inbound Email Worker, the token index, and the capture consumer,
  but nothing that WROTE a token: the routing index stayed empty and every forwarded message bounced.
  Six routes close that gap, all behind `emails:manageCaptureAddresses` (Owner/Admin): mint and list a
  matter's capture addresses, rotate one, revoke one, and mint or revoke the firm-wide catch-all.
  Minting returns the address to forward or CC mail to — `<token>@in.magnacarta.esq` — and that is the
  only time the token is ever shown, because the token is itself the credential; lists return a
  four-character prefix and metadata.
- **Rotation replaces an over-shared address in one step.** Rotate retires the old token and returns a
  fresh one for the same matter; replaying the same `Idempotency-Key` returns that same new token
  rather than rotating twice.
- **The two halves of a capture address are written in deliberately opposite orders.** Minting commits
  the firm's address row and its outbox row in one atomic batch and lets the relay register the routing
  token, so a brand-new address exists but is briefly not yet routable — mail sent in that window
  bounces rather than landing anywhere unexpected, and the mint response says so. Revoking and
  rotating write the routing index FIRST, so a revoked address stops receiving mail the moment the
  request returns.
- **The shared per-firm job queue is now a declared consumer.** The per-firm outbox relay has always
  published to it, but nothing consumed it, so per-firm outbox effects were never applied in
  production. Deploying this requires the `magna-carta-production-platform-jobs-deadletter` queue to
  exist alongside the queue itself.
