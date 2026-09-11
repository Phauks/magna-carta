# AI Search filter-semantics wall experiment — slice 0, local half

**Date:** 2026-08-07
**Status:** **E1 and E2 remain OPEN. The retrieval route stays behind its gate.** This record closes
the half of slice 0 that can be closed without a Cloudflare account — the protocol itself, its
sensitivity, and our own side's filter construction and delete/re-index discipline — and hands the
live half over as a runnable checklist with pass/fail criteria. Nothing here is a substitute for the
live run, and nothing below blurs which claims are proven and which are deferred.
**Governing design:**
[`../specs/2026-08-06-ai-search-integration-design.md`](../specs/2026-08-06-ai-search-integration-design.md)
(experiment protocol in section 4.2; refusal rule stated there and restated here: if E1 or E2 fails,
the feature does not ship, in any reduced form).
**Harness (runnable):** `packages/search/test/natural-language-filter-wall/` — runs in the ordinary
suite (`pnpm test packages/search`), touches no production route, port, schema, or export.

---

## 1. Why this ran now, and what changed since the design merged

The design merged with owner flag A6 recommending that no real firm be enabled before Cloudflare takes
AI Search to general availability. The owner's 2026-08-07 docket session **overrode A6**: enablement
now gates only on the firm's versioned disclosure acknowledgement, not on Cloudflare GA
([`../decisions/0255-owner-docket-2026-08-07.md`](../decisions/0255-owner-docket-2026-08-07.md)).
That removes the calendar slack the experiment was implicitly borrowing — a firm can now be enabled as
soon as slice 1 ships and the disclosure is acknowledged — so proving the filter's semantics moved
from "before GA" to "before the retrieval route merges," which is the gate the plan already states.
This run was executed in an environment with **no Cloudflare credentials**, so the live half (a fenced
account, a real instance, the real binding) could not be exercised; the local half was completed
instead, and the live half is specified below to the level of exact requests and exact pass/fail
readings so it can be run on first deploy without re-deriving anything.

## 2. What is proven, and what is not — the line, drawn first

**Proven locally (34 tests, all passing, deterministic):**

1. **The probe protocol is faithful and sensitive.** The exclusion probe (E1's shape) and the
   fail-open probe (E2's shape) run as written against a reference model of the documented filter
   semantics — and, decisively, they **detect every failure shape they exist to find** when run
   against deliberately broken engine variants: a filter accepted-and-ignored, an unknown field
   silently dropped, a malformed filter silently discarded, a delete that never lands, and a response
   cache keyed on query text that bleeds hits across matter scopes. A probe suite that can only pass
   was worth nothing; this one demonstrably fails when it should.
2. **Our filter construction is pinned.** The matter-scoped filter serializes to exactly two `$eq`
   conditions on declared fields with server-derived values — byte-pinned in a fixture — and the
   builder's signature admits a branded matter identifier and nothing else, so no request field has a
   pathway into a filter value.
3. **The feed layout and attribution are pinned.** `ai-search/{matterId}/{fileId}/{version}.md` is a
   byte-pinned contract; the matter is recovered from a hit's object key by parsing, round-trips
   correctly, and any key that does not parse as a feed key is refused attribution (and therefore
   dropped) rather than guessed at.
4. **The delete/re-index discipline holds on our side.** Deletion is planned from the catalog, never
   from a listing; a re-run converges; matter reassignment is delete-old-key-plus-write-new-key;
   reconciliation reports both disagreement directions loudly — including a recorded-but-unexecuted
   delete; and the survivor step (only hits with a live catalog row are hydrated) keeps a removed
   document out of results **even against an index whose deletes never land**. That last property is
   what makes managed-index deletion latency a freshness problem rather than a disclosure problem.

**Not proven, cannot be proven here, and explicitly deferred to the live run:**

- Whether the **live** service's metadata filter excludes cross-matter hits under adversarial verbatim
  queries (E1 proper).
- Whether the **live** service fails closed on a nonexistent value and errors — rather than silently
  ignoring — on an unknown field or a malformed filter (E2 proper).
- Everything E3 through E8 measures: disjunction shapes, similarity-cache bleed, deletion latency,
  schema-change cost, R2 prefix restriction, sync latency, and retrieval quality on legal prose.

The reference model encodes the semantics the documentation describes and our design assumes. Passing
against it proves our protocol and our discipline are coherent — it proves nothing about Cloudflare's
implementation, which is precisely the open question. **No slice 1 retrieval route merges until
section 4 below has been executed against the real binding and both verdicts read PASS.**

## 3. The harness, and how the live run reuses it

Everything runs through one seam, `WallProbeEngine`
(`packages/search/test/natural-language-filter-wall/reference-engine.ts`): the probes take any
implementation of `search(request)`. Locally that is the reference model; on the live run it is a thin
adapter over the real `ai_search` binding (map `query`/`filters`/`max_num_results`/`match_threshold`
onto the binding's search call, map the response's per-hit object keys back onto `EngineHit`). The
protocol, the fixtures, the request shapes, and the verdict evaluation are then **identical** locally
and live — the live run replays this code, it does not reimplement it.

| File                         | What it carries                                                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `filter-construction.ts`     | Declared schema (closed, four fields), the two-key matter-scoped filter, feed key layout, metadata stamp                      |
| `synthetic-corpus.ts`        | Deterministic fixture corpus: matters A/B at 1,000 documents, C at 1, unique verbatim passages, planted shared nonsense token |
| `reference-engine.ts`        | The documented-semantics reference model, the filter validator, and the five broken variants                                  |
| `protocol.ts`                | The exclusion probe and fail-open probe as runnable protocol with structured verdicts                                         |
| `feed-catalog-discipline.ts` | The feed catalog model: catalog-driven deletion, reassignment plans, reconciliation                                           |
| `*.test.ts` (three files)    | 34 tests: pinned contracts, fixture self-checks, probe runs, sensitivity demonstrations, delete discipline                    |

Local run of record (2026-08-07): `pnpm test packages/search` — **8 files, 64 tests, 64 passing**
(34 in this harness, 30 pre-existing in the package, untouched).

## 4. The live verification checklist — must run on a fenced account before the retrieval route merges

Setup per the design and plan: a fenced Cloudflare account holding no firm data; a synthetic bucket
laid out exactly as the feed (`ai-search/{matterId}/{fileId}/{version}.md`, four metadata fields
stamped at put time — reuse `generateSyntheticCorpus()` to produce the objects); one instance created
with the design's full configuration (`@cf/baai/bge-large-en-v1.5`, hybrid indexing, 1-hour sync, the
four-field schema, query rewriting off, reranking on, no generation model, no public endpoint,
similarity cache off); the create call and its response recorded verbatim. Bucket deleted and instance
destroyed at the end regardless of outcome.

Each item below is a sub-question with its exact request and its exact pass/fail reading. "Reading"
means the structured verdict the protocol emits — run the probes through the live adapter and record
the verdict objects whole.

**E1 — single-key exclusion (gate).**

| #    | Sub-question                                                                                     | Protocol                                                                                                                                                                                                                           | PASS iff                                                                                                                                        |
| ---- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| E1.a | Does the two-key `$eq` filter exclude out-of-scope documents under maximum adversarial pressure? | `runCrossMatterExclusionProbe(liveAdapter, corpus)` — 1,000 queries, each the verbatim passage of a matter-B document, filter `{matter:{$eq:A}, object_class:{$eq:"working-document"}}`, `max_num_results` 50, `match_threshold` 0 | `offendingHits` is empty across all 1,000 queries. **One** hit resolving outside matter A is FAIL.                                              |
| E1.b | Does a well-formed scoped query even work? (Guards against a vacuous E1.a)                       | Same run                                                                                                                                                                                                                           | `engineErrors` is empty and `hitsExamined > 0` — an erroring or empty-scoped engine makes E1.a inconclusive, which is FAIL, not pass.           |
| E1.c | Are all returned pointers attributable?                                                          | Same run                                                                                                                                                                                                                           | Every hit's object key parses as a feed key (`resolvedMatter` never `undefined` in an offending-hit record). An unattributable pointer is FAIL. |

**E2 — fail-open probe (gate).**

| #    | Sub-question                                                      | Protocol                                                                                                    | PASS iff                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E2.a | Nonexistent filter value                                          | `runFailOpenProbe(liveAdapter, corpus)` — same 1,000 queries, filter on a matter handle that exists nowhere | `nonexistentValue.behavior` is `returned-zero-hits` on every query. Hits of any kind is FAIL; an error is also FAIL (a well-formed filter must not error, or availability wobbles become invisible scope wobbles).                                                                                                                                                                                                                                                 |
| E2.b | Unknown field (`practice_group`, absent from the declared schema) | Same run                                                                                                    | `unknownField.behavior` is `errored` on **every** query. `accepted-and-ignored` is the disqualifying observation. `returned-zero-hits` is safe-but-silent and still FAIL as specified — a scoping mechanism that swallows its own misconfiguration is indistinguishable from one that is working; if the live service turns out to fail closed silently, that observation goes to the owner for an explicit ruling rather than being self-upgraded to a pass here. |
| E2.c | Syntactically malformed filter (`{matter:"bare-string"}`)         | Same run                                                                                                    | Same reading as E2.b: `errored` on every query; anything else FAIL.                                                                                                                                                                                                                                                                                                                                                                                                |
| E2.d | Worst-case, not average-case                                      | Same run                                                                                                    | The verdict takes the **worst** observed behavior per case across all 1,000 queries — one silent acceptance among a thousand rejections is FAIL. (The protocol already evaluates it this way.)                                                                                                                                                                                                                                                                     |

**Also still live-only, not gates for the route but named so they are not assumed** (protocols in the
design): E3 disjunction shapes (gates slice 3), E4 similarity-cache bleed (cache stays off
regardless), E5 deletion latency (feeds the opt-out wording; our catalog-side containment is already
proven), E6 schema-change cost, E7 R2 prefix restriction (decides feed-in-bucket versus feed bucket),
E8 sync latency and retrieval quality (decides whether the feature is worth shipping at all).

**Recording the result:** append the live verdicts to this record with the run date, account
identifier, instance configuration response, and the raw verdict objects; then update the design's
verification list. If E1 or E2 reads FAIL, the refusal rule applies as written — the feature does not
ship, and the record of the failure is this document.

## 5. Observations worth carrying forward

- **The adversarial query construction matters and is now encoded, not prose.** E1's strength comes
  from every query being chosen so an out-of-scope document is the single best unfiltered answer, with
  the result list guaranteed to fill (threshold 0, fifty results, shared vocabulary) so scope is
  decided by the filter rather than by ranking accidents. The fixture self-checks assert both
  properties before any probe verdict is trusted; the live run inherits them by reusing the corpus.
- **"Returned-zero-hits" on E2.b/E2.c is a real possible live outcome** and the checklist deliberately
  scores it FAIL-with-escalation rather than pass: it satisfies confidentiality but defeats
  observability. Deciding to accept it would be an owner ruling, not a reading.
- **The catalog-side survivor step is the load-bearing deletion control.** Locally proven: even
  against an index whose deletes never land, a removed document cannot reach a caller, because
  hydration requires a live catalog row. This means E5's live measurement (how long residue persists
  in the managed index) informs the opt-out disclosure wording, not the confidentiality posture.
- **A protocol that cannot fail proves nothing** — the sensitivity tests (broken engine variants) are
  as much a deliverable as the probes. Any future change to the probes must keep them failing against
  every broken variant; that is enforced by the suite itself.

---

_Local half executed and recorded by Claude (Claude Code) on 2026-08-07. The live half awaits a fenced
account; its checklist above is the contract for that run._
