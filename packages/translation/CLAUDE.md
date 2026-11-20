# @magna-carta/translation — CLAUDE.md

**Purpose.** The translation port and its engine: the one way a piece of text is sent to be
translated, the Google Cloud Translation adapter behind it, the port a deployment with no engine
gets, and the API contract shapes of the translate and languages routes. Pure package: no `env`, no UI; the adapter's `fetch` is injected, and the Worker decides
which port a request gets (`apps/api-worker/src/translation/translation-engine.ts`).

**White paper:** _Core domain_ (documents and automation). **Spec:**
[`docs/specs/2026-08-10-translation-services-design.md`](../../docs/specs/2026-08-10-translation-services-design.md).
The owner chose Google Cloud Translation on 2026-11-19, which replaces that spec's on-platform engine
recommendation (its flag T1); the spec's other flags still stand.

## Key files / entry points

- `src/port.ts`: `TranslationPort` (`translate`, `languages`), its typed outcomes,
  `unconfiguredTranslationPort()`, and `passagesOf()`, which splits pasted text at blank lines
- `src/google.ts`: `googleTranslationPort(apiKey, fetch)` over the Basic (v2) API, and `batchesOf()`,
  which packs passages under Google's per-request limits
- `src/contract.ts`: the request and response bodies of `/api/v1/translation/*` as plain zod named with `.meta({ id })`

## Local conventions

- **Passages in, passages out, same count, same order.** The screen pairs each paragraph with its
  translation by position. An engine answer with a different count is a failure, never a best effort.
- **Never cut a passage to fit.** One over the byte ceiling is `too-long`. A sentence cut in half
  translates into something the original did not say.
- **`format: "text"` on every request.** Google's default is HTML, which turns an ampersand or a quote
  into an entity the screen would show.

## Invariants that apply here

- **The text is a client's privileged content.** Nothing here logs it, caches it or holds it between
  calls; the key goes in the `x-goog-api-key` header and the text in the body, never a URL; a
  failure's `detail` is a fixed sentence and at most a status code. The route records that a run
  happened (who, engine, languages, characters) and never what was in it.
- **Not an AI feature.** The owner ruled on 2026-11-20 that translation is its own service. It never
  reads `inference.aiProcessingEligibility` or sits in the AI settings, and there is no firm switch:
  the gate is `tools:translation`, granted per role.
- **Machine output carries no claim of accuracy.** No score, no "certified", no "verified" in any
  result or string here. The spec's _legal reality_ section says why.

## Dependencies & contracts

- Depends on `@magna-carta/data-access` (the `FirmSettingDefinition` type) and `zod`.
- Used by `apps/api-worker` (`routes/tools/translation.ts`) and the web app's Translate screen and translate button..
- The key is `GOOGLE_TRANSLATE_API_KEY`, from the Secrets Store with a per-Worker fallback; the
  runbook is `docs/conventions/operations.md`, _Google Cloud Translation_.

## Gotchas

- **Basic is global.** Google serves it from whatever region it likes; only Advanced (v3) has a
  regional endpoint, and Advanced takes a service account rather than an API key. Keeping text in one
  region is a new adapter, not a flag on this one.
- **Google bills every character sent, spaces included**, so `passagesOf` drops whitespace-only
  passages and the route counts what was actually sent.
