# @magna-carta/community-worker — CLAUDE.md

**Purpose.** The Cloudflare Worker that serves the community board: public reads of member-authored
posts, member writes, and platform-operator moderation. It is the only surface in the estate that
serves unauthenticated public reads of content users wrote, and it is its own deployable because of
that.

**White paper:** _Community & feedback forum_ —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md). **Spec:**
[`docs/specs/2026-08-11-community-surfaces-design.md`](../../docs/specs/2026-08-11-community-surfaces-design.md).
**Follow-on plan and what the screens need:**
[`docs/specs/2026-08-13-community-board-remaining-slices-plan.md`](../../docs/specs/2026-08-13-community-board-remaining-slices-plan.md).

## Key files / entry points

- `src/index.ts` — the `ExportedHandler`. One Hono application per isolate, cached: the rate
  limiter's counters live in it, so rebuilding it per request would reset them.
- `src/app.ts` — `createApp()`, the `Bindings` shape, the ordered gate, and every route.
- `src/route-meta.ts` — `boardRoute()`. Every route declares who may call it and what budget a write
  spends; a mutating route declared public, or with no budget, throws at registration.
- `src/session.ts` — who is asking. A control-plane `session` lookup, not an authentication library.
  Read the note at the top about how the token arrives.
- `src/board-service.ts` — the write logic: profile creation, the post-number draw and its retry,
  votes, comments, the one-write delete, and the report.
- `src/rate-limit.ts` — the per-isolate limiter and the bucket policies.
- `wrangler.jsonc` — **the binding list, which is this worker's reason to exist.** Read it before
  adding anything.

## Local rules

- **Every route is registered through `register()` in `app.ts`.** That is what attaches the gate. A
  route mounted any other way is an ungated endpoint, and `test/isolation.test.ts` counts what
  `register()` saw.
- **The gate's order is the contract:** kill switch, session, write bar, operator, rate limit. A
  request failing an earlier gate never reaches a later one. Do not move a step.
- **An operator's moderation actions are deliberately unmetered.** The moment an operator most needs
  to act is exactly the moment a member-sized budget would stop them; the platform-operator record
  is already the gate in front of those routes.
- **A non-operator asking for a moderation route gets `404`, not `403`.** The surface should not
  confirm its own existence to somebody probing for it.
- **Every response carries the board's headers**, including every error. The `noindex` is permanent
  and is not a preference — see the comment on `BOARD_HEADERS`.

## Invariants that apply here

- **This worker must never gain a third binding.** It binds the control-plane database and one
  key-value namespace. The board is cross-firm by construction, so the per-firm database boundary
  does not protect it; what replaces that boundary is the fact that a firm's own data is
  _unreachable_ from this deployable. A Durable Object namespace, a bucket, a queue or a service
  binding into `apps/worker` each undoes that. `test/isolation.test.ts` reads `wrangler.jsonc` and
  fails on a new one.
- **No Workers Cache.** The status worker caches because every byte it serves is identical for every
  reader. A board response is not — a signed-in member sees whether they voted — and the cache key
  does not include the cookie. Do not copy that configuration across.
- **A hidden post is absent, never a placeholder.** A marker over a suspected disclosure republishes
  the interesting part of it: the title, the category and the author are all still attached.
- **A response is built by `@magna-carta/community`'s projection, never assembled inline.** The
  public types have no field for a firm or an account, which is what stops a handler leaking one by
  forgetting.
- **This worker never migrates anything.** The application worker's scheduled handler is the sole
  applier of the control-plane lineage. The list in `test/support.ts` exists only so the tests run
  against the real schema.

## Gotchas

- **A separate deployable with its own build.** It is not part of `vp run build-all`, which is
  scoped to `@magna-carta/worker` — the same posture as `apps/status-worker` and `apps/scan-worker`.
- **The `COMMUNITY_KV` id in `wrangler.jsonc` is a placeholder** and must be replaced with a real
  namespace before the first deploy. The kill switch reads it; an unreachable namespace degrades to
  writes-accepted, which is the deliberate direction to fail but not the intended state.
- **`DB_CONTROL`'s id must stay identical to the one in `apps/worker/wrangler.jsonc`.** Both bind
  the same real database.
- **The rate limiter is per-isolate**, so a test that reuses one account across several cases will
  be decided by the limiter rather than by the behaviour under test. `test/board-worker.test.ts`
  mints a fresh cast per test for exactly that reason.
- **A held post returns `202`, which is a success.** Treating it as a failure tells a member their
  post did not go through when it did.
