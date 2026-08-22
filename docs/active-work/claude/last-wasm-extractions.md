---
worktree: C:/dev/magna-carta-worktrees/claude/last-wasm-extractions
area: take the last decryption and email WebAssembly imports out of the API Worker
status: building
touches: apps/api-worker/src/decryption, apps/api-worker/src/emails, apps/api-worker/src/routes/decryption.ts, apps/api-worker/src/routes/email-inspector.ts, apps/api-worker/src/wasm-modules.d.ts, apps/api-worker/openapi/openapi.json, apps/api-worker/vitest.config.ts, apps/api-worker/wrangler.jsonc, apps/api-worker/CLAUDE.md, apps/email-worker, apps/recovery-worker, containers/recovery, packages/email-filing, packages/api-client, docs/conventions/operations.md, changelog.d
---

Finishes what `claude/decryption-engine-extraction` started (this branch is based on it). Two
engines leave the API Worker:

- **`POST /api/v1/decryption/unlock`** now calls `unlockWithPassword` on the existing decryption
  port instead of the in-Worker `stripWithKey`. `containers/recovery` gains `POST /unlock`; the
  recovery worker forwards it verbatim. **The owner authorised sending the member's password over
  the service binding into the shared recovery Container**, having been told the risk twice, to
  complete the Docker removal — so the password's containment is built as an obligation, not an
  afterthought: it reaches the framed request body and nothing else (no log, no counter dimension,
  no error message, no URL, no header, no audit row), and the Container zeroes what it owns.
- **`@magna-carta/email`** moves to `apps/email-worker`, which is already the inbound mail
  entrance. The app worker reaches it over a new (commented-out, see below) `EMAIL_SERVICE` binding
  behind a port in `apps/api-worker/src/emails/`.

**The email half needs an operator step and does nothing until it happens.** `magna-carta-email`
has never been deployed and a service binding to a non-existent service fails the deploy, so
`EMAIL_SERVICE` is declared COMMENTED OUT in `apps/api-worker/wrangler.jsonc`. Until it is
uncommented the inspector route answers 503 and the capture consumer records an
`emails.captureAbandoned` audit row and ACKS — a queue, so an absent engine had to be a terminal
outcome rather than a retry storm. Nothing is deleted; the staged MIME stays for a re-run. Steps
and ordering are in `docs/conventions/operations.md`.

**`rust-wasm-build` is NOT yet removed from `build-all`,** because `@magna-carta/pdf` is still
imported by `apps/api-worker/src/assemblies/pdf-form-engine.ts` and
`apps/api-worker/src/search/text-extraction.ts`. `claude/pdf-engine-extraction` owns that half and
has not merged. When it does, that task drops out of the app Worker's build and the Docker
dependency goes with it; `apps/sign-worker` and `apps/email-worker` keep it for their own builds.

Also strips this lineage's `packages/api-client` regeneration: it carried ~657 lines of drift that
predate all of this work, so the four generated files are back at their `origin/main` state and
client freshness is left to its own reviewable pass.
