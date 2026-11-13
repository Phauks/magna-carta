# @magna-carta/community-worker — CLAUDE.md

**Purpose.** The deployable behind `community.magnacarta.esq` (`magna-carta-community`): the
community board's JSON API under `/api/`, its own sign-in under `/session/`, and the app's built
interface for everything else, whose reroute hook shows the board's screens on this host. It binds
the control-plane database, and the status page's KV namespace read only, for Known Issues.

**White paper:** _Community & feedback forum_ — [`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md).
**Spec:** [`docs/specs/2026-08-11-community-surfaces-design.md`](../../docs/specs/2026-08-11-community-surfaces-design.md).
The rules themselves live in [`packages/community`](../../packages/community/CLAUDE.md); this worker
only routes to them.

## Key files / entry points

- `src/index.ts` — every request reaches it first (`run_worker_first: true`): `/api/*` and
  `/session*` go to the board's application, everything else to the asset server, and every answer
  leaves with the board's headers.
- `src/board-application.ts` — the routes, the session middleware, and the write guard.
- `src/respond.ts` — the board's headers, the problem documents and the refusal wording.
- `src/known-issues.ts` — the status page's unresolved events, through `@magna-carta/status`'s public
  merge, so the board never says more than the status page does.
- `wrangler.jsonc` — the binding set and the custom domain. Read its header before adding anything.

## Local conventions

- **Reads are open; every write passes one guard** (`writeRefusal`): the board switch is `open`, the
  request's `Origin` is this host, a session cookie verifies, and the person belongs to a firm. The
  guard runs in the middleware for every non-GET under `/api/`, so a new write route is guarded by
  being added, not by remembering to call something.
- **Team actions are refused by the board service**, not here: `setStatus`, `acceptAnswer` and
  `moderate` check `isTeam` themselves. Team standing is an unexpired `platform_operator` row, read
  on every request.
- **A refusal is a problem document with a plain sentence** (`respond.ts`), the shape the app's own
  API answers with. A thrown error is logged through `@magna-carta/telemetry` and answers 500 with
  an Error ID; nothing here logs a post's text.

## Invariants that apply here

- **No per-firm binding, no bucket, no service binding into the app, and `STATUS_KV` is never
  written.** The board is the one place
  people at many firms share rows; this worker reaching a firm's database would undo the named
  exception that lets it exist (`docs/decisions/pending/the-community-board-is-a-named-exception-to-firm-scoped-data.md`).
- **`noindex` on every answer, from the first byte**, pages included. The one exception is a page
  on `changelog.magnacarta.esq`, the board's public Changelog under its own address, which names no
  person and is meant to be found; its `/api/` and `/session` answers stay unlisted. That is why every request runs
  the script, and why the header is added in `index.ts` rather than per route.
- **The session secret is never `AUTH_SECRET`.** `COMMUNITY_HANDOFF_SECRET` is shared with
  `apps/api-worker`'s `GET /api/v1/me/community-handoff` alone, so a leak here cannot forge an app
  session.
- **A handoff link works once.** `redeemHandoff` records its id in `community_session_handoff`; the
  insert's conflict is the refusal. Any failure lands the person on the board signed out with
  `?sign-in=expired`, never with a reason.

## Dependencies & contracts

- `@magna-carta/community` (rules, contract, session tokens, the switch), `@magna-carta/telemetry`
  (error logging), `hono`. The interface is `apps/web`'s build, so the build script runs the same
  WASM steps as `apps/web-worker`'s, then builds `@magna-carta/web`, before a deploy.
- The control-plane migrations are applied by `apps/api-worker`, never here. The tests apply the
  lineage themselves (`test/support/apply-migrations.ts`).

## Gotchas

- **The switch is a row, not a deploy.** `community_board_switch`, id `board`, state `open`,
  `read-only` or `off`. No row is open; an unknown word is read-only.
- **Hono adds the `__Host-` prefix** when given `prefix: "host"`; the cookie's name in code is
  `community_session`, and reading it needs the same prefix argument.
- **`APP_BASE_URL` builds the sign-in link** (`/community-sign-in` on the app), so a non-production
  deployment overrides it.
