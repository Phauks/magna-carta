# claude/push-progress-websockets

**Branch:** `claude/push-progress-websockets` · **Started:** 2026-08-05 · **Status:** built

## Scope

Push-based job progress for the two most user-visible job coordinators, on the **Durable Objects
hibernation WebSocket API** — `ctx.acceptWebSocket()`, `webSocketMessage()`, `serializeAttachment()`,
`setWebSocketAutoResponse()`. No new dependency, and specifically **not** the Cloudflare Agents SDK:
the assessment in [`docs/research/2026-08-04-cloudflare-agents-assessment.md`](../../research/2026-08-04-cloudflare-agents-assessment.md)
found the capability the migration question was reaching for is native and GA, and that the SDK's
addition over it is ergonomic. The decision fragment records that.

- `BundleBuildCoordinator` (`apps/worker/src/downloads/`) first, then `ConversionJob`
  (`apps/worker/src/conversions/`).
- A client subscribes to a job and receives each transition as it happens — `building`/`queued`,
  `running`, and the settled state with its signed URL — instead of polling for it.
- **The polling routes stay**, unchanged in shape, as the fallback for any client that cannot hold a
  socket open. Poll and push resolve the job through one shared function per subsystem, so the two
  can never report a job differently.
- The upgrade traverses the chokepoint like any other route: session-derived firm scoping, and the
  Durable Object addressed by `${sessionFirmId}:${jobKey}` exactly as the polling routes address it.
- No client work beyond the typed message contract. The Svelte subscriber is a later slice.

## Files touched

New:

- `apps/worker/src/progress/job-progress-protocol.ts` — the wire contract (frames, keepalive bytes,
  parse).
- `apps/worker/src/progress/job-progress-sockets.ts` — the hibernation-aware socket helper both
  coordinators use.
- `apps/worker/src/downloads/bundle-progress.ts`, `apps/worker/src/conversions/conversion-progress.ts`
  — the shared poll/push state resolvers.
- `apps/worker/test/job-progress-protocol.test.ts`,
  `apps/worker/test/bundle-progress-socket.test.ts`,
  `apps/worker/test/conversion-progress-socket.test.ts`.
- `docs/decisions/pending/durable-object-native-push-progress.md`,
  `changelog.d/push-progress-websockets.md`.

Changed:

- `apps/worker/src/downloads/bundle-coordinator.ts`, `apps/worker/src/conversions/conversion-coordinator.ts`
  — subscribe entry point, message handling, broadcast on every state write.
- `apps/worker/src/routes/bundle-status.ts`, `apps/worker/src/routes/conversions.ts` — the subscribe
  routes beside the existing polls; both polls re-pointed at the shared resolver.
- `apps/worker/src/contracts/problem-types.ts` + `apps/worker/test/contracts/problem.test.ts` — the
  `websocket-upgrade-required` (426) type.
- `apps/worker/openapi/openapi.json`, `packages/api-client/src/**` — regenerated.
- `apps/worker/test/bundle-status.test.ts`, `apps/worker/test/conformance.test.ts` — the two new
  operations.
- `apps/worker/CLAUDE.md`, `docs/conventions/api.md`.

## Overlaps

`apps/worker/` is also touched by the custodian streams, but in different subsystems (`custody`,
`packages/custodian`) — no file is shared. `changelog.d/` and `docs/decisions/pending/` are
append-only fragment directories. `docs/conventions/api.md` is not claimed by any other stream.

## What is not covered

No migration was needed; the coordinator classes were already SQLite-backed, so the WebSocket support
adds no `wrangler.jsonc` migration tag. The hibernate/wake cycle itself is not exercisable in the
local test pool — see the scope notes in the two socket test files for exactly what is and is not
proven there.
