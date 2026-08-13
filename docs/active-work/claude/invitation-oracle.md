# claude/invitation-oracle

**Scope:** One security fix in the invitation-redemption handler — the refusal published a number read
off the invitation row, which turned the anonymous redemption form into a "does this code exist"
service. No new route, no new response field, no schema change.

## The defect

`POST /api/v1/invitations/redemptions` looks its row up by `code_hash` — the code alone — because a
lookup keyed on the three-fact digest could not find a row to spend an attempt against when the surname
or the date of birth was wrong. Only the verifier **comparison** uses all three facts. The neutral 422
then reported `attemptsRemaining`, derived from that row's `attempt_count`, so one request carrying a
guessed code and invented facts read back `4` (a live invitation with this code exists), `5` (no such
code, or expired/revoked/redeemed) or `0` (live and currently locked out). Five probes against a live
code also spent its whole budget and locked its real invitee out.

## What this stream changes

- The refusal is built at one call site that takes a **caller** budget and nothing else. That budget
  comes from a second `createAttemptLadder()` instance (the credential surfaces' machinery, separate
  state), keyed on the edge-set client address; `retryAfterSeconds` is that ladder's lockout.
- The invitation's own counter and lockout are **kept and made silent**, and their write now runs on
  every refusal path — against an id no row holds when there is nothing to spend — so the removed
  difference does not survive in a stopwatch.
- A caller whose own ladder is spent is refused before the lookup, which also stops a locked-out prober
  burning a real invitation's attempts.

## Files touched

- `apps/worker/src/routes/invitations.ts` — the handler, the single refusal builder, the false comment.
- `apps/worker/src/app.ts` — one line constructing the redemption ladder, one line passing it.
- `apps/worker/test/joining-enumeration.test.ts` — the comparison helper no longer exempts the budget
  fields, plus the state table (live / expired / revoked / redeemed / locked / no such code).
- `apps/worker/openapi/openapi.json`, `packages/api-client/src/types.gen.ts` — regenerated for one
  changed `description` string; no shape change.
- `docs/user/features/joining-magna-carta.md` — one added paragraph in "Tips and edge cases".
- `changelog.d/`, `docs/decisions/pending/` — fragments.

**Never edited:** `apps/web` (the redemption screens live on `claude/registration-screens`, which reads
both fields and already describes them as the caller's — no follow-up needed there), `CHANGELOG.md`,
`STATUS.md`/`STATUS.json`, the Decision-Log register, `docs/user/features/README.md`.

## Overlaps

- `claude/registration-screens` (not yet merged) builds the screens over these routes. It consumes
  `attemptsRemaining` and `retryAfterSeconds` through hand-written mirrors of the contract, and the
  response shape is unchanged, so the two merge in either order. Its screens document the fields as
  caller facts, which this change makes true.
- No other stream touches `apps/worker/src/routes/invitations.ts` or the joining tests.
