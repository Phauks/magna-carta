# Task 4d — packet loss by capability detection

## Files created

- `apps/worker/src/routes/tools-turn-credentials.ts`
- `apps/worker/test/tools-turn-credentials.test.ts`
- `apps/web/src/lib/tools/speed-test/turn-capability.ts`
- `apps/web/test/turn-capability.test.ts`

## Files modified

- `apps/worker/src/app.ts` — added `REALTIME_TURN_TOKEN_ID?` / `REALTIME_TURN_TOKEN_SECRET?` to `Bindings`; imported and registered `registerToolsTurnCredentialsRoute`.
- `apps/worker/openapi/openapi.json` — regenerated via `emit-openapi` (never hand-edited).
- `packages/api-client/src/*` — regenerated via `generate-client` (never hand-edited).
- `apps/web/src/lib/tools/speed-test/measurement-ladder.ts` — added `LADDER_WITH_PACKET_LOSS` alongside the unchanged `MEASUREMENT_LADDER`.
- `apps/web/src/lib/tools/speed-test/speed-test-format.ts` — restored `formatRatio`.
- `apps/web/src/lib/tools/speed-test/speed-test-engine.svelte.ts` — added `turn` state, `getPacketLoss()` on `SpeedTestResults`/`snapshotResults`; `ensureEngine(capability)` now takes the capability and builds the TURN-configured or plain option set at construction; `start()`/`restart()` both funnel through a new `beginRun()` that probes capability BEFORE building the engine; `restart()` disposes and rebuilds (ladder is a constructor-only option) instead of calling `instance.restart()`.
- `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte` — Packet loss tile now branches on `store.turn` (measured / unavailable-with-reason / not-yet-run); header comment updated to describe capability detection instead of the old "packet loss deliberately not measured" framing.
- `apps/web/test/measurement-ladder.test.ts`, `apps/web/test/speed-test-format.test.ts` — extended per plan.

## Confirmation: unconditional ladder still has no packetLoss step

`MEASUREMENT_LADDER` (the ladder used whenever `turn.available` is false or unknown) is untouched — same array, same order, no `packetLoss` entry. `LADDER_WITH_PACKET_LOSS` is a second, separate export used ONLY when `ensureEngine` receives `{ available: true }`. Guarded by two tests:

- `measurement-ladder.test.ts` → "never asks the engine to measure packet loss" (asserts `MEASUREMENT_LADDER` has no `packetLoss` step).
- `measurement-ladder.test.ts` → "adds exactly one packet-loss phase and changes nothing else" (asserts `LADDER_WITH_PACKET_LOSS` minus its one `packetLoss` step deep-equals `MEASUREMENT_LADDER`).

The engine is never told to measure packet loss without first confirming credentials are obtainable (`speed-test-engine.svelte.ts`: `beginRun()` awaits `probeTurnCapability` and only then calls `ensureEngine(turn)`, before any `engine.play()`).

## How the credentialed iceServers entry was located

`credentialsFrom()` in `tools-turn-credentials.ts` does NOT trust array position. It iterates `payload.iceServers`, and for each entry checks whether both `username` and `credential` are present and are strings — the entry without those fields (the STUN-only entry Cloudflare also returns) is skipped. Returns `null` if no entry qualifies, which the route turns into a `502` (upstream contract violated) rather than forwarding a malformed body.

## What a caller sees when secrets are absent

`GET /api/v1/tools/turn-credentials` with `REALTIME_TURN_TOKEN_ID`/`REALTIME_TURN_TOKEN_SECRET` both unset (the case in every test environment and until the owner provisions the key):

```
503 application/problem+json
{
  "type": "https://api.magnacarta.esq/problems/service-unavailable",
  "title": "Relay measurement is not configured",
  "status": 503,
  "detail": "This deployment cannot measure packet loss.",
  "errorId": "error_...",
  "correlationId": "correlation_...",
  "instance": "/api/v1/tools/turn-credentials"
}
```

No secret name, no key id, no upstream body ever appears in this response. Verified by a test that lower-cases the full response body text and asserts it contains neither `"token"` nor `"secret"`.

One deviation from the plan's literal code snippet: the plan's draft used raw `c.json({ type: "about:blank", ... }, 503)`, which (a) doesn't set the `application/problem+json` content-type Hono needs explicitly, and (b) doesn't match this codebase's actual problem-reply convention. I found the convention (`problemJson()` from `contracts/problem.ts`, using the registered `problem-types.ts` keys) is used by every other route with a 503/502 upstream-unavailable shape (`downloads.ts`, `file-repair.ts`, `file-type.ts`, `safe-browse.ts`). Rewrote both the 503 (`type: "service-unavailable"`) and 502 (`type: "internal"`, matching `safe-browse.ts`'s external-renderer-refused precedent) branches to use `problemJson` instead. This was necessary for the required `content-type: application/problem+json` assertion to pass and to match the codebase pattern the plan itself asked me to follow ("mirror tools-connection.ts... read it first").

## Commands run (abbreviated to outcomes; full logs were in-session)

- `vp test tools-turn-credentials` → FAIL (route unregistered) — confirmed the red step.
- `pnpm --filter @magna-carta/worker run emit-openapi` → wrote `apps/worker/openapi/openapi.json`.
- `pnpm run generate-client` → regenerated `packages/api-client/src/*` (5 files).
- `vp test tools-turn-credentials tools-connection openapi-snapshot` → first run: 1 failed (503 branch returned `application/json`, not `application/problem+json`) — root-caused to the raw-`c.json` snippet vs. this repo's `problemJson` convention, fixed, re-emitted, regenerated. Second run: **3 files passed, 12 tests passed.**
- `vp test turn-capability` → FAIL (module not found) — confirmed red, then PASS (6 tests) after writing the module.
- `pnpm --filter @magna-carta/web run check` → `0 ERRORS 0 WARNINGS` (svelte-check, 5377 files).
- `vp test turn-capability measurement-ladder speed-test-format speed-test-meta connection-probe quality-labels` → **6 files passed, 37 tests passed.**

No worker test run needed the `@magna-carta/decryption` wasm workaround — worker tests started cleanly both times.

## Commit hashes

- Part A: `29d1c79` — "feat(tools): short-lived relay credentials for packet-loss measurement"
- Part B: `f206ad6` — "feat(tools): measure packet loss when the relay credentials can be had"

## Concerns

1. **Deviation from the plan's literal Worker route code** (raw `c.json` for error replies → `problemJson`). Necessary for the content-type the plan's own test requires and for consistency with every other route in the codebase; flagged above with the concrete precedent files.
2. **`ensureEngine`'s in-context comment placement** — I removed `instance.restart()` from the engine's narrow type since `restart()` (the store method) now disposes and rebuilds rather than calling it, per the plan's own instruction ("restart() disposes and rebuilds"). Confirmed no other call site referenced `engine.restart()`.
3. **Owner action still outstanding** (unchanged from the plan): a Realtime TURN key must be created in the Cloudflare dashboard and `REALTIME_TURN_TOKEN_ID` / `REALTIME_TURN_TOKEN_SECRET` set as Worker secrets before packet loss is ever actually measured in any environment (including production, until that's done). Until then the capability probe always reports `not-configured` and the tile explains that.
4. Did not start a dev server or do browser verification, per instruction to stop after the Part B commit.
