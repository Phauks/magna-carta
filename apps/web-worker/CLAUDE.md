# @magna-carta/web-worker — CLAUDE.md

**Purpose.** The deployable that serves the built interface (`magna-carta-web`): the output of `apps/web`, handed back by Cloudflare's asset server, plus one small script that corrects the answers for the application's own files under `/_app/`. It holds no business logic, no data and no secrets.

**Runbook:** [`docs/conventions/operations.md`](../../docs/conventions/operations.md), the Worker roster entry for `magna-carta-web`.

## Key files / entry points

- `wrangler.jsonc` — the whole deployable: the assets directory (`../web/build`), the single-page fallback, and `run_worker_first: ["/_app/*"]`, which names the only paths that reach the script. Read its header comment before changing anything.
- `src/index.ts` — the entry point. It exports the handler and nothing else: the runtime treats every named export of an entry module as a handler and refuses to start on a constant.
- `src/answer-application-file.ts` — the work. A content-hashed file under `/_app/immutable/` gets a one-year lifetime; a file under `/_app/` that does not exist gets `404` with `no-store` instead of the application shell.
- `test/web-worker.test.ts` — plain Node tests of that function against a stand-in asset server.

## Local conventions

- **The lifetime and the guard are one change and stay together.** The single-page fallback answers a missing file with the shell and a `200`. With a long lifetime and no guard, a browser that asked for a script during a deploy would keep HTML under that script's address for a year. Never move the lifetime into `apps/web/static/_headers`, where it would apply to the fallback as well.
- **No other bindings, ever.** `ASSETS` reaches only the public files this Worker already serves. A database, bucket, queue, secret or service binding here would be reachable from a deployable that redeploys on every interface merge.
- **No routes.** The script corrects answers; it does not add any. A new endpoint belongs in `apps/api-worker`.

## Dependencies & contracts

- Builds `apps/web` first (and the WebAssembly artefacts the interface imports); see the `build` script.
- The API Worker binds the same build output for local development and as the rollback route. That copy has neither the guard nor the long lifetime, by design: it revalidates on every visit, which is slower and never wrong.

## Gotchas

- `wrangler dev` here serves `../web/build` as it stands; build `apps/web` first or it serves a stale interface.
- The asset server's response headers are immutable. Rebuild the response (`new Response(response.body, response)`) before setting a header.
- Verify a change against the real asset server, not only the unit tests: `pnpm exec wrangler dev`, then request a real file, a missing file under `/_app/`, and a page route such as `/matters`.
