# pangram-endpoint

**Stream:** AI-Text Detection — reconcile the Pangram adapter to the real v3 API.
**Started:** 2026-07-02 · **Owner:** Trevor Goldsmith

## Scope

The merged first-vendor adapter assumed a synchronous `POST /predict` on `text.api.pangram.com`.
The live docs show two surfaces: an **async** external-partner API (`text.external-api.pangram.com`:
`POST /task` → poll `GET /task/{task_id}` until `stage` is `STAGE_SUCCESS`/`STAGE_FAILED`) and a
**sync** `text.api.pangram.com/v3`. Update the adapter to support **both** behind a config switch so we
select the right one once the test key confirms which it is provisioned for. Also fix the `stage` →
provenance bug (`stage` is task lifecycle, not model version — use `version`, e.g. `"3.3"`).

## Files expected to touch

- `packages/ai-detection/src/adapters/pangram.ts` (mode switch + async submit/poll + sync path + provenance fix)
- `packages/ai-detection/src/adapters/pangram-response.ts` (parse the async submit `{task_id}` + terminal `stage`)
- `packages/ai-detection/test/pangram.test.ts`, `pangram-response.test.ts` (both flows via fake HttpClient + injected sleep)
- `apps/worker/src/routes/ai-detection.ts` + `app.ts` (mode/base-URL binding + injected real sleep)
- `apps/worker/wrangler.jsonc` (base URL var per mode)

## Deferred (not this stream)

Bulk endpoint · UI · BYO-key · billing pass-through.
