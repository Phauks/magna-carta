# Cloudflare AI Search integration — natural-language document search — design

**Date:** 2026-08-06
**Status:** Design proposed. The owner flags in section 12 are open; **slice 1 is buildable on the
recommended defaults**, and its only hard external dependency is the matter dimension in R2 object
metadata (task 110). One thing in this design must be _proved_ before it is relied on, and it has its
own slice: the ethical-wall filter experiment (section 4.2). No product code in this cycle.
**Scope:** A firm-facing, **retrieval-only** natural-language search over a firm's own working
documents — the instance lifecycle a firm's opt-in creates and its opt-out destroys, what is fed into
the index and what is structurally incapable of reaching it, how a query is scoped and how a result is
re-authorized before anyone sees it, what the firm is told before any of it happens, the retrieval
route and its freshness envelope, and the cost record it leaves behind.
**Excludes:** the discovery keyword engine (unchanged and unaffected — the assessment refuses AI Search
there outright); the discovery semantic half (deferred by decision, behind `SearchIndexPort` and behind
discovery flag D4); **any generation of any kind**; the user interface; ethical walls themselves, which
are not built anywhere in the platform yet.
**White-paper home:** _Core domain_ (search and discovery), with _AI / inference_, _Tenancy and data
isolation_, _Authentication, access control & encryption_, _Settings & configuration_, and
_Observability & diagnostics_ as the surrounding context.
**Governing decisions:** ADR-0003 (tenancy and the firm-scoped data-access layer), ADR-0012 (Tantivy
keyword + a semantic half), ADR-0067 (route metadata and the one enforcement chokepoint), ADR-0068
(trusted-insider access control), ADR-0017 / ADR-0038 (audit and redact-by-default), ADR-0039 (nothing
heavy on the hot path), ADR-0109 (client consent for third-party frontier processing — **Proposed,
still open**), ADR-0110 (confidentiality posture), ADR-0111 (`@magna-carta/inference` is the one
credential-less chokepoint), ADR-0112 (multi-tenant fairness), ADR-0113 (tenant isolation and
response-captured metering), ADR-0207 (splits in R2), ADR-0208 (the write pipeline).
**Decision inputs:** the merged assessment
[`../research/2026-08-06-cloudflare-ai-search-assessment.md`](../research/2026-08-06-cloudflare-ai-search-assessment.md),
whose conclusions this design treats as binding and does not re-derive; the shipped `packages/search`
(`port.ts`, `corpus.ts`, `split.ts`, `settings.ts`, `extraction.ts`) and its write pipeline
(`apps/worker/src/search/`); the shipped `packages/file-manager/src/file-statements.ts` R2 key
derivation; the shipped `@magna-carta/inference` consent machinery
(`packages/inference/src/settings.ts`, `packages/ai-detection/src/settings.ts`) and the two-gate pattern
the Magnus design established
([`2026-08-06-magnus-design.md`](2026-08-06-magnus-design.md)); the Magnus `MagnusContextPort` seam and
the ratified F4b work-product ruling
([`../decisions/0250-magnus-flags-f2-f3-f4b-ratified.md`](../decisions/0250-magnus-flags-f2-f3-f4b-ratified.md));
the discovery 5·1 design's corpus scope key and D4 posture
([`2026-08-05-discovery-5-1-design.md`](2026-08-05-discovery-5-1-design.md)); the shipped
`token_usage_meter` precedent (`packages/data-access/src/token-usage-statements.ts`).

---

## 1. What this design is, and the four things it is not

The assessment answered "should we use Cloudflare AI Search" with a partial yes and named exactly one
shape worth building: **a retrieval-only natural-language search over a firm's own working documents.**
This is the design of that shape. It does not revisit the assessment's conclusions; it builds inside
them.

Four exclusions, stated first because each is a thing a reader will expect to find here.

**It is not a change to discovery search.** The Tantivy keyword engine stays. AI Search has no phrase
search, no proximity operator, no wildcard, no field-scoped term, no boolean grouping, and returns a
chunk rather than a highlight offset into the source document. E-discovery search _is_ those operators.
Nothing in this design touches `crates/search-core`, `SearchIndexPort`, the split catalog, or the write
pipeline's index path.

**It is not the discovery semantic half.** That sits behind `SearchIndexPort` and behind discovery flag
D4's off-by-default per-review-set switch, and the assessment's advice is to keep the engine choice
cheap rather than make it now. This design deliberately leaves it undecided. If AI Search later wins
that decision too, the adapter written here is most of the work — but it wins it on evidence gathered
against a review set, not on this surface's results.

**It is not generation.** No `chatCompletions()` call exists anywhere in this design. Retrieval returns
passages the firm's own lawyers wrote, with their sources; nothing composes prose. That is a position,
not a phase: generation over privileged content sits behind ADR-0109, which is still _Proposed_, and it
relocates the verification burden onto a reader who cannot see what was not retrieved.

**It is not switched on.** Every gate defaults closed, no instance exists for any firm until an
administrator deliberately creates one, and general enablement waits on Cloudflare taking the product
out of open beta (section 12, flag A6).

### 1.1 The one honest reason this is still opt-in

Retrieval-only AI Search makes **no third-party frontier model call at all** — embedding and reranking
run on Workers AI, which ADR-0110 already names as the strict on-Cloudflare default. By the letter of
the existing consent machinery it therefore needs no consent decision that has not already been made.

The owner's instruction is nevertheless that it be opt-in — _"it will need to be opt-in, like many other
AI features of course"_ — and the instruction is right for a reason worth writing down, because it will
be re-litigated otherwise. **What changes is not who computes, but where the bytes rest.** Today the
extracted text of a firm's documents exists in that firm's own R2 bucket and nowhere else, and the index
over it exists in that firm's own bucket and that firm's own database. This feature copies that text
into a Cloudflare-managed store and a Cloudflare-managed vector index that our account cannot name,
inspect, enumerate, or partition. That is a new location for privileged material, and a firm gets to
decide whether its own client agreements permit it. No frontier model is involved, and the disclosure
says so plainly — but "no third party" is not the same statement as "nothing moved."

---

## 2. The surface, in one paragraph

A member types an ordinary question — _"where did we agree to a contingency on appeal"_ — against a
matter they are entitled to see. The platform embeds the question, retrieves the highest-scoring
passages from that matter's documents, **re-checks every returned pointer against the caller's
entitlement through the firm-scoped data-access layer**, and returns the surviving passages with their
document, version, and page, plus one sentence saying how fresh the index is and how many documents
committed since the last sync are not yet in it. If nothing scores above threshold, the answer is
empty and says so. Nothing is composed. Every citation is a real document because there is no step in
which one could fail to be.

---

## 3. The integration shape

### 3.1 Instance-per-firm, and the arithmetic that leaves nothing else

Settled by the assessment and restated here only because everything downstream hangs on it: namespaces
cap at **100 per account** on every plan, which disqualifies namespace-per-firm at a hundred firms;
instances cap at **5,000**, which makes instance-per-corpus (a firm with 200 matters) support roughly 25
firms; a shared instance across firms is refused outright under ADR-0003. **One AI Search instance per
firm** is the only allocation that scales, and it is Cloudflare's own recommended isolation pattern.

Its consequence is the whole of section 4: instance-per-firm gives **structural isolation between
firms** and **filter-only scoping within a firm**. Between firms, a query against firm A's instance
cannot reach firm B's bytes for the same reason a query against firm A's D1 cannot. Within a firm, the
matter scope is an argument the caller constructs on every request — which is a weaker mechanism than
this platform uses anywhere else, and section 4 is how that is made safe rather than asserted.

Instance naming is derived, never minted: the instance name is derived from the firm identifier by the
same hashing discipline as `splitIdentifierForDocumentVersion`, so a repeated create converges on the
same name and a crashed provisioning step is restartable rather than leaky. The name carries no firm
name, no client name, and no human-readable text — it is an opaque handle, because instance names appear
in Cloudflare's own dashboard and account-level surfaces that are not per-firm partitioned.

### 3.2 Lifecycle: created on opt-in, destroyed on opt-out, and what deletion can honestly claim

**Creation.** An administrator turns the firm setting on. The provisioning path (a queue-dispatched job,
never the request handler — ADR-0039) calls the `ai_search_namespaces` binding's `create()` with a fixed
configuration:

| Setting                | Value                                                      | Why                                                                                                                                                                     |
| ---------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Embedding model        | `@cf/baai/bge-large-en-v1.5`, 1,024 dimensions             | The model `packages/inference/src/catalog.ts` already pins. Fixed at creation and unchangeable — the pin, enforced by the platform.                                     |
| Data source            | R2, the firm's own bucket, restricted to the feed prefix   | Section 3.3.                                                                                                                                                            |
| Indexing mode          | Hybrid (vector + keyword)                                  | Costs the file ceiling (500K rather than 1M) and buys a lexical fallback for defined terms an embedding blurs. A firm's working documents are far below either ceiling. |
| Sync interval          | 1 hour (the documented minimum)                            | Section 3.5.                                                                                                                                                            |
| Custom metadata schema | Declared once, four named fields                           | Section 3.4.                                                                                                                                                            |
| Query rewriting        | Off (the default)                                          | A rewrite is a model composing a new query on the member's behalf, unlogged and unshown. The member's words are the query.                                              |
| Reranking              | On, `@cf/baai/bge-reranker-base`                           | A cross-encoder we do not have and would not build; on Workers AI; retrieval-only.                                                                                      |
| Response generation    | Never configured                                           | Section 1.                                                                                                                                                              |
| Similarity cache       | **Off**                                                    | Section 4.4 — this one is not a preference.                                                                                                                             |
| Public endpoints       | **Never enabled** (`/search`, `/chat/completions`, `/mcp`) | Unauthenticated by default on a hostname that is never rotated. Every query goes through `/api/v1`.                                                                     |

The instance identifier Cloudflare returns is recorded on a control-plane row against the firm, together
with the configuration generation it was created under. That row is the platform's own catalog of what
exists — we never rely on `list()` to know which firms have instances, for the same reason the split
catalog exists rather than an R2 prefix listing.

**Deletion, and the sentence we are allowed to say.** Opt-out does three things, in this order: it stops
the feed writer (no new object is ever produced), it **deletes every feed object from the firm's own R2
bucket** and marks each catalog row removed, and it calls `delete()` on the instance. The first two we
perform ourselves against storage we own, and we can therefore demonstrate them — an enumeration of the
feed catalog with every row removed, verifiable against a prefix listing. The third is a request to a
managed service.

**What the documentation states about instance deletion is that the binding has a `delete()` operation.
It does not state what deletion guarantees about the vectors, the keyword index, the converted Markdown,
or the similarity cache, nor within what interval, nor how a caller confirms it.** So the design refuses
to claim it. The opt-out confirmation says exactly this: the source material has been deleted from the
firm's own storage and enumerated to prove it, and the managed index has been requested to be deleted
with the response recorded. It does not say "provably gone," because that is discovery's word and it is
not available here. A firm whose obligation requires provable erasure from every store should not enable
this feature, and the disclosure says so (section 6.2).

**The 31-day inactivity pause.** An instance receiving no search request for 31 days has its scheduled
syncs paused. A firm that searches rarely would then meet a month-stale index on its next question with
no warning. The answer is a weekly keep-alive: one trivial full-text query per enabled instance from the
existing scheduled sweep, costing a rounding error at the published full-text rate, recorded in the meter
like any other query so it is never mistaken for a member's. Cheap, and it removes a failure mode whose
symptom would otherwise be silently wrong answers.

### 3.3 The data source: not the bucket as it stands — a derived feed

The naive shape is to point the instance at the firm's R2 bucket. **It must not be done**, and the
reason is worth stating precisely because it is the single largest correctness risk in this design.

A firm's R2 bucket is not a document library. It holds committed file versions
(`files/{fileId}/{versionId}`), the mutable working copy of every open editing session
(`files/{fileId}/current`), conversion artifacts, download bundles, captured email originals and their
extracted attachments, discovery search splits (`search/{corpusId}/splits/`), and — the one that decides
it — **discovery review-set originals: material received from opposing parties.** Indexing the bucket
would put an opponent's production into a search of the firm's own working files, which is the exact
outcome the corpus scope key was widened to prevent. It would also index every mid-edit working copy,
returning hits from a document nobody has saved.

Whether the R2 data source can be restricted to a key prefix is not stated in the documentation
enumerated by the assessment, and this design will not assume it. Instead the source is a **derived
feed**, which is the right shape whether or not prefix restriction turns out to exist:

- The feed is written under a dedicated prefix, `ai-search/{matterId}/{fileId}/{versionId}.md`, holding
  the document's **already-extracted text** — the same composite per-page extraction the keyword pipeline
  already produces, concatenated as plain Markdown with page markers.
- If prefix restriction on the R2 data source is unavailable, the feed moves to a **separate per-firm
  feed bucket** and nothing else in the design changes. That fallback is named now so the verification
  item (section 11) cannot block the build.

Feeding extracted text rather than raw documents is better on five independent axes, and the honest cost
is one:

- **What enters the index is an allow-list, not the contents of a bucket.** Nothing reaches the index
  except by the feed writer producing an object for it. That is what makes section 5 structural.
- **The 4 MB file limit stops binding.** Extracted text of a 400-page brief is small; the PDF is not.
- **The unsupported-format problem disappears.** `.doc`, `.msg`, `.eml`, and WordPerfect are absent from
  Cloudflare's supported types and are a real fraction of a legal corpus; we feed text, so the source
  format never reaches Cloudflare at all.
- **Ingestion is cheaper** at the text rate rather than the with-images rate.
- **Provenance survives.** Per-page `native`/`ocr` provenance and page counts stay on our side, where the
  review exception report and Bates numbering need them; Cloudflare's Markdown conversion is a black box
  that returns neither.

The cost: the assessment scored Cloudflare's parsing of hostile bytes as a genuine golden-rule-14 win,
and feeding text forgoes it. The honest accounting is that we forgo a win we do not currently have rather
than giving one up — the extraction runs anyway, on the same bytes, for the keyword half, so no new parse
surface is created and none is removed.

**The feed writer.** A second consumer of the extraction result inside the existing index job
(`apps/worker/src/search/`), not a second pipeline: the extraction is performed once and both the split
build and the feed write read it. A per-firm catalog table records one row per fed object — file, version,
matter, object key, byte count, `fed_at`, `removed_at` — which is what makes deletion demonstrable
(section 3.2) and freshness computable (section 3.5). The feed writer is gated on the firm's opt-in, read
at enqueue time, exactly as `search.indexing_enabled` gates the split path today.

**Matter reassignment.** The feed key encodes the matter; the authoritative object key deliberately does
not, and must not — `files/{fileId}/{versionId}` is flat precisely so a rename or reassignment moves no
bytes. The feed is derived and disposable, so a matter reassignment deletes the old feed object and writes
a new one at the new key. That asymmetry is the point: the expensive-to-move copy stays scope-free, and
the cheap-to-move copy carries the scope.

### 3.4 The metadata schema: declared once, because changing it re-indexes everything

An instance gets **five custom metadata fields, 500 characters each**, and **changing the schema triggers
a full re-index of all documents**. That makes the schema a foundation, not a setting: it is declared
completely at instance creation, for every firm, from the same versioned constant.

Two dimensions come free from the built-in attributes and cost no field, because we mint the feed key
ourselves and its exact shape is a pinned compatibility contract in the tests beside it — the same
discipline `split.ts` already uses:

- `folder` resolves to `ai-search/{matterId}/{fileId}/` — the matter and the document.
- `filename` resolves to `{versionId}.md` — the version.

Four custom fields are declared; the fifth is left unallocated with its cost stated:

| Field                   | Slice 1 value      | Why it is declared now                                                                                                                                                                                                                                                |
| ----------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `matter`                | The matter handle  | The scope dimension every filter in section 4 uses. A `$eq` on a single key is the simplest filter shape there is, and the only one slice 1 relies on. Duplicated from `folder` deliberately: a range query over a path prefix is a fragile thing to hang a scope on. |
| `client`                | The client handle  | A client-scoped search is the obvious second question after a matter-scoped one, and client-level walls are how walls are usually drawn in practice. Declaring it later re-indexes every firm.                                                                        |
| `object_class`          | `working-document` | Section 5. Every fed object carries it; the values `work-product`, `transcript`, and `received-material` are reserved and **never written** in slice 1.                                                                                                               |
| `confidentiality_scope` | Empty              | The ethical-wall group, for the day walls are built. Empty is free; adding the field later is a re-index of every firm's instance.                                                                                                                                    |
| _(unallocated)_         | —                  | One field remains. Allocating it later costs a full re-index per firm — bounded (a firm's working documents, not a review set), background, and re-runnable, but not free. Recorded so the cost is a decision rather than a surprise.                                 |

The value written into `matter` is **copied from the authoritative object's own metadata** — the matter
dimension that task 110 stamps as an `x-amz-meta-*` header at file-version put time — rather than
re-derived from D1 by the feed writer. One home per fact: the two cannot disagree, and a disagreement
between the feed object and its source is detectable by comparison rather than invisible.

### 3.5 Freshness: the index is behind, and the answer says how far

An R2-backed instance syncs on a schedule with a **one-hour minimum**, against a keyword pipeline that
indexes off the ingest commit. "I filed it two minutes ago, find it" does not work, and no configuration
makes it work. The assessment calls this a product regression rather than a tuning parameter, and it is
right.

The design's answer is not to hide it. Because we own the feed writer and its catalog, we know exactly
what the managed index has not seen yet, which is more than Cloudflare tells us. Every retrieval response
carries a **freshness envelope**:

- `indexedThrough` — the timestamp of the last completed sync, from the instance's own sync status.
- `pendingDocumentCount` — feed objects written since that timestamp and not yet removed. Computed from
  our catalog, exact, and cheap.

The interface states it in a sentence — "current as of 14:05; 3 documents added since then are not yet
searchable" — and states it whether the count is zero or not, so a zero is informative rather than an
absence of warning. When `pendingDocumentCount` is above zero the route may trigger a manual sync, rate-
limited to the documented once-per-30-seconds per instance and recorded, and tells the member the index is
catching up rather than silently returning a stale answer.

This is the same instinct as parking an index job in a distinct `deferred` state rather than pretending it
succeeded, and as refusing a review set above its ceiling by name with the count and the ceiling in the
message. A search that quietly omits this morning's filing is worse than one that says it is an hour
behind.

### 3.6 The query path

The Workers binding, and only the Workers binding. `env.AI_SEARCH_NAMESPACES.get(name)` is synchronous and
makes no network call, so resolving a firm's instance costs nothing on the request path; the actual
`search()` is the one network call. No REST client, no Python SDK, no framework adapter, and no MCP —
each of the latter is either a second credential path or a disclosure surface, and MCP specifically is
only available through a **public endpoint**, which section 3.2 forbids.

The binding name and the instance handle are resolved from the control-plane row for the authenticated
firm, never from anything in the request. A caller cannot name an instance, and there is no route
parameter through which it could try.

---

## 4. Scoping and the ethical wall

### 4.1 Filters are not a boundary — read-time re-authorization is

This is the design's central claim, and every other decision in this section follows from it.

In the shipped discovery design, isolation is **structural**: a firm's splits are in that firm's bucket,
and the catalog a query prunes against lives in that firm's own database, so a query can only ever name
splits its own firm owns. Instance-per-firm preserves that between firms and loses it within one: the
matter scope becomes a filter argument constructed on every request, and a bug that drops or mis-builds
the filter is a cross-matter disclosure with no second line of defence.

**So the filter is not the defence.** Every hit AI Search returns is a pointer — a feed object key, from
which the document, version, and matter are recoverable — and **every pointer is re-resolved through the
firm-scoped data-access layer and re-checked against the caller's entitlement before a single character of
it is returned.** A hit that fails the check is dropped, and the drop raises an event on the standard
error pipeline at the highest severity, because a filter that returned an out-of-scope document is a
platform bug of the most serious kind, not a routine condition.

This is not a novel discipline; it is the one already written into `SearchHit`, which "carries only the
pointers needed to hydrate the passage through the data-access layer — never its text, which is re-read
from R2." The natural-language surface inherits it verbatim. AI Search's own chunk text is used for
display only after its pointer has passed re-authorization, and passage text for a hit whose feed object
has since been removed is never fabricated from the returned chunk — the hit is dropped, because the index
is not the authoritative copy of anything.

Two consequences worth naming:

- **The metadata filter becomes a recall and cost optimization rather than a security boundary.** It keeps
  the top-K budget spent on documents the caller can actually see. That is a real and necessary job — see
  section 4.3 — but it is not the wall.
- **The count of dropped hits is never returned to the caller.** "Your query matched 14 passages you are
  not permitted to see" is itself a disclosure, and a measurable one. The count goes to the error pipeline
  and the audit trail; the member sees only what survived.

### 4.2 The verification experiment — its own slice, before any wall-bearing reliance

The assessment records an unreconciled contradiction in Cloudflare's own documentation: the Filtering page
documents no disjunction; the Workers binding API reference for the same `filters` parameter claims
compound `and`/`or`; the legacy format page documents `or` with severe restrictions. It is on the
do-not-conclude list, and the instruction is not to design an ethical wall against a disjunction until one
has been observed working.

The experiment runs on a **fenced account, a synthetic bucket laid out exactly as the feed is, and load-
profile fixtures — no firm data at any point.** It is deliberately throwaway. A negative answer is a good
outcome and the cheapest way to close the question.

**Setup.** One instance, configured exactly as section 3.2 specifies. Two synthetic matters, A and B,
1,000 documents each, sharing a distinctive nonsense token planted in both so that a query on it should
rank documents from both matters. A third matter C with one document, to make an empty-result case
observable.

| #      | Experiment                         | Protocol                                                                                                                                                                                                                                                      | Pass criterion                                                                                                                                                                                                                |
| ------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **E1** | Single-key exclusion               | 1,000 adversarial queries, each the verbatim text of a passage from a **matter B** document, run with `filter: { matter: { $eq: "A" } }`, `max_num_results: 50`, `match_threshold: 0`. The query is chosen to make a B document the single best possible hit. | **Zero** hits resolving to matter B, across all 1,000. One is a failure.                                                                                                                                                      |
| **E2** | Fail-open probe                    | The same queries with `filter: { matter: { $eq: "<nonexistent handle>" } }`; then with a filter on a **field name that does not exist in the schema**; then with a syntactically malformed filter.                                                            | Nonexistent value returns **zero** hits. Unknown field and malformed filter **error** — they must not be silently ignored. A filter that fails open cannot bear any weight at all, and this is the experiment that finds out. |
| **E3** | Disjunction shape                  | `{ matter: { $in: ["A","B"] } }`; `{ $or: [{matter:{$eq:"A"}},{matter:{$eq:"B"}}] }`; the legacy compound form; and a two-key mixed filter (`matter` disjunction AND `object_class` equality).                                                                | Record for each: accepted / rejected / **accepted-and-ignored**. The third outcome is the dangerous one and is why E2 runs first.                                                                                             |
| **E4** | Similarity-cache bleed             | Identical query text under `matter: A` then `matter: B`, cache **on**, thresholds from `super_strict_match` to `anything_goes`. Then repeat with the cache off.                                                                                               | With the cache on, the second response must not return the first's chunks. **The expectation is that it does** (section 4.4). With the cache off, no bleed at any threshold.                                                  |
| **E5** | Deletion latency and completeness  | Remove a feed object; trigger sync; poll a query that previously returned it.                                                                                                                                                                                 | Record the interval. Record whether it ever stops being returned. No pass/fail — this is measurement that feeds the honest wording in section 3.2.                                                                            |
| **E6** | Schema change cost                 | Add a fifth custom field to a populated instance; measure the re-index duration and whether queries degrade during it.                                                                                                                                        | Measurement only. Sets the price of allocating the spare field.                                                                                                                                                               |
| **E7** | R2 source prefix restriction       | Attempt to configure an R2 data source restricted to a key prefix.                                                                                                                                                                                            | Determines whether the feed lives in the firm bucket or a separate feed bucket (section 3.3). Either answer is fine.                                                                                                          |
| **E8** | Sync latency and retrieval quality | Time from `PUT` to searchable at each allowed interval. Separately, retrieval quality over legal prose on the fixtures — defined terms, cross-referenced clauses, statutory language — against the 512-input-token embedding window.                          | Measurement. E8's quality half is what decides whether the feature is worth shipping at all, independently of whether it is safe.                                                                                             |

**The refusal rule, stated so it cannot be negotiated later.** If E1 or E2 fails, **the feature does not
ship** — not in a reduced form, not behind a warning. If the experiment cannot be run in this design cycle
at all, slice 1 still builds (the feed, the instance lifecycle, the consent gate, the meter — none of which
expose a query surface) but **the retrieval route stays behind the gate until E1 and E2 have passed.** We
do not guess at a filter's semantics and put a client's confidences behind the guess.

Section 4.1's read-time re-authorization is what makes a partial result of this experiment survivable
rather than fatal: if E3 shows no usable disjunction, matter-scoped search still ships. If E1 fails, no
amount of re-authorization makes the product honest, because the platform would be sending a query into an
index whose scoping it cannot describe.

### 4.3 Matter-scoped only in slice 1 — and what firm-wide is actually waiting on

Slice 1 ships **one query shape**: a single matter, a single `$eq` filter on the `matter` field, plus a
single `$eq` on `object_class`. Two keys, implicit AND, both documented on every version of the filter
page. No disjunction is required and none is used.

The interesting question is whether firm-wide natural-language search — "search everything I can see" —
must wait for the disjunction proof. Section 4.1 makes the safety answer **no**: a firm-wide query could
run with no matter filter at all and let read-time re-authorization drop everything the caller cannot see,
and the result would be exactly as safe as the matter-scoped one, because the same check runs on the same
pointers.

**It should nevertheless wait, and for reasons of utility and hygiene rather than safety.**

- **Recall collapses under post-filtering.** `max_num_results` caps at 50. A user entitled to 3 matters out
  of a firm's 200 receives a top-50 that is mostly documents they cannot see, of which perhaps one survives
  the re-authorization. A search that returns one result because 49 were dropped is not a working feature;
  it is a broken one that looks like an empty corpus. Making firm-wide search _good_ requires pushing the
  entitlement set into the filter, which requires a disjunction, which is E3.
- **The dropped-count channel widens.** One or two drops on a matter-scoped query is an anomaly worth
  alerting on. Fifty drops on every firm-wide query makes the signal meaningless, and the alert that would
  have caught a real filter bug is now noise.
- **The disclosure is different.** "Your question is matched against the documents of the matter you are
  looking at" is a sentence a firm can evaluate. "Your question is matched against everything in the firm's
  index and then filtered" is a different sentence, and it deserves its own consent moment rather than
  arriving as a widening of an existing one.

So: **firm-wide search is slice 3, gated on E3 passing and on a measured recall figure from E8**, and it is
gated there deliberately rather than incidentally.

### 4.4 The similarity cache: off, and not as a preference

AI Search's similarity cache hashes the **prompt text** — MinHash plus locality-sensitive hashing — with a
default threshold of `close_enough` and a 48-hour time-to-live, and the documentation never states its
isolation scope.

Instance-per-firm contains it across firms. **It does not contain it across matters inside a firm**, and
the failure mode is exact: two members ask a similar question against two different matters, the cache
keys on the question text, and the second member receives the first matter's chunks. Whether the cache key
includes the filter arguments is precisely what is undocumented.

Read-time re-authorization would catch it — the returned pointers would fail the entitlement check and be
dropped, so nothing leaks to the user. But a cache that routinely returns another matter's documents makes
the alerting channel useless and makes the feature's results wrong even when they are not unsafe.

**The cache is off.** E4 tests whether it could ever be turned on; the recommended default stands
regardless, because the benefit — a saved query at $0.75 per thousand — does not buy a cross-matter hazard
of any size.

---

## 5. Work product and transcripts: the F4b mechanism

The ratified F4b ruling reframed Magnus transcripts as **work product** — protected, deletable,
archivable, discoverable like email — with a binding requirement: any search or discovery surface that
could sweep transcripts in **must carry an explicit include-or-exclude control**, so a transcript enters a
scope by a person's visible choice and never by default.

This design's answer is that AI Search's slice does not build such a control, because **nothing it indexes
can be a transcript**, and it says so by construction rather than by rule.

**Three layers, from strongest to weakest.**

1. **Transcripts are not R2 objects.** A Magnus conversation is rows in the per-firm database
   (`magnus_conversation`, `magnus_turn`). The data source is an R2 prefix. There is no path — not a
   misconfiguration, not a filter bug, not an operator error — by which a D1 row reaches an R2-backed
   index. This is the same kind of isolation as the bucket boundary between firms, and it is why the F4b
   control is not needed here.
2. **The feed writer is an allow-list with exactly one entry.** An object enters the index only if the feed
   writer produced it, and the feed writer runs from exactly one place — the committed-file-version path in
   the search index job — for exactly one object class. Discovery review-set originals, conversions,
   bundles, splits, captured email originals, and mid-edit working copies are absent for the same reason,
   which is the reason section 3.3 refuses to point the instance at the bucket.
3. **`object_class` is declared and stamped from day one.** Every fed object carries
   `object_class = working-document`, and every query filters on it. The values `work-product`,
   `transcript`, and `received-material` are reserved in the schema and never written in slice 1. That
   costs one of five metadata fields and buys the thing declaring it later would not: **if a transcript
   export, or any work-product class, is ever fed into this index, the filter predicate that excludes it
   already exists and already runs, and a surface that wants to include it must say so explicitly.** The
   default is exclude, and the default is enforced by a filter that is present on every query before any
   such object exists.

**The include/exclude control itself is discovery's**, per the ruling, and belongs to the review-set load
sources. This design does not build a second one, does not duplicate its vocabulary, and does not offer a
setting that could drift from it.

---

## 6. Consent and disclosure

### 6.1 One gate, defaulting closed, on the shipped pattern

The platform has an established shape for this and it is not reinvented: a `FirmSettingDefinition` read
through the generic firm-setting accessor, a missing row meaning the default in code, the default being
`false`, and the write path validated by the definition's own schema. `inference.aiProcessingEligibility`,
`aiDetection.externalDetectionEnabled`, and `search.indexing_enabled` are all this shape.

```
search.naturalLanguageEnabled — boolean, default false
```

Turning it on provisions the instance and starts the feed. Turning it off runs section 3.2's teardown.
The gate is read at **enqueue time** on the feed path — so a firm that has not opted in never produces a
feed object as a side effect of the platform being ready — and read **again** in the retrieval route before
any query, so a gate closed since a session started refuses rather than answering from an index that is
being deleted.

**Does it require `inference.aiProcessingEligibility` as well?** Recommended: **no**, and this is owner
flag A4. That gate asks a specific question — may this firm's content go to a **third-party frontier
model** at all? Retrieval-only AI Search sends nothing to one. Requiring it would conflate two different
questions and would deny an on-Cloudflare feature to precisely the most conservative firms, who are the
ones the on-Cloudflare path exists for. The moment generation is ever proposed over this index, that gate
applies in full and ADR-0109 applies with it.

**Whose acknowledgement?** Firm-level, from an administrator, versioned — not per-member. Magnus requires a
per-member acknowledgement because what a member types is transmitted to a third-party model provider and
because the member needs telling that the answer can be confidently wrong. Neither is true here: no third
party, and no composed answer to be wrong. The member's query text does reach Workers AI to be embedded,
which the firm-level disclosure states; that is the same on-Cloudflare boundary every other feature already
sits inside. The acknowledgement carries a `disclosure_version` on the same reasoning Magnus uses: the day
the feature can do something materially new — firm-wide scope, or generation — the version changes and the
firm is asked again automatically.

### 6.2 What the opt-in actually discloses

Short, exact, and true. Every sentence here is one a firm can evaluate, and none of them is a promise the
platform cannot keep.

- The **extracted text** of the firm's working documents — not the original files — is copied into
  **Cloudflare-managed storage and a Cloudflare-managed vector index**, outside the firm's own R2 bucket
  and outside the firm's own database. That store is not one the platform can name, inspect, enumerate, or
  partition.
- Embeddings and reranking are computed by **Cloudflare Workers AI**. **No third-party model provider is
  involved at any point**, and nothing is generated: the feature returns passages from the firm's own
  documents, never composed prose.
- A member's typed question is transmitted to Workers AI to be embedded.
- The index is **not authoritative**. It is derived from documents the firm holds, and every result is
  re-checked against the firm's own records before it is shown.
- **Data residency:** the documentation enumerated for this design states **no jurisdictional residency
  control** for the managed store. The disclosure therefore says that the location of the managed index is
  not one the platform can specify or verify, and does not offer a guarantee. A firm with a residency
  obligation should not enable this. Confirming whether such a control exists is a named verification item
  (section 11), and if one is found the disclosure changes and the version increments.
- **Deletion:** on opt-out the platform deletes the extracted text it wrote and can demonstrate it;
  deletion of the managed index is a request to Cloudflare whose completeness the platform cannot
  demonstrate. A firm requiring provable erasure from every store should not enable this.
- The index is **behind**, by up to an hour plus sync time, and every result says how far.
- **Cost:** the product is in open beta with preview pricing and billing not yet enabled; when Cloudflare
  begins billing, this becomes a metered feature and the firm will be told before it does.
- Whether the firm's own client agreements permit any of this is the firm's judgement, not the platform's.

### 6.3 Scope opt-outs below the firm

Two different answers for two different things, and the difference is the point.

**Matters: opt-out, defaulting in.** Once the firm has opted in, every matter is fed, and a matter carries
an exclusion flag that a member with the right permission can set. The reason it is not opt-in per matter:
a search that covers only the matters somebody remembered to tick is worse than no search at all, because
its gaps are invisible — a lawyer who finds nothing concludes there is nothing, and is wrong. The reason
the escape hatch must exist: a matter under a heightened confidentiality undertaking is a real thing, and
the firm needs somewhere to put it. Setting the flag stops the feed writer **and deletes the matter's
existing feed objects**, because an opt-out that only stops new writes leaves the material that prompted
it sitting in the index.

**Review sets: never fed, and not an opt-out.** Discovery review sets are a different corpus kind, and
material received from an opposing party must not surface in a search of the firm's own working files —
the exact reason the index scope key was widened from matter to corpus. There is no flag, because there is
no case in which it should be on. A firm that wants semantic search over a review set is asking for
discovery's D4 semantic half, which is a different decision behind a different gate.

---

## 7. The retrieval API

### 7.1 The port

A new `NaturalLanguageSearchPort` in `packages/search`, in our own domain vocabulary, with typed outcomes
rather than thrown errors — the discipline `SearchIndexPort`, `ConversionPort`, and the integrations
`Dispatch` sum already share.

It is a **separate port from `SearchIndexPort`**, deliberately. `SearchIndexPort.query` is shaped by the
Tantivy engine and the split catalog: it takes `splitKeys` the caller resolved from the per-firm catalog,
because the caller owns firm scoping and the engine never reaches the database. A managed index has no
splits and no catalog to prune against, and forcing it into that signature would mean a meaningless
parameter on every call. The two ports share `CorpusScope` and the `SearchHit` pointer discipline, which is
the part worth sharing.

```
naturalLanguageSearch(input) -> NaturalLanguageSearchResult

  input:  firmId, corpus (matter today), text, limit, objectClasses
  ok:     passages[], freshness { indexedThrough, pendingDocumentCount }
  fail:   instance-not-provisioned | not-enabled | adapter-error
```

`instance-not-provisioned` is a first-class outcome for the same reason `engine-not-implemented` is one on
`SearchIndexPort`: a firm that has just opted in has a provisioning job in flight and an index with nothing
in it, and that is a state to report rather than an error to log. The default resolution when the binding is
absent returns it, so a misconfigured environment produces an obviously-unavailable feature rather than a
silent empty result — the `resolveSearchIndexPort` / `createStubInferencePort` shape.

### 7.2 The route

```
POST /api/v1/matters/{matterId}/document-search/natural-language
```

Under the matter, because the matter is the scope and a scope that lives in the path is one the route
metadata chokepoint can authorize before the handler runs (ADR-0067). The caller's entitlement to the
matter is checked there, before any query is built — so an unentitled caller never reaches the index at
all, and section 4.1's re-authorization is the second check rather than the only one.

`POST` rather than `GET` because the query is a member's natural-language question about a client matter and
does not belong in a URL, a referrer, or an access log.

The handler: read the gate; resolve the instance from the control-plane row for the authenticated firm;
build the two-key filter (`matter` `$eq`, `object_class` `$eq`) from **server-derived values only** — no
part of any filter comes from the request body; call `search()`; re-authorize every returned pointer through
the firm-scoped data-access layer; hydrate the surviving passages; attach the freshness envelope; meter;
audit.

### 7.3 What a result carries

A passage, with the citation a lawyer needs to go and read the source: the document, its version, the page
when the extraction knew it, the passage text, and the score. No composed text, no summary, no answer.

Citations are hydrated through the data-access layer rather than taken from the index, so a document renamed
or moved since the last sync cites its current name, and a document deleted since the last sync produces no
hit at all rather than a dangling citation into nothing.

An empty result is an empty result. Nothing is generated to fill it, and the interface says the search found
nothing rather than implying the corpus is thin.

### 7.4 The Magnus seam

Magnus's `MagnusContextPort` is a named, deliberately empty seam whose only implementation returns no
context. **This design names what fills it, and does not fill it here.**

The fit is exact, and it is not a coincidence — the ratified F3 answer set Magnus's context boundary to
**explicit per-conversation grants**: a member attaches a specific document or matter to a conversation
deliberately, every grant visible on the transcript record, and firm-wide retrieval never arrives without
its own consent decision. A matter-scoped retrieval over a matter the member has explicitly attached is
precisely what slice 1 builds. So the seam is filled by a `MagnusContextPort` implementation that calls
`NaturalLanguageSearchPort` with the conversation's granted matter, and the number of other things that
change is zero.

Two conditions bind that slice and are recorded here so they are not rediscovered:

- Filling the seam **changes what Magnus discloses**, and therefore increments Magnus's own
  `disclosure_version` and re-prompts every member. That is the mechanism working as designed.
- Firm-wide retrieval into Magnus is refused by the F3 ruling on its own terms and needs a fresh consent
  decision, independently of whatever section 4.3 concludes about firm-wide search as a standalone surface.

### 7.5 Telemetry and cost accounting

The `token_usage_meter` precedent, with its discipline intact: **usage is captured from what we can observe
authoritatively, never from a provider's logs**, and the rollup is a delta upsert composed into the same
effect batch as the operation it counts, so a redelivery no-ops with it.

A per-firm `ai_search_usage_meter`, keyed by civil day and operation:

| Metered           | Source                                              | Authoritative?                                                                                       |
| ----------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Semantic queries  | Our own call count — we make every one              | **Yes**, exactly.                                                                                    |
| Full-text queries | Our own call count, including the weekly keep-alive | **Yes**, exactly.                                                                                    |
| Fed bytes         | The feed catalog's byte count per object            | **Yes**, exactly.                                                                                    |
| Ingestion tokens  | Estimated from fed bytes at a recorded ratio        | **No — estimate, and labelled one.** Cloudflare returns no ingestion token count to the feed writer. |
| Managed storage   | Not attributable per firm                           | **No, and not estimated.** A named gap, section 11.                                                  |

An estimate that is labelled an estimate is useful; an estimate that is presented as a meter is a future
billing dispute. The two are kept in different columns and the firm-usage feed renders them differently.

Audit: a query writes an audit row naming the member, the matter, and the result count — **never the query
text**, which is a member's question about a client matter and is privileged content the redact-by-default
standard keeps out of every log. A dropped-hit event on the error pipeline carries the pointer and the
entitlement check that failed, correlated by identifier, and no passage text.

---

## 8. Slices

**Slice 0 — the wall experiment.** Section 4.2, in full. Fenced account, synthetic fixtures, no firm data,
deliberately throwaway. Blocking for the retrieval route in slice 1 and for everything in slice 3. Roughly
one week. **A negative result is a good outcome**, and closing the question cheaply is the point.

**Slice 1 — the feature, off for everyone.** Depends on **task 110** (the matter dimension in R2 object
metadata) having landed. Instance lifecycle and provisioning job; the feed writer and its catalog; the
consent gate and the versioned disclosure; the matter-scoped retrieval route with read-time
re-authorization and the freshness envelope; the meter; the audit and error-pipeline events; the matter
exclusion flag. Backend only — no interface, on the Magnus precedent, because slice 0's results decide what
an interface can honestly promise. Every gate closed on merge; no instance exists for any firm.

**Slice 2 — the interface.** The search surface itself, through the design system, stating the freshness
sentence and the retrieval-only posture on the surface rather than in a help page.

**Slice 3 — firm-wide scope.** Gated on E3 (a proven disjunction) and on E8's measured recall. Its own
disclosure version. Section 4.3.

**Slice 4 — the Magnus seam.** Section 7.4. Gated on Magnus slice 2's per-conversation grants, and it
increments Magnus's disclosure version.

**Not a slice, and named so it is not assumed:** generation over this index. It is refused until ADR-0109 is
Accepted and ADR-0110's procurement artifacts are in hand, and it would be a separate design.

---

## 9. What this design refuses

| Refused                                                   | Why                                                                                                                                                              |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pointing the instance at the firm's bucket                | It holds received productions, mid-edit working copies, and binary splits. Section 3.3.                                                                          |
| Any generation call                                       | Relocates the verification burden onto a reader who cannot see what was not retrieved; behind ADR-0109 regardless. Sections 1 and 8.                             |
| Public endpoints (`/search`, `/chat/completions`, `/mcp`) | Unauthenticated by default on a hostname that is never rotated. A disclosure surface, not a feature.                                                             |
| MCP in any form                                           | Only available via a public endpoint.                                                                                                                            |
| The similarity cache                                      | Keys on prompt text with an undocumented isolation scope; contains firms, does not contain matters. Section 4.4.                                                 |
| Query rewriting                                           | A model composing a different query on the member's behalf, unshown and unlogged.                                                                                |
| Trusting the filter as the wall                           | It is a caller-constructed argument with no second line of defence. Section 4.1.                                                                                 |
| A second model chokepoint                                 | Nothing outside `packages/inference/` names a provider or constructs gateway options; AI Search's own model calls are the platform's, configured at the gateway. |
| Replacing any part of the keyword engine                  | Four capabilities lost, against built and tested code. Section 1.                                                                                                |
| Shipping the retrieval route before E1 and E2 pass        | We do not guess at a filter's semantics and put a client's confidences behind the guess. Section 4.2.                                                            |

---

## 10. Dependencies

- **Task 110 — the matter dimension in R2 object metadata**, written as an `x-amz-meta-*` header at
  file-version put time in `packages/file-manager`. Hard dependency for slice 1: the feed writer copies that
  value rather than re-deriving it. Designed there, not here.
- **The extraction path** (`apps/worker/src/search/text-extraction.ts`) and its composite per-page
  `native`/`ocr` result — the feed writer is a second consumer of it, not a second pipeline.
- **`packages/inference`'s pinned embedding model** — `@cf/baai/bge-large-en-v1.5` at 1,024 dimensions must
  match the instance's creation-time model, and the instance's is unchangeable after creation. The one place
  to confirm it before merge is `PLATFORM_EMBEDDING_MODEL_ID`.
- **The AI Gateway configuration**, which is the only control plane over the model calls AI Search makes on
  its own — ADR-0110's `collectLog: false` and ADR-0113's `skipCache: true` are per-request options on the
  `AI` binding and **do not reach these calls**. The posture must be set on the gateway and verified there.
  Guardrails must remain off (they log prompts and responses); gateway caching must remain off (Cloudflare
  warns it corrupts embeddings); gateway rate limiting must remain off (it interrupts indexing).

## 11. Open verification items

Answered by slice 0 where marked; the rest are named so they are not assumed.

> **Slice 0 status (2026-08-07):** the local half is done — the E1/E2 protocol is built, sensitivity-
> proven, and runnable (`packages/search/test/natural-language-filter-wall/`), and our side's filter
> construction and delete/re-index discipline are pinned. **E1 and E2 themselves remain open**: the
> live run against a fenced account has not been executed (no Cloudflare access in the executing
> environment), and the retrieval route stays gated. Record, verdict line, and the live-run checklist:
> [`../research/2026-08-07-ai-search-filter-wall-experiment.md`](../research/2026-08-07-ai-search-filter-wall-experiment.md).

1. **Filter disjunction semantics** — E3. Gates firm-wide scope.
2. **Whether filters fail open** — E2. Gates the feature.
3. **Similarity cache isolation** — E4. Recommended default is off regardless.
4. **R2 data source prefix restriction** — E7. Decides feed-in-bucket versus feed bucket.
5. **Instance deletion guarantees** — E5 measures the observable half; the unobservable half stays
   undisclaimed rather than asserted (section 3.2).
6. **Data residency for the managed store** — not addressed anywhere in the enumerated documentation.
   Until answered, the disclosure offers no guarantee. **Not** answerable by experiment; needs Cloudflare.
7. **Per-instance storage attribution** — no per-firm figure is available, so managed storage is not
   metered. Needs Cloudflare reporting.
8. **Retrieval quality on legal prose** against a 512-input-token embedding window — E8. Decides whether the
   feature is worth shipping even if it is safe.
9. **Instance-per-firm behaviour at scale** — creation latency at several thousand instances, and what a
   limit increase past 5,000 involves.
10. **General availability and final pricing.** Preview pricing is explicitly subject to change and billing
    is not enabled. Flag A6.

---

## 12. Owner flags

Six. Each has a recommended default this design and its plan implement, so **slice 1 is buildable with none
of them answered** — approving the recommendations approves what is already written.

| #      | Decision                                                          | Recommended default                                                                                                                                                                                                                                                         |
| ------ | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A1** | Posture                                                           | **Retrieval-only, permanently for this surface.** Passages from the firm's own documents with their citations; never composed prose. Generation would be a separate design behind ADR-0109, not a setting.                                                                  |
| **A2** | Scope in slice 1                                                  | **Matter-scoped queries only.** One `$eq` filter, no disjunction relied on. Firm-wide is slice 3, gated on a proven disjunction and a measured recall figure — the reason is utility, because safety is already carried by read-time re-authorization.                      |
| **A3** | Sub-firm granularity                                              | **Per-matter opt-OUT, defaulting in; review sets never fed at all.** A search covering only the matters someone remembered to tick has invisible gaps. An opt-out deletes existing feed objects, not merely stops new ones.                                                 |
| **A4** | Does the opt-in also require `inference.aiProcessingEligibility`? | **No.** That gate asks about third-party frontier processing, and this feature does none. Requiring it would deny an on-Cloudflare feature to exactly the firms the on-Cloudflare path exists for. Its own gate, defaulting closed, with a firm-level versioned disclosure. |
| **A5** | Similarity cache                                                  | **Off.** Keys on prompt text with an undocumented isolation scope; contains firms but not matters. The saved query does not buy the hazard.                                                                                                                                 |
| **A6** | When a real firm may be enabled                                   | **Not until Cloudflare takes AI Search to general availability with final pricing** — and then only for firms that have accepted the disclosure. Build it now, behind the gate; enable it when the product stops being a beta with billing not yet switched on.             |

**Still blocking nothing here, and unchanged:** ADR-0109 remains _Proposed_. Retrieval-only does not need
it; the generation this design refuses would.

---

_Design written by Claude Opus 5 (Claude Code) on 2026-08-06, at the owner's request, over the merged
Cloudflare AI Search assessment._
