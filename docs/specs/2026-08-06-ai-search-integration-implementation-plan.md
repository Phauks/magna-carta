# Cloudflare AI Search integration — implementation plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Each build slice below is sized for one agent batch and leaves `main` shippable on its own.

**Goal:** Build a firm-facing, retrieval-only natural-language search over a firm's own working
documents — the instance a firm's opt-in provisions, the derived text feed that is the only thing that
can reach it, the matter-scoped retrieval route with read-time re-authorization and an honest freshness
envelope, the consent gate and versioned disclosure, and the usage record. **No interface in slice 1.**

**Architecture:** New operations on the existing `packages/search` package (a `NaturalLanguageSearchPort`
beside the shipped `SearchIndexPort`, sharing `CorpusScope` and the pointer discipline), a feed writer
that is a second consumer of the extraction already performed in the search index job, one control-plane
table for instance records, two per-firm tables (the feed catalog and the usage meter), one per-firm
setting, one per-firm matter flag, one queue for provisioning and teardown, and one route. Design spec:
[`docs/specs/2026-08-06-ai-search-integration-design.md`](2026-08-06-ai-search-integration-design.md).

**Tech stack:** TypeScript (ESM, ES2022), zod 4, Drizzle (schema types only; hand-written raw SQL for any
index or seed migration), Cloudflare D1 (per-firm and control-plane), Cloudflare R2 (per-firm), Cloudflare
Queues, the Cloudflare AI Search Workers bindings (`ai_search_namespaces`, `ai_search`), Hono +
`@hono/zod-openapi`, Vitest (+ `@cloudflare/vitest-pool-workers` for the worker suite), `vp` for
test/lint/format.

**Hard dependency:** **task 110** — the matter dimension written as an `x-amz-meta-*` header on the
file-version object at put time (`packages/file-manager`). Slice 1 task 3 reads that value and must not
re-derive it. Do not start slice 1 before it has landed on `main`.

**Slice 0 gates the retrieval route.** Tasks 1 through 4 and 6 through 9 of slice 1 are buildable and
mergeable before slice 0 reports; **task 5 (the retrieval route) does not merge until slice 0's E1 and E2
have passed.** If they fail, the feature does not ship.

## Global constraints

Every task's requirements implicitly include this section.

- **No filter value ever comes from a request.** Every metadata filter argument is derived server-side from
  the authenticated session and the route's path parameters. A request body field that reached a filter
  would be the whole vulnerability. A fitness test asserts the filter builder takes no caller input.
- **Every returned pointer is re-authorized through the firm-scoped data-access layer before any of its
  text is returned.** The index is never the authority on who may see what. A hit that fails is dropped and
  raises a highest-severity event on the standard error pipeline; the dropped count is never returned to
  the caller.
- **No query text in any log, audit row, problem detail, or error payload.** A member's natural-language
  question about a client matter is privileged content. Audit records the member, the matter, and the result
  count.
- **No generation call, ever.** No module constructs a `chatCompletions()` request, configures a text
  generation model on an instance, or enables a public endpoint. A fitness test asserts it.
- **No second model chokepoint.** Nothing outside `packages/inference/` names a provider or constructs
  gateway options. AI Search's own model calls are configured at the gateway, not in our code.
- **All business data through the firm-scoped data-access layer** (golden rule 3): the route hands the
  package a firm-scoped database; nothing in the package holds a binding or crosses firms.
- **Full names, no shorthand** (golden rule 12): `naturalLanguageSearch`, never `nlSearch`;
  `confidentialityScope`, never `confScope`; "the firm-scoped data-access layer", never an abbreviation;
  `newIdentifier`, never `newId`; `documentIdentifier` where a domain name is being coined.
- **No process-artifact references in source, tests, or OpenAPI `description`s** (golden rule 13): no ADR
  numbers, no "spec", no "slice N" except a forward-looking "built in slice N" schedule note. Enforced by
  `pnpm lint:process-refs`.
- **Nothing heavy on the hot path**: provisioning, teardown, feed writes, and re-index triggers are
  queue-dispatched. The retrieval route makes exactly one outbound call.
- **Every outcome is a typed value, never a thrown error** — the discipline `SearchIndexPort`,
  `ConversionPort`, and the integrations `Dispatch` sum already share.

---

## Slice 0 — the ethical-wall filter experiment

Fenced account, synthetic bucket, load-profile fixtures. **No firm data at any point.** Deliberately
throwaway: the artifact is a written result, not merged code. Roughly one week.

### Task 0.1 — Fixture corpus and fenced instance

- [ ] Generate three synthetic matters on the load-profile fixture generator: A and B at 1,000 documents
      each, C with one document. Plant a distinctive nonsense token in a known subset of both A and B so a
      query on it should rank documents from both.
- [ ] Lay the synthetic bucket out exactly as the feed does: `ai-search/{matterId}/{fileId}/{versionId}.md`
      with the four custom metadata headers set at put time.
- [ ] Create one instance with the design's full configuration: `@cf/baai/bge-large-en-v1.5`, hybrid
      indexing, 1-hour sync, the four-field schema, query rewriting off, reranking on, no generation model,
      no public endpoint. Record the exact create call and its response.
- **Requirements:** the fenced account is separate from any account holding firm data; the bucket is
  deleted and the instance destroyed at the end of the experiment regardless of outcome.

### Task 0.2 — E1 and E2: exclusion and fail-open

- [ ] **E1:** 1,000 queries, each the verbatim text of a passage from a matter B document, run with
      `filter: { matter: { $eq: "<A>" } }`, `max_num_results: 50`, `match_threshold: 0`. Record every hit
      and the matter it resolves to.
- [ ] **E2:** the same queries with (a) a nonexistent matter value, (b) a filter on a field name absent from
      the schema, (c) a syntactically malformed filter. Record accepted / rejected / accepted-and-ignored for
      each.
- **Pass criteria:** E1 returns **zero** matter-B hits across all 1,000 — one is a failure. E2(a) returns
  zero hits; E2(b) and E2(c) **error** rather than being silently ignored.
- **This is the gate.** A failure of either means the feature does not ship, in any reduced form.

### Task 0.3 — E3 and E4: disjunction and cache bleed

- [ ] **E3:** `$in` over two matters; `$or` of two `$eq`; the legacy compound form; and a two-key mixed
      filter (matter disjunction AND `object_class` equality). Record accepted / rejected /
      accepted-and-ignored for each, and for anything accepted, verify it actually filters by repeating the
      E1 protocol against it.
- [ ] **E4:** identical query text under matter A then matter B, cache **on**, at every threshold from
      `super_strict_match` to `anything_goes`; then the same with the cache off.
- **Outcome:** E3 decides whether firm-wide scope (slice 3) is buildable. E4 is expected to show bleed; the
  recommended default is cache-off regardless, and E4 exists to record whether that default is a precaution
  or a necessity.

### Task 0.4 — E5 through E8: measurement

- [ ] **E5:** delete a feed object, trigger a sync, poll a query that previously returned it. Record the
      interval and whether it ever stops being returned.
- [ ] **E6:** add a fifth custom metadata field to the populated instance; measure re-index duration and
      whether queries degrade during it.
- [ ] **E7:** attempt an R2 data source restricted to a key prefix. Records whether the feed lives in the
      firm bucket or a separate feed bucket.
- [ ] **E8:** time from `PUT` to searchable at each allowed sync interval. Separately, retrieval quality over
      legal prose on the fixtures — defined terms, cross-referenced clauses, statutory language — against the
      512-input-token embedding window.
- **Requirements:** every number is measured, not extrapolated. E8's quality half decides whether the feature
  is worth shipping even if E1 and E2 pass.

### Task 0.5 — Report and teardown

- [ ] Write the results into `docs/research/` as a dated experiment record: the protocol as run, every
      number, and an explicit statement for each of E1 through E8 of pass / fail / measured value.
- [ ] Destroy the instance, delete the synthetic bucket, and record that both were done.
- [ ] Update the design spec's section 11 verification list in place with the answers.

---

## Slice 1 — the feature, off for everyone

Depends on **task 110**. Every gate closed on merge; no instance exists for any firm.

### Task 1 — Consent gate, disclosure, and the matter exclusion flag

- [ ] `packages/search/src/natural-language-settings.ts`: a `FirmSettingDefinition<boolean>` keyed
      `search.naturalLanguageEnabled`, default `false`, on the shipped pattern
      (`packages/search/src/settings.ts`, `packages/ai-detection/src/settings.ts`), with a total read helper.
- [ ] A firm-level disclosure acknowledgement record carrying `disclosure_version`, the acknowledging
      administrator, and the timestamp. Firm-level, not per-member.
- [ ] A per-matter exclusion flag (`natural_language_index_excluded`, default false) in the per-firm schema
      with its data-access statements.
- [ ] The disclosure text itself, as a versioned constant, matching the design's section 6.2 exactly —
      including the two sentences that decline to guarantee residency and provable managed-index deletion.
- **Requirements:** the gate is read at feed-enqueue time and again in the retrieval route. Setting the
  matter flag enqueues teardown of that matter's feed objects (task 4), not merely a stop on new writes.
  Turning the firm gate on without a current-version acknowledgement is refused at the write path.

### Task 2 — Instance lifecycle

- [ ] A control-plane table recording, per firm: the derived instance name, the Cloudflare instance
      identifier, the configuration generation, and the lifecycle state (`provisioning` | `ready` |
      `tearing-down` | `absent`).
- [ ] The derived instance name — hashed from the firm identifier by the `deriveIdentifier` discipline
      (`packages/search/src/split.ts` is the precedent), opaque, carrying no firm or client name.
- [ ] A queue-dispatched provisioning job calling `ai_search_namespaces.create()` with the design's full
      configuration table, and a teardown job that stops the feed, enqueues feed-object deletion, then calls
      `delete()` and records the response verbatim.
- [ ] The weekly keep-alive: one full-text query per `ready` instance from the existing scheduled sweep,
      metered as a platform query, well inside the 31-day inactivity pause.
- **Requirements:** the configuration is a single versioned constant, not scattered literals — the metadata
  schema in particular, because changing it re-indexes every firm. Provisioning is idempotent: a repeated
  create converges on the same derived name. Never call `list()` to learn which firms have instances; the
  control-plane row is the catalog. The teardown records what it can demonstrate and asserts nothing else.

### Task 3 — The feed writer and its catalog

- [ ] A per-firm `ai_search_feed_object` table: file, version, matter, object key, byte count, `fed_at`,
      `removed_at`, with the data-access statements and a unique key on (file, version).
- [ ] The feed writer inside the existing search index job (`apps/worker/src/search/`), as a **second
      consumer of the extraction result already computed there** — not a second extraction and not a second
      pipeline. It writes `ai-search/{matterId}/{fileId}/{versionId}.md` holding the concatenated per-page
      extracted text with page markers.
- [ ] Custom metadata headers at put time: `matter` **copied from the authoritative object's own metadata**
      (task 110), `client`, `object_class = working-document`, `confidentiality_scope` empty.
- [ ] Matter reassignment: delete the old feed object, write the new key, update the catalog row.
- **Requirements:** the writer is gated on `search.naturalLanguageEnabled` **and** the matter's exclusion
  flag, both read at enqueue time. It produces objects for exactly one class — committed file versions —
  and for nothing else: not `files/{fileId}/current`, not conversions, not bundles, not captured email
  originals, not splits, and not any discovery review-set corpus. A fitness test enumerates the object
  classes the writer can produce and asserts the list has one member.
- **Requirements (F4b):** `object_class` is written on every object and the values `work-product`,
  `transcript`, and `received-material` are reserved and never written. A test asserts the writer cannot
  emit them.

### Task 4 — Deletion, exclusion, and enumeration

- [ ] A queue-dispatched deletion job that removes feed objects for a scope — one document version, one
      matter, or the whole firm — deleting from R2 and marking catalog rows `removed_at`.
- [ ] An enumeration read that proves the state: every catalog row for a scope with its removal timestamp,
      reconcilable against an R2 prefix listing.
- **Requirements:** deletion is driven from the catalog, not from a prefix listing, so an object the catalog
  does not know about is a detected inconsistency rather than a silent miss. The reconciliation runs as part
  of teardown and its result is recorded.

### Task 5 — The retrieval port and route — **blocked on slice 0 tasks 0.2 passing**

- [ ] `packages/search/src/natural-language-port.ts`: `NaturalLanguageSearchPort` with one operation, typed
      outcomes (`instance-not-provisioned` | `not-enabled` | `adapter-error`), sharing `CorpusScope` and the
      `SearchHit` pointer discipline. A default resolution returning `instance-not-provisioned` when the
      binding is absent.
- [ ] The adapter over the `ai_search` binding: `search()` only, `retrieval_type: "hybrid"`,
      `fusion_method: "rrf"`, reranking on, `max_num_results` from the caller's limit capped at 50, no
      `boost_by`, no cache.
- [ ] The filter builder: two `$eq` keys (`matter`, `object_class`), every value server-derived. It takes no
      caller-supplied input, and a fitness test asserts its signature cannot accept one.
- [ ] `POST /api/v1/matters/{matterId}/document-search/natural-language`, authorized at the route metadata
      chokepoint on the matter in the path before the handler runs.
- [ ] Read-time re-authorization: every returned pointer re-resolved through the firm-scoped data-access
      layer and re-checked against the caller's entitlement; survivors hydrated for their citation (document,
      version, page) from the data-access layer rather than from the index; failures dropped, each raising a
      highest-severity error-pipeline event.
- [ ] The freshness envelope on every response: `indexedThrough` from the instance's sync status and
      `pendingDocumentCount` from the feed catalog, present whether or not the count is zero.
- [ ] The optional manual sync trigger when `pendingDocumentCount` is above zero, rate-limited to once per
      30 seconds per instance and recorded.
- **Requirements:** `POST`, not `GET` — the query text must not reach a URL, a referrer, or an access log.
  A hit whose feed object has been removed produces no result rather than a dangling citation. An empty
  result is returned as an empty result with nothing composed to fill it. The dropped-hit count never
  appears in the response.

### Task 6 — Usage meter

- [ ] A per-firm `ai_search_usage_meter` on the `token_usage_meter` shape: civil-day buckets, delta upsert
      composed into the same effect batch as the operation it counts, so a redelivery no-ops with it.
- [ ] Columns for **authoritative** counts (semantic queries, full-text queries including keep-alives, fed
      bytes) kept separate from the **estimated** ingestion-token figure derived from fed bytes at a recorded
      ratio.
- [ ] The firm-usage feed read, rendering authoritative and estimated figures differently.
- **Requirements:** nothing is read from a provider's logs. Managed storage is **not** metered and not
  estimated — the gap is recorded in the feed's own copy rather than filled with a guess.

### Task 7 — Audit and error-pipeline events

- [ ] Audit rows for: firm opt-in and opt-out, disclosure acknowledgement, matter exclusion set and cleared,
      instance provisioned and destroyed, and each query (member, matter, result count).
- [ ] Error-pipeline events for: a dropped hit (highest severity, carrying the pointer and the failed check,
      never passage text), a provisioning or teardown failure, and a feed-catalog reconciliation mismatch.
- **Requirements:** no query text, no passage text, and no client-identifying free text in any audit metadata
  — the redaction chokepoint applies unchanged.

### Task 8 — Bindings, configuration, and the gateway posture

- [ ] `wrangler.toml`: the `ai_search_namespaces` binding, and the `ai_search` binding resolution path.
- [ ] The deploy runbook step in [`../conventions/operations.md`](../conventions/operations.md): on the
      gateway AI Search's model calls run through — logging off, **Guardrails off**, **caching off**, **rate
      limiting off** — with the note that the per-request options our own code pins do not reach these calls,
      so the posture is set and verified at the gateway.
- **Requirements:** an absent binding resolves to the default port returning `instance-not-provisioned`, so a
  misconfigured environment produces an obviously-unavailable feature and never a silent empty result.

### Task 9 — Fitness tests and documentation

- [ ] Fitness tests: no `chatCompletions` construction anywhere; no public-endpoint enablement anywhere; the
      filter builder accepts no caller input; the feed writer emits exactly one object class and cannot emit a
      reserved class; the instance configuration constant is the only source of the metadata schema.
- [ ] `packages/search/CLAUDE.md`: the local rules — the filter is not the boundary, read-time
      re-authorization is; the feed is an allow-list; the metadata schema is a foundation because changing it
      re-indexes every firm.
- [ ] `docs/user/`: the administrator guide for enabling the feature (what the disclosure says, what opt-out
      does and does not prove, what the freshness sentence means) and the member guide for using it (it
      returns passages, not answers; an empty result means nothing matched).
- [ ] `docs/operating-costs.md`: AI Search recorded as **open beta, preview pricing, billing not yet
      enabled**, with the preview rates and the note that they are provisional.
- [ ] A `status.d/` fragment for this slice, a `changelog.d/` fragment, and a decision fragment for anything
      the owner rules on. **Never edit `CHANGELOG.md`, `STATUS.md`, `STATUS.json`, or `ROADMAP.md` directly.**

---

## Slice 2 — the interface

The search surface, through the design system: the question box, the passage list with its citations, the
freshness sentence stated on the surface rather than in a help page, and the retrieval-only posture visible
in the interface's own words ("passages from your documents", not "answer"). Deferred to its own slice
because slice 0's results decide what it can honestly promise.

## Slice 3 — firm-wide scope

**Gated on slice 0's E3 (a proven, verified disjunction) and E8's measured recall.** A firm-wide query
shape, its own `disclosure_version`, and the entitlement set pushed into the filter rather than applied
after retrieval — because post-filtering a top-50 across a firm's matters returns a broken-looking result,
not a safe one.

## Slice 4 — the Magnus context seam

An implementation of `MagnusContextPort` that calls `NaturalLanguageSearchPort` with a conversation's
explicitly granted matter. Gated on Magnus slice 2's per-conversation grants. **Increments Magnus's
`disclosure_version` and re-prompts every member** — that is the mechanism working, not a side effect.
Firm-wide retrieval into Magnus stays refused and needs its own consent decision.

---

## Verification

- `pnpm check:scoped` on the diff; `pnpm run lint:process-refs`; `pnpm run lint:decisions`;
  `pnpm run lint:status` where a status fragment changed.
- `pnpm test` for the package and worker suites, including the Miniflare integration test.
- The fitness tests in task 9 run in the ordinary suite, not as a separate gate.
- Slice 1 merges with every gate closed: a test asserts that a firm with no setting row produces no feed
  object, no instance, and an `instance-not-provisioned` outcome from the port.
