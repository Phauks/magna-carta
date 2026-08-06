# Cloudflare AI Search — assessment against our search subsystem

**Date:** 2026-08-06
**Scope:** What Cloudflare AI Search (formerly AutoRAG) is as of today, the recent Cloudflare writing
on it, and an honest fit assessment against three things we already have or have designed: the
keyword write pipeline and `SearchIndexPort` in `packages/search`, the planned Vectorize semantic
half, and the AI-consent posture in ADR-0109 through ADR-0113.
**Prompted by:** the owner's question — "how are we on search/discover/ai/natural language search. I
want to identify how to leverage Cloudflare AI search, see latest articles from cloudflare relating to
topic."
**Purpose:** This is **research, not a spec and not a decision.** Nothing here is built or committed.
The binding decisions in this area are already recorded — ADR-0012 (Tantivy keyword + Vectorize
semantic), ADR-0207 (splits in R2), ADR-0208 (the write pipeline), ADR-0003 (tenancy), and ADR-0109
through ADR-0113 (AI / inference) — and nothing in this document changes any of them. Items labelled a
recommendation are recommendations only; items labelled owner-decision are requests for one.

**Method.** The `developers.cloudflare.com/ai-search/` tree was enumerated two ways on **2026-08-06** —
Cloudflare's sitemap (86 URLs) and the section's own `llms.txt` index (76 entries) — and the
load-bearing pages read as raw Markdown, not through a summarizer. Every factual claim below carries
the page it came from. Cloudflare's own
"Last updated" date is given where it differs materially from the fetch date, because several of these
pages changed the same week.

---

## 1. Summary — the recommendation, stated plainly

**Recommendation: adopt-partially, and not for the thing the question points at.** AI Search cannot
replace the discovery keyword engine and should not; it is a genuine candidate to replace the
_unbuilt_ Vectorize semantic half for one narrow shape; and the natural-language search the owner is
actually asking about is a **different, smaller, better-fitting product surface** than discovery — a
retrieval-only semantic search over a firm's own working documents.

Five findings carry that conclusion, and three of them are things this assessment expected to go the
other way.

**First, the keyword half is not a contest.** AI Search's keyword mode is BM25 over chunks with a
choice of two tokenizers (`porter` or `trigram`) and an all-terms-or-any-term match mode. The
documentation describes **no phrase search, no proximity operator, no wildcard, no field-scoped term,
and no boolean grouping** — and no query syntax at all. E-discovery search _is_ those operators
("every document mentioning 'indemnify' within five words of 'seller'"). AI Search also returns a
chunk and a score, never a **highlight offset into the source document**, which a review surface needs
to show a hit inside a 400-page PDF. Against an engine (`crates/search-core` + the `SearchIndexPort`
write pipeline) that is already built and whose only missing piece is a Container deploy, this is not
close.

**Second, the objection recorded in the prior Cloudflare Agents assessment is one-third wrong, and the
correction matters.** That document refused AI Search in a single line, on the grounds that it "would
place content and embeddings in a managed store outside the per-firm partition, and break the pin."
The first half is right. **The pin claim is wrong.** AI Search supports `@cf/baai/bge-large-en-v1.5`
at 1,024 dimensions — the exact model `packages/inference/src/catalog.ts` fixes — and the embedding
model "is set when creating an instance and **cannot be changed after creation**." That is not a
broken pin; that is the same pin, enforced by the platform instead of by our comment. Section 6.2
takes the semantic question seriously as a result.

**Third, the decisive constraint is one nobody would guess, and it is in our own code.** Our R2 object
key is `files/{fileId}/{versionId}` (`packages/file-manager/src/file-statements.ts`) — **flat, with no
matter in the path.** The matter lives in D1, not in the key. AI Search's whole per-tenant and
per-scope filtering story rests on its built-in `folder` attribute, which is the object key's prefix.
So against the bucket as it is laid out today, **AI Search cannot express "this matter" at all.** The
only route is a custom metadata field, and an instance gets **five of them, 500 characters each**, set
at R2 put time (we do not set any today), with a schema change triggering "a full re-index of all
documents." The ethical-wall question therefore does not fail on filter _expressiveness_ — it fails
earlier, on the absence of a scope dimension in the data.

**Fourth, and this is the point in Cloudflare's favour: the confidentiality posture of retrieval-only
AI Search is better than expected, not worse.** Every instance's model calls run through an AI Gateway
and default to **Workers AI** models — the on-Cloudflare path that ADR-0110 already names as the
_strict_ default for the most conservative firms. A retrieval-only configuration (`search()`, query
rewriting off, reranking on `@cf/baai/bge-reranker-base`) makes **no third-party frontier call at
all**, which means it sits on the safe side of the ADR-0109 line rather than waiting behind it. And
its ingestion parses hostile bytes — PDF, Office, images — on Cloudflare's infrastructure rather than
in our Containers, which is a real golden-rule-14 surface reduction, stated honestly in section 6.6.

**Fifth, the cost shape decides the storage question before any of this matters.** Preview pricing
published today puts AI Search storage at **$2.00/GB-month** against R2 Standard's $0.015/GB-month —
roughly **130×**. Copying a firm's corpus into built-in storage is therefore off the table for
anything bulk, which forces the R2-backed data source, which in turn brings a **scheduled sync
(1 hour minimum, 6 hours by default)** instead of our index-off-ingest-commit. "I filed it two minutes
ago, find it" stops working. That is a product regression, not a tuning parameter.

**What to do, in order:** (1) change nothing in discovery — deploy the search Container, which is the
one thing standing between a built pipeline and real hits; (2) treat AI Search as the leading
candidate for the _unbuilt_ semantic half and for a firm-facing natural-language document search, and
prove or kill it with the fenced test in section 8; (3) if the semantic half goes to AI Search, the
prerequisite is a scope dimension in R2 metadata, which is cheap to add now and expensive later, for
exactly the reason the corpus scope key was widened.

---

## 2. What we already have (so the question is narrower than it looks)

Worth stating before evaluating anything, because "how are we on search" has a more advanced answer
than the roadmap's not-started rows suggest.

**Built and on the tree** (`status.d/discovery-search-index.md`, ADR-0207, ADR-0208):

- `crates/search-core` — the pure-Rust Tantivy engine core, a read-only `Directory` over a
  `RangeReader`, so a query prunes on split footers and range-reads only the postings it walks.
- `packages/search` — `SearchIndexPort` with typed outcomes (`port.ts`), the corpus scope key
  (`corpus.ts`), derived content-addressed split keys (`split.ts`), and the extraction port
  (`extraction.ts`).
- The per-firm `index_split` catalog and its data-access statements; keyword and hybrid query
  composition with reciprocal rank fusion already written.
- The **write pipeline** — a `SearchIndexJob` Durable Object over a dead-lettered queue turning each
  committed document version into one split, gated per firm by `search.indexing_enabled` (off by
  default) and enqueued off the clean ingest commit.
- **Composite extraction, decided per page**: the document's own text layer read natively in
  `crates/pdf-core`, only the pages with none going to recognition, with per-page `native`/`ocr`
  provenance on the result.

**Designed, not built:** the Vectorize semantic half — namespace-per-firm partitioning, 1,024-dimension
`bge-large-en-v1.5` through `InferencePort.embed`, fused with BM25 hits by reciprocal rank fusion.
Zero code, zero sunk cost.

**Not deployed:** `apps/search-worker`, the always-warm Container that actually answers `/index`,
`/query`, `/remove`. Until it exists every job parks in a distinct `deferred` state — acked and
restartable, never dead-lettered — so deploying it drains the backlog naturally.

**Recently widened:** the index scope key moved from matter to **corpus** (`corpus_kind` +
`corpus_id`), so a review set and a matter are separate indexes and material received from an opposing
party cannot surface in a search of the firm's own working files. Today the union has exactly one
member and the mapping is the identity.

**Still open on the owner ledger:** ADR-0109 (the client-consent model) remains _Proposed_. Discovery
flag **D4** sets semantic indexing **off by default, enabled per review set**, because embedding a
large corpus is a real metered cost a firm should choose. Discovery flag **D8** caps a review set at
**250,000 documents**.

So the question is not "should we build search on Cloudflare" — the keyword half is built. The
question is precisely: **does AI Search do better than the parts we have not built yet, and does it
unlock a natural-language surface we do not currently have a plan for?**

---

## 3. What AI Search actually is

### 3.1 The pipeline

A managed retrieval-augmented-generation pipeline with two halves
([How AI Search works](https://developers.cloudflare.com/ai-search/concepts/how-ai-search-works/),
fetched 2026-08-06, page dated 2026-07-06):

**Indexing** (asynchronous): data ingestion from the configured source → **Markdown conversion** via
Workers AI's Markdown Conversion, which for images runs object detection followed by
vision-to-language → **recursive chunking** → **embedding** via a Workers AI or third-party embedding
model → **keyword indexing** for BM25 when enabled → storage of vectors, keyword index, and content.

**Querying** (synchronous): optional **query rewriting** by an LLM → query embedding → vector search →
optional parallel BM25 → optional **fusion** (`rrf` or `max`) → optional **reranking** by a
cross-encoder → chunk retrieval → optionally, **response generation** by a text model.

Cloudflare draws the AI Search / Vectorize line itself on that page: "Use Vectorize when you want to
manage vectors yourself, and AI Search when you want managed search over your content."

### 3.2 Data sources, and where the bytes end up

Three sources ([Data source](https://developers.cloudflare.com/ai-search/configuration/data-source/),
fetched 2026-08-06, page dated 2026-08-06): **built-in storage** (upload through the Items API),
**website** (crawl a domain you own), **R2 bucket**.

The consequential fact is the **migration to managed infrastructure**, completed 2026-06-18
([Release note](https://developers.cloudflare.com/ai-search/platform/release-note/), fetched
2026-08-06): "Every instance now includes built-in storage, a built-in vector index, and built-in web
crawling." Instances created before that ran on Cloudflare services _in your own account_; they no
longer do. Built-in storage and the vector index are Cloudflare-managed R2 and Vectorize —
[Built-in storage](https://developers.cloudflare.com/ai-search/configuration/data-source/built-in-storage/)
— **not our per-firm bucket, and not a Vectorize index we can name, inspect, or partition.**

The R2 data source is the exception that keeps the originals where they are: an instance is pointed at
a bucket and reads from it. That path requires a **service API token**
([Service API token](https://developers.cloudflare.com/ai-search/configuration/indexing/service-api-token/),
fetched 2026-08-06), and the documented token is account-scoped —
`"com.cloudflare.api.account.<ACCOUNT_ID>": "*"` with the AI Search Index Engine permission — "saved to
your account and reused across all AI Search instances." One token, read access to R2 in the account,
not per bucket.

**Supported file types** cover PDF, `.docx`, `.xlsx`, `.odt`/`.ods`, HTML, XML, CSV, images, and a long
list of plain-text and source formats. **Not in the list:** `.doc`, `.xls`, `.ppt`, `.pptx`, `.rtf`,
WordPerfect, `.eml`, or `.msg`. Legacy binaries and email are a substantial fraction of a received
production, and discovery flag D10 already routes them through the consented LibreOffice Container.

**File size limit: 4 MB.** "Files that exceed this limit will not be indexed and will show up in the
error logs."

**Sync** ([Syncing](https://developers.cloudflare.com/ai-search/configuration/indexing/syncing/),
fetched 2026-08-06, page dated 2026-07-08): built-in storage indexes files immediately; external
sources run scheduled jobs, **every 6 hours by default**, settable to 1, 2, 4, 6, 12, or 24 hours, with
a manual trigger available at most once every 30 seconds. An instance receiving no search request for
**31 days** has its scheduled syncs paused automatically.

### 3.3 Query paths

Four, and they are genuinely well-covered
([Workers binding](https://developers.cloudflare.com/ai-search/api/search/workers-binding/), fetched
2026-08-06):

- **Workers bindings** — `ai_search_namespaces` (get / list / create / delete instances at runtime) and
  `ai_search` (bound to one named instance). `get()` is synchronous and makes no network call.
- **REST API**, OpenAI-compatible.
- **MCP**, but only via a **public endpoint**
  ([MCP](https://developers.cloudflare.com/ai-search/api/search/mcp/), fetched 2026-08-06) — enabling it
  is what creates `<id>.search.ai.cloudflare.com`, unauthenticated by default, with a 120-requests-per-
  minute rate limit and CORS on. Custom domains plus Cloudflare Access can front it (announced
  2026-08-06), but the default posture is public.
- **Python SDK, Wrangler CLI, and framework adapters** for the Agents SDK, the Vercel AI SDK, and
  LangChain (added 2026-07-30).

Two methods matter for the posture question. **`search()`** returns scored chunks with source
references and per-signal scoring detail — retrieval only, no model-generated prose. **
`chatCompletions()`** retrieves and then generates, streaming optional, returning the source chunks
alongside the answer. They are separate calls, which is what makes a retrieval-only posture
expressible rather than aspirational.

Retrieval controls worth naming: `retrieval_type` (`vector` / `keyword` / `hybrid`, default `hybrid`),
`match_threshold` (default 0.4), `max_num_results` (1–50, default 10), `context_expansion` (0–3
surrounding chunks), `fusion_method` (`rrf` or `max` — the same reciprocal rank fusion our design
already specifies), `boost_by` (up to 3 metadata fields), and `metadata_only`.

### 3.4 Metadata and filtering — the ethical-wall question

This is the section the assessment was commissioned for, and it has a sharper answer than expected.

**Built-in attributes** are exactly three
([Metadata attributes](https://developers.cloudflare.com/ai-search/configuration/indexing/metadata/),
fetched 2026-08-06, page dated 2026-08-06): `filename`, `folder` (the object key's prefix), and
`timestamp`.

**Custom attributes** are capped hard: **"Maximum of 5 custom metadata fields per AI Search
instance"**, text values truncated at **500 characters**, field names cannot collide with the three
reserved names, and — the operational sting — **"Changing the schema triggers a full re-index of all
documents."** For an R2 source they are read from `x-amz-meta-*` headers set at put time.

**Filter syntax**
([Filtering](https://developers.cloudflare.com/ai-search/configuration/retrieval/filtering/), fetched
2026-08-06, page dated 2026-06-17): comparison operators `$eq $ne $in $nin $lt $lte $gt $gte`, multiple
keys combined by an **implicit AND**, and a documented "starts with" idiom for folders using a range
query (`{ folder: { $gte: "docs/", $lt: "docs0" } }`). Filters are "applied before retrieval."

**An unreconciled contradiction in Cloudflare's own documentation, recorded because it is
load-bearing:** the Filtering page documents no disjunction at all, while the Workers binding API
reference for the same `filters` parameter says it "supports comparison filters (`eq`, `ne`, `gt`,
`gte`, `lt`, `lte`) and **compound filters (`and`, `or`)**." The legacy AutoRAG filter format page does
document `and`/`or`, with the limitations that there are "no nested combinations" and that "when using
`or`, only the `eq` operator is allowed and all conditions must filter on the same key." Whether the
current syntax has a disjunction, and of what shape, **is not determinable from the documentation** and
is on the do-not-conclude list in section 9.

**Why this is not where the ethical wall fails.** Even granting the most generous reading of the filter
syntax, the wall fails one step earlier. An ethical wall is "user U may see matters {A, B, C} and must
not see matter D." Expressing that against AI Search needs a matter dimension on the indexed document.
Our R2 key is `files/{fileId}/{versionId}` — flat. `folder` resolves to `files/{fileId}/`, which
identifies the document and says nothing about its matter. The matter is a D1 column
(`file.matter_id`), reachable only through the firm-scoped data-access layer.

So the matter dimension would have to be added as **one of the five custom metadata fields**, written
as an `x-amz-meta-*` header at R2 put time by the ingest path, which does not set one today. That is
buildable and it is cheap _now_ — it is exactly the "expensive to retrofit" shape that justified
widening the corpus scope key — but it does not exist, and retrofitting it across an existing corpus
means rewriting object metadata for every file plus a full re-index.

**And a difference in kind, not degree, that survives even if the metadata exists.** In our design,
isolation is **structural**: a firm's splits are in that firm's bucket, and the catalog a query prunes
against lives in that firm's own database, so a query can only ever name splits its own firm owns. In
AI Search's shared-instance model, isolation is **a filter argument the caller constructs on every
request**. A bug that drops or mis-builds the filter is a cross-matter disclosure with no second line
of defence. Cloudflare's own multitenancy guidance agrees on which is stronger: it recommends
**instance-per-tenant**, and describes the shared-instance-plus-filter option as the one to "choose
when you have many small tenants and want the simplest setup"
([Multitenancy](https://developers.cloudflare.com/ai-search/how-to/per-tenant-search/), fetched
2026-08-06, page dated 2026-07-10).

### 3.5 Models and the control plane

**Supported models**
([Supported models](https://developers.cloudflare.com/ai-search/configuration/models/supported-models/),
fetched 2026-08-06, page dated 2026-06-17):

- _Embedding:_ `@cf/baai/bge-m3`, **`@cf/baai/bge-large-en-v1.5` (1,024 dims, cosine)**,
  `@cf/qwen/qwen3-embedding-0.6b`, `@cf/google/embeddinggemma-300m`, plus OpenAI
  `text-embedding-3-small`/`-large` and Google `gemini-embedding-001` at 1,536.
- _Reranking:_ `@cf/baai/bge-reranker-base` only.
- _Text generation:_ Workers AI models plus Anthropic, OpenAI, Google AI Studio, Cerebras, Groq, and
  Grok through AI Gateway keys.

The embedding model "is set when creating an instance and cannot be changed after creation"
([Vector search](https://developers.cloudflare.com/ai-search/configuration/indexing/vector-search/),
fetched 2026-08-06). That is the version pin our port comment demands, enforced by the platform.

**Every instance is connected to an AI Gateway**, and "the model calls that AI Search makes for
embedding, query rewriting, reranking, and response generation run through this gateway"
([AI Gateway](https://developers.cloudflare.com/ai-search/configuration/models/ai-gateway/), fetched
2026-08-06, page dated 2026-07-06). By default AI Search uses Workers AI models; other providers
require keys added through Bring Your Own Keys.

**The control-plane gap, stated precisely.** ADR-0110 pins `collectLog: false` and ADR-0113 pins
`skipCache: true` **via the `AI` binding's per-request `gateway` options**. AI Search makes its own
model calls; our code never holds that binding for them. So the per-request mechanism both ADRs
specify **does not apply** — only gateway-level configuration does. And the gateway page states plainly
that logs "inspect individual requests and responses, including the effective system prompt, rewritten
queries, and generated answers." Whatever posture is chosen has to be set on the gateway and verified
there, not asserted per request.

The same page carries two operational warnings that read as a caution about the product's seams: **do
not enable AI Gateway caching** on the connected gateway ("serving cached embeddings can store or
return incorrect vectors and quietly degrade the accuracy of your search results"), and **do not set
rate limiting** on it (it "can interrupt indexing and querying").

**AI Search's own similarity cache** is a separate mechanism
([Similarity cache](https://developers.cloudflare.com/ai-search/configuration/retrieval/cache/), fetched
2026-08-06, page dated 2026-06-24): MinHash plus locality-sensitive hashing over the _prompt text_, with
thresholds from `super_strict_match` to `anything_goes` (default `close_enough`), a `cache_ttl` defaulting
to 48 hours, and cached responses "tied to specific document chunks." Against ADR-0113 — whose entire
subject is that a cache key without a firm dimension can collide across firms — this needs a deliberate
answer. Instance-per-firm contains it structurally. A shared instance does not, and the documentation
does not state the cache's isolation scope. On the do-not-conclude list.

### 3.6 Limits, pricing, and status

**Status: open beta since 2026-04-07, still.** The blog post published today says it directly: "AI
Search is currently free while in beta, and billing is not yet enabled; we'll email you with plenty of
notice before it starts." Not GA.

**Limits**
([Limits & pricing](https://developers.cloudflare.com/ai-search/platform/limits-pricing/), fetched
2026-08-06, page dated 2026-08-06), Workers Paid unless noted:

| Limit                                       | Workers Paid                           |
| ------------------------------------------- | -------------------------------------- |
| AI Search instances per account             | **5,000**                              |
| **Namespaces per account**                  | **100** (same on Free)                 |
| Files per instance                          | **1M**, or **500K with hybrid search** |
| Max file size                               | **4 MB**                               |
| Queries per month                           | Unlimited                              |
| Instances per cross-instance search request | **10**                                 |
| Max custom metadata fields                  | **5 per instance**                     |
| Max text metadata value length              | **500 characters**                     |

A limit-increase request form is offered, which means these are soft — but a form is not a number.

**Preview pricing**, published in today's blog post and explicitly subject to change: base ingestion
**$0.75 / 1M tokens** (5M free), image processing **+$0.50 / 1M tokens** (5M free), storage **$2.00 /
GB-month** (10 GB free), semantic search **$0.75 / 1k queries** (2,000 free), full-text search **$0.10 /
1k queries**, embedding and reranking free on selected models. Cloudflare's worked example: 20,000
documents plus 1,000 images with 30,000 monthly semantic queries is about **$35 the first month**
(mostly indexing) and about **$21** thereafter.

**Two arithmetic consequences we should state rather than discover.**

_Storage._ $2.00/GB-month against R2 Standard's $0.015/GB-month is **roughly 130×**. Whether that rate
applies to derived index content for an R2-backed instance or only to bytes held in built-in storage is
not stated anywhere and is on the do-not-conclude list — but if it is the former, a firm's corpus in
built-in storage is not a cost we would accept for a search index.

_Ingestion at discovery scale._ Discovery flag D8 caps a review set at 250,000 documents. At a
conservative 5,000 tokens per document that is ~1.25 billion tokens, or about **$940 in ingestion for
one review set** at the preview rate. That is the same order as the metered embedding cost D4 already
puts behind an off-by-default switch, which is a consistency worth noting: whichever engine does it,
embedding a large corpus is a real charge a firm should choose.

---

## 4. The latest Cloudflare writing on the topic

The owner asked for this explicitly. The `ai-search` blog tag holds four posts; the three that matter
are the first three, and the most relevant was published **today**.

**1. [Cloudflare AI Search: give your agents a search engine for your data](https://blog.cloudflare.com/ai-search-easier/)
— 2026-08-06.** The developer-experience and pricing post: website crawling no longer needs a sitemap
(a new `discover` parse type follows links), public `/search` and `/mcp` endpoints can be served from a
custom domain and protected with Cloudflare Access, and **preview pricing is published for the first
time** along with confirmation that the product is still free in beta with billing not yet enabled.
Its framing is notable for our purposes: it leads with retrieval rather than generation, pitching
"current, cited docs" against "the usual fallback (web search then fetching full pages), which is slow,
token-heavy, and often lands on the wrong or stale source."

**2. [AI Search: the search primitive for your agents](https://blog.cloudflare.com/ai-search-agent-primitive/)
— 2026-04-16.** The rename-and-rebuild post, and the most substantive of the three. AutoRAG became AI
Search; **hybrid search** arrived (vector and BM25 in parallel, fused, optionally reranked); instances
gained **built-in storage and a built-in vector index** so no R2 bucket or Vectorize index has to be
provisioned; the `ai_search_namespaces` binding made instances creatable and deletable at runtime "one
per agent, per customer, or per language without redeployment"; and **cross-instance search** landed,
returning one ranked list from several instances at once. This is the release that makes
instance-per-tenant a serious pattern rather than a manual chore.

**3. [Making AI search smarter](https://blog.cloudflare.com/making-ai-search-smarter/) — 2026-07-01.**
**Not about the AI Search product**, despite the title, and the misdirection is worth flagging so
nobody cites it wrongly: it announces a crawler-efficiency research programme and a "Pay Per Use"
compensation model for publishers whose content appears in answer engines. Its one technically
interesting number — "more than 50% of crawl traffic from good bots goes to re-fetching pages that
haven't changed" — is about the open web, not about indexing your own corpus.

**Also relevant, from the same week's product wave (all 2026-08-04 to 2026-08-06):**
[The next generation of MCP](https://blog.cloudflare.com/mcp-v2/),
[WriteGuard: fine-grained controls for MCP Servers](https://blog.cloudflare.com/mcp-portal-writeguard-private-beta/),
and [Catching rogue AI behavior with identity-aware analytics](https://blog.cloudflare.com/identity-aware-ai-gateway/)
— the last of which is an AI Gateway capability and is the more interesting one for us, because the
gateway is the only control plane available over AI Search's model calls (section 3.5). None of the
three has been read in depth for this assessment; they are named as follow-ups, not summarized from
their titles.

**One honest caveat on this section.** The blog's tag pages and RSS feed are the enumeration source.
Cloudflare publishes heavily during launch weeks — twenty posts appeared in the four days before this
was written — so a topical post could sit under a different tag and be missed. The three above are the
ones the `ai-search` tag returns, and the first two are the substantive ones.

---

## 5. Correcting the prior assessment

Recorded explicitly, because the earlier document is in the tree and will be read.

[`2026-08-04-cloudflare-agents-assessment.md`](2026-08-04-cloudflare-agents-assessment.md) disposed of
this product in one line: "**refuse the managed services** … Agent Memory and AI Search would duplicate
that, place content and embeddings in a managed store outside the per-firm partition, and break the
pin."

| Claim                                                                            | Status                | What the documentation says                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "would duplicate that"                                                           | **Correct**           | For the keyword half, yes, and worse (section 6.1). For the semantic half the duplication is of a design, not of code — nothing is built, so there is nothing to duplicate.                                                                                        |
| "place content and embeddings in a managed store outside the per-firm partition" | **Correct**           | Confirmed and strengthened by the June 2026 managed-infrastructure migration: built-in storage and the vector index are Cloudflare-managed and not nameable from our account. The R2 data source keeps the _originals_ in our bucket; the _index_ is still theirs. |
| "break the pin"                                                                  | **Wrong — corrected** | `@cf/baai/bge-large-en-v1.5` at 1,024 dimensions is supported, and the embedding model is fixed at instance creation and cannot be changed. That is the pin, enforced more strongly than our own comment enforces it.                                              |

**Missed entirely by the one-line refusal, and material:** that retrieval and generation are separate
API calls, so a retrieval-only posture is expressible; that the default model path is Workers AI, which
is ADR-0110's strict default rather than a third-party frontier call; that instance-per-tenant is
Cloudflare's own recommended isolation pattern with a 5,000-instance ceiling; that hostile-byte parsing
moves off our infrastructure; and that the product's keyword half exists at all. The refusal reached a
defensible conclusion for the wrong reasons and without the arithmetic. This document is the arithmetic.

---

## 6. The mapping

### 6.1 Could it replace or augment the keyword engine? **No — replace neither, augment nothing.**

Four reasons, in descending order of how hard they are to argue with.

**Query language.** Discovery search is boolean, phrasal, and proximate. AI Search's keyword half
documents a tokenizer choice (`porter` for natural language, `trigram` for code) and a match mode
(`and` / `or`), and nothing else — no phrase, no proximity, no wildcard, no field scoping, no grouping.
Tantivy has all of them. This is not a maturity gap that a limit-increase form fixes; it is a different
product.

**Highlight offsets.** `search()` returns `chunks[].text` and a score. A review surface has to place a
hit _inside_ the source document, which is why the search-index design ties highlight-offset fidelity
to the searchable-PDF writer's placement correctness. AI Search returns a chunk, not a position.

**Defensible deletion.** Discovery demands that a document withdrawn from a corpus be _provably_ gone
from every index. Our design answers that with an authoritative catalog plus delete-by-id. AI Search's
answer for an R2 source is that deleted files are "removed from the index on next sync" — up to six
hours later by default, and asserted by a managed process rather than demonstrated by a catalog.

**Sunk cost runs the other way.** The engine core, the port, the catalog, the write pipeline, and
composite per-page extraction are built and tested. The missing piece is a Container deploy. Replacing
built work with a beta managed service to lose four capabilities is not a trade.

**Verdict: no change.** Deploy `apps/search-worker`.

### 6.2 Could it replace the planned Vectorize semantic layer? **The real candidate — a qualified yes for one shape.**

Here the calculus genuinely inverts, and it is worth being precise about why.

**What argues for it.** Nothing is built, so there is no sunk cost — only a design. AI Search would
supply the entire semantic half: chunking, embedding, the vector index, metadata filtering, reranking
by a cross-encoder we do not have, and reciprocal rank fusion (`fusion_method: "rrf"` — the same
algorithm our design specifies). The embedding model pin is enforced by the platform. It removes a
Vectorize index we would otherwise have to size, partition, and migrate, and it removes the embedding
fan-out from our queue topology. Measured as engineering avoided, this is a large number.

**What argues against it, and these are not small.**

_The bytes have to go somewhere they are not today._ Built-in storage means copying privileged content
into a Cloudflare-managed store outside the per-firm bucket, at ~130× R2's storage rate. The R2 data
source avoids the copy but brings the ≥1-hour scheduled sync, which breaks index-on-commit.

_Two engines, two indexes, two deletion stories._ Keeping Tantivy for keyword and putting semantic in
AI Search means a document's removal has to be proven in two systems with different guarantees — and
the weaker one sets the answer to "is it gone?"

_Fusion moves out of our control._ Our design fuses BM25 and vector hits with RRF in our own code,
which is what lets one engine return nothing without degrading the other. If AI Search owns the vector
half and Tantivy owns the keyword half, we fuse two external result sets ourselves anyway — so AI
Search's own fusion is unused, and we are paying for a hybrid product to use half of it.

_The scope dimension does not exist_ (section 3.4), and a corpus-grain instance allocation does not
survive the arithmetic: at 5,000 instances per account, one firm with 200 matter corpora consumes 4% of
the account, so instance-per-corpus supports roughly 25 firms. Namespace-per-firm is worse — the
namespace cap is **100 on both plans**. Only **instance-per-firm** scales, and instance-per-firm means
one instance holding every corpus, which puts the whole ethical wall on a query-time filter argument.

**Verdict: a real candidate, gated on a test, and gated behind discovery's own D4 posture.** If the
semantic half is off by default and enabled per review set anyway, then whether it is Vectorize or AI
Search behind the flag is an implementation choice that can be made later, cheaply, behind
`SearchIndexPort` — which is exactly what a port is for. **The right move is not to decide now; it is
to make sure the decision stays cheap.** That means one thing built now: the scope dimension in R2
metadata.

### 6.3 The third answer — neither, and it is the one the owner is asking for

The owner's question was "search/discover/ai/natural language search," and discovery has absorbed the
whole discussion. But there is a surface that is not discovery and not built: **a firm-facing
natural-language search over the firm's own working documents** — "find the retainer where we agreed to
a contingency on appeal," across the matters the user is entitled to see.

For that surface AI Search fits considerably better than it fits discovery:

- Corpus sizes are ordinary (a firm's working documents, not a 250,000-document production), so the
  500K-files-with-hybrid ceiling and the 4 MB file limit are far less binding.
- The R2 data source points at the firm's own bucket — Cloudflare's documented "a bucket per tenant"
  layout is exactly ours.
- Instance-per-firm is Cloudflare's recommended isolation pattern and scales to 5,000 firms.
- A ≥1-hour sync is tolerable for "find that old engagement letter" in a way it is not for review.
- Retrieval-only keeps every model call on Workers AI, which is ADR-0110's strict default.

It remains blocked on the same scope dimension, and it should be measured before it is believed. But
it is the honest answer to the question that was asked, and it is a smaller, cheaper thing to prove
than anything in discovery.

### 6.4 Per-firm isolation, summarized

| Allocation            | Ceiling                       | Isolation mechanism                                    | Verdict                                                                    |
| --------------------- | ----------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------- |
| Namespace-per-firm    | **100 accounts-wide**         | Structural                                             | **Disqualified by the cap** — 100 firms, on both plans.                    |
| Instance-per-corpus   | 5,000 instances accounts-wide | Structural, strongest                                  | **Disqualified by arithmetic** — ~25 firms at 200 corpora each.            |
| **Instance-per-firm** | **5,000 firms**               | Structural across firms; **filter-only within a firm** | **The only allocation that scales.** Moves the ethical wall onto a filter. |
| Shared instance       | n/a                           | Filter-only, including across firms                    | **Refuse** — incompatible with ADR-0003 and with the similarity cache.     |

### 6.5 Privileged content, consent, and the ADRs

**The good news, and it is real.** A **retrieval-only** configuration — `search()` rather than
`chatCompletions()`, `query_rewrite.enabled` left at its `false` default, reranking on
`@cf/baai/bge-reranker-base` — makes **no third-party frontier model call at any point**. Embedding and
reranking are Workers AI. Under ADR-0110 that is the on-Cloudflare path already named as the strict
default for the most conservative firms, and under ADR-0109's recorded (not yet adopted) recommendation
it is the posture that needs no per-matter consent decision. **Retrieval-only AI Search is on the safe
side of the ADR-0109 gate, not behind it.** That is a materially better position than any generative
feature can occupy today.

**The caveats, each stated once.**

_Ingestion is a model call too._ Markdown Conversion sends every scanned page through Workers AI object
detection and vision-to-language. On-Cloudflare, but a model call over privileged bytes, and it should
be disclosed as one.

_The per-request control plane does not reach._ ADR-0110's `collectLog: false` and ADR-0113's
`skipCache: true` are pinned through the `AI` binding on calls our code makes. AI Search makes its own.
Gateway-level configuration is the only lever, and it must be verified at the gateway.

_The similarity cache is an unanswered ADR-0113 question_ (section 3.5). Instance-per-firm contains it;
a shared instance does not; the docs do not say.

_Generation changes the answer completely._ `chatCompletions()` with an Anthropic or OpenAI model is a
third-party frontier call over privileged content, and lands squarely behind ADR-0109 plus ADR-0110's
procurement artifacts.

_Public endpoints must never be enabled._ `/search`, `/chat/completions`, and `/mcp` are unauthenticated
by default on a Cloudflare-generated hostname that "is never rotated." For a privileged corpus that is
a disclosure surface, not a feature. Cloudflare Access in front of a custom domain exists, but the
correct posture here is simpler: the endpoints stay off, and every query goes through our own
`/api/v1` chokepoint where authentication, RBAC, and the matter filter are constructed server-side.

### 6.6 Golden rule 14 — the honest scoring

Golden rule 14 prefers memory-safe languages and treats memory-unsafe code parsing untrusted privileged
bytes as a confidentiality risk even inside a sandbox.

**AI Search is a win here, and it should be recorded as one.** Their pipeline parses PDF, Office, and
image bytes on Cloudflare's infrastructure. Whatever those parsers are written in, a hostile document
that exploits one of them exploits Cloudflare's boundary, not a Container inside our account holding a
service binding to a firm's data. That is a genuine reduction in our attack surface and it argues in
the product's favour.

**Three things it does not do, which is why it does not replace our extraction path.**

It does not give us **per-page `native`/`ocr` provenance**, which the review exception report needs to
distinguish "the text the author typed" from "a recognizer's reading of a picture." It does not give us
**page counts**, which Bates numbering needs and which cannot be recovered later without re-reading the
corpus. And its conversion is a black box, so it cannot satisfy the discovery rule that **loaded bytes
are never modified and every derived artifact is a new object at a new key**.

So the honest scoring is: a real safety win on the _parse_ surface, over a _subset_ of formats
(remembering `.doc`, `.msg`, `.eml`, and WordPerfect are absent), that does not remove the need for our
own extraction. If AI Search is adopted for the semantic half, the sound shape is to feed it
**already-extracted text** — which the pipeline already produces — rather than raw documents, keeping
provenance, page counts, and byte-fidelity on our side and letting AI Search do only what it does
better.

That shape has a pleasing property: extracted text is small, plain, well under the 4 MB limit, immune
to the missing-format problem, and cheaper to ingest at $0.75/1M tokens than raw documents with images
at $1.25.

---

## 7. Natural-language search: retrieval-only versus generation

The owner asked what natural-language search actually buys. The two modes are genuinely different
products and the difference is about who is accountable for the answer.

**Retrieval-only (`search()`)** takes a question in ordinary language and returns **passages from the
firm's own documents**, ranked, each with its source file and a score, optionally with surrounding
chunks for context. The user reads the firm's own words. If nothing matches above the threshold, the
result is empty — the system says it found nothing rather than composing something. Every citation is a
real document because there is no generation step in which one could fail to be.

**Full RAG (`chatCompletions()`)** takes the same question and returns **prose composed by a language
model** from those passages. It is faster to read and it is the demo everyone wants. It also relocates
the verification burden: the model can state a proposition the retrieved passages do not support, or
omit the passage that contradicts it, and the citations returned alongside are the chunks that were
_retrieved_, not evidence that the sentence they sit beside is entailed by them. In a legal product the
failure mode is not an embarrassing answer — it is a confidently wrong statement about a client's
matter, sourced to the client's own file.

**The recommended posture: retrieval-only, and say so in the interface.** It fits this platform's
character — the same instinct that makes discovery quarantine rather than auto-delete, that refuses a
review set above its ceiling by name with the count and the ceiling in the message, and that parks an
index job in a distinct `deferred` state rather than pretending it succeeded. A search that returns
"here are the four passages in your files that are about this, and here is where each one is" is a tool
a lawyer can rely on and cite. A search that returns a paragraph is a tool a lawyer has to check, which
means the work was not saved.

There is a second reason, and it is the one that decides it under the current ADRs: **retrieval-only
needs no consent decision that has not already been made.** It stays on Workers AI. Generation does
not, and ADR-0109 is still _Proposed_.

**What this does not foreclose.** Generation over the same index is a configuration change and a
different call on the same instance, not a rebuild. When ADR-0109 is decided and the ADR-0110
procurement artifacts are in hand, a generative layer can be added on top of a retrieval-only surface
that has already proven its retrieval quality — which is the right order anyway, because a RAG answer
is only ever as good as the retrieval underneath it.

---

## 8. The recommendation

**Adopt-partially. Specifically: refuse it for keyword, keep it live as the leading candidate for the
unbuilt semantic half, prove it on a firm-facing natural-language document search, and never enable
generation or a public endpoint.**

**Do now (no dependency on AI Search, worth doing regardless)**

1. **Deploy `apps/search-worker`.** It is the single thing between a built pipeline and real hits, the
   adapter already calls exactly its endpoints, and every downstream question in this document is
   easier to answer against a working keyword baseline. _Size: the deploy step the status fragment
   already names._
2. **Add a matter (or corpus) dimension to R2 object metadata at put time**, as an `x-amz-meta-*`
   header on the file-version write in `packages/file-manager`. This is the prerequisite for every AI
   Search shape in this document, it is free while the corpus is small, and retrofitting it means
   rewriting object metadata across every firm's bucket plus a full re-index. It is the same reasoning
   that widened the corpus scope key and that put `storage_encoding` on `file_version` before any delta
   existed — and it costs nothing if AI Search is never adopted, because a matter dimension on the
   object is independently useful. _Size: small, and it belongs to whoever is next in that file._
3. **Record the beta status and the preview pricing** wherever Cloudflare platform costs are tracked
   (`docs/operating-costs.md`), flagged as preview and not yet billed. _Size: minutes._

**Prove or kill (fenced, synthetic data only)**

4. **A retrieval-only natural-language document search, on load-profile fixtures, with no firm data at
   any point.** One instance, R2-backed against a synthetic bucket laid out as ours is, embedding model
   `@cf/baai/bge-large-en-v1.5`, hybrid indexing on, query rewriting off, reranking on, generation
   never called, public endpoints never enabled, every query built server-side behind `/api/v1` with
   the matter filter derived from the authenticated session. **The questions it answers:** does
   retrieval quality over legal documents justify the dependency; does the folder-plus-custom-metadata
   filter actually enforce a matter scope; what does the similarity cache do across instances; and what
   does ingestion of a realistic corpus cost. _Size: about a week. A negative answer is a good outcome
   and cheap to reach._
5. **Measure the sync-latency regression honestly** as part of that test — time from `PUT` to
   searchable at each allowed `sync_interval`. If the answer is "an hour," that is the product fact that
   decides whether this can ever back a primary search box.

**Defer**

6. **The semantic half's engine choice.** It sits behind `SearchIndexPort` and behind D4's
   off-by-default flag. Decide it when the semantic half is actually scheduled, with the section 8
   test results in hand. Nothing is lost by waiting and the port is what makes waiting free.
7. **MCP, public endpoints, UI snippets, NLWeb, and the agent-framework adapters.** Each is a
   disclosure surface or a dependency on a surface we do not want.

**Refuse**

8. **AI Search as the discovery keyword engine.** Section 6.1.
9. **Generation (`chatCompletions()`) over privileged content**, until ADR-0109 is Accepted and
   ADR-0110's procurement artifacts are in hand. Retrieval-only does not need that gate; generation
   does.
10. **Any shared-instance-across-firms allocation.** Section 6.4.

---

## 9. What NOT to conclude without testing

Listed explicitly, because every one of these is a place where the documentation is silent, ambiguous,
or contradicts itself, and where an assumption would be load-bearing.

1. **Whether the current filter syntax supports disjunction.** The Filtering page documents none; the
   Workers binding API reference for the same parameter claims `and`/`or`; the legacy format page
   documents `or` with severe restrictions. **Do not design an ethical wall against a disjunction until
   one has been observed working.**
2. **Whether the similarity cache is scoped per instance.** The docs describe the mechanism (MinHash /
   LSH over prompt text) and say responses are "tied to specific document chunks," but never state the
   isolation boundary. This is a direct ADR-0113 question and must be answered empirically before any
   shared surface.
3. **Whether the $2.00/GB-month storage rate applies to derived index content for an R2-backed
   instance**, or only to bytes in built-in storage. The difference is between a rounding error and a
   disqualifying cost.
4. **Whether preview pricing survives to general availability.** It is labelled preview, the product is
   in open beta, and billing is not enabled. Every cost number in section 3.6 is provisional.
5. **Retrieval quality on legal prose.** Nothing in the documentation predicts how a
   512-input-token embedding model performs over statutory language, defined terms, and
   cross-referenced contract clauses. `bge-large-en-v1.5` truncates at 512 input tokens, which for
   dense legal text is a short window. Measure against fixtures.
6. **Whether the ~130× storage ratio and the ingestion rate hold at discovery scale.** The published
   worked example is 20,000 documents. Discovery's ceiling is 250,000. Extrapolation across an order of
   magnitude is not a measurement.
7. **Whether an instance-per-firm allocation actually behaves at several thousand instances** —
   creation latency, the 31-day inactivity auto-pause interacting with a firm that searches rarely, and
   what a limit increase past 5,000 really involves.
8. **What indexing throughput is.** "Performance depends on the number and type of files" is the whole
   of the documented answer. A 250,000-document load has to complete in a bounded time or it is not a
   discovery tool.
9. **Whether `.doc`, `.msg`, `.eml`, and WordPerfect are genuinely unsupported** or merely undocumented.
   The absence is inferred from a supported-types table, not from an explicit statement.
10. **Whether gateway-level configuration can actually pin the confidentiality posture** that ADR-0110
    and ADR-0113 pin per request — and whether the effective setting is verifiable from the gateway
    rather than merely asserted.
11. **Whether deleting an item is provable.** Discovery needs "provably gone," not "removed on next
    sync." What the Items API guarantees on delete, and how a caller confirms it, is untested.

---

## 10. Owner flags

Four, each with a recommended default. Approving the recommendations approves the posture in this
document; none of them commits to adopting AI Search.

| #      | Decision                                                            | Recommended default                                                                                                                                                                                                |
| ------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **S1** | Natural-language search posture                                     | **Retrieval-only.** Passages from the firm's own documents with their sources, never model-composed prose. Generation is a later, separately-consented layer over the same index — not a setting we ship on.       |
| **S2** | Add a matter/corpus dimension to R2 object metadata now             | **Yes.** Free today, a metadata rewrite across every firm's bucket plus a full re-index later, and independently useful whether or not AI Search is ever adopted. Same reasoning as the corpus scope-key widening. |
| **S3** | Whether to run the fenced retrieval-only test (section 8, item 4)   | **Yes — synthetic fixtures only, no firm data at any point, one week, deliberately throwaway.** A negative result is a good outcome and is the cheapest way to close the question.                                 |
| **S4** | AI Search public endpoints (`/search`, `/chat/completions`, `/mcp`) | **Never enabled.** Unauthenticated by default on a non-rotating hostname. Every query goes through our own `/api/v1` chokepoint where the matter filter is built server-side.                                      |

**Still blocking, and unchanged by this document:** **ADR-0109** remains _Proposed_. Retrieval-only AI
Search does not need it (section 6.5); anything generative does.

---

## 11. Sources

**Primary — `developers.cloudflare.com/ai-search/`**, enumerated from the Cloudflare sitemap (86 URLs)
and [`llms.txt`](https://developers.cloudflare.com/ai-search/llms.txt) (76 entries), read as raw
Markdown on **2026-08-06**. Pages load-bearing for this assessment:

- [Overview](https://developers.cloudflare.com/ai-search/) ·
  [How AI Search works](https://developers.cloudflare.com/ai-search/concepts/how-ai-search-works/) ·
  [Search modes](https://developers.cloudflare.com/ai-search/concepts/search-modes/) ·
  [Namespaces](https://developers.cloudflare.com/ai-search/concepts/namespaces/)
- [Data source](https://developers.cloudflare.com/ai-search/configuration/data-source/) ·
  [Built-in storage](https://developers.cloudflare.com/ai-search/configuration/data-source/built-in-storage/) ·
  [R2](https://developers.cloudflare.com/ai-search/configuration/data-source/r2/)
- [Chunking](https://developers.cloudflare.com/ai-search/configuration/indexing/chunking/) ·
  [Keyword search](https://developers.cloudflare.com/ai-search/configuration/indexing/keyword-search/) ·
  [Vector search](https://developers.cloudflare.com/ai-search/configuration/indexing/vector-search/) ·
  [Metadata attributes](https://developers.cloudflare.com/ai-search/configuration/indexing/metadata/) ·
  [Syncing](https://developers.cloudflare.com/ai-search/configuration/indexing/syncing/) ·
  [Service API token](https://developers.cloudflare.com/ai-search/configuration/indexing/service-api-token/)
- [Filtering](https://developers.cloudflare.com/ai-search/configuration/retrieval/filtering/) ·
  [Similarity cache](https://developers.cloudflare.com/ai-search/configuration/retrieval/cache/) ·
  [Public endpoint settings](https://developers.cloudflare.com/ai-search/configuration/retrieval/public-endpoint/)
- [Supported models](https://developers.cloudflare.com/ai-search/configuration/models/supported-models/) ·
  [AI Gateway](https://developers.cloudflare.com/ai-search/configuration/models/ai-gateway/)
- [Search — Workers binding](https://developers.cloudflare.com/ai-search/api/search/workers-binding/) ·
  [Items — Workers binding](https://developers.cloudflare.com/ai-search/api/items/workers-binding/) ·
  [MCP](https://developers.cloudflare.com/ai-search/api/search/mcp/) ·
  [Metadata filter (legacy)](https://developers.cloudflare.com/ai-search/api/migration/autorag-filter-format/)
- [Multitenancy](https://developers.cloudflare.com/ai-search/how-to/per-tenant-search/) ·
  [Limits & pricing](https://developers.cloudflare.com/ai-search/platform/limits-pricing/) ·
  [Release note](https://developers.cloudflare.com/ai-search/platform/release-note/)

**Cloudflare blog**, fetched 2026-08-06:
[Cloudflare AI Search: give your agents a search engine for your data](https://blog.cloudflare.com/ai-search-easier/) (2026-08-06) ·
[AI Search: the search primitive for your agents](https://blog.cloudflare.com/ai-search-agent-primitive/) (2026-04-16) ·
[Making AI search smarter](https://blog.cloudflare.com/making-ai-search-smarter/) (2026-07-01) ·
[the `ai-search` tag](https://blog.cloudflare.com/tag/ai-search/)

**Supporting Cloudflare documentation:**
[R2 pricing](https://developers.cloudflare.com/r2/pricing/) ·
[Vectorize](https://developers.cloudflare.com/vectorize/) ·
[Workers AI Markdown Conversion](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/) ·
[AI Gateway](https://developers.cloudflare.com/ai-gateway/)

**In-repo:** the white paper's _AI / inference_, _Core domain_, and _Tenancy and data isolation_ topics;
ADR-0003, ADR-0012, ADR-0109 through ADR-0113, ADR-0167, ADR-0207, ADR-0208;
[`docs/specs/2026-07-17-discovery-search-index-stateful-service-design.md`](../specs/2026-07-17-discovery-search-index-stateful-service-design.md);
[`docs/specs/2026-08-05-discovery-5-1-design.md`](../specs/2026-08-05-discovery-5-1-design.md);
[`docs/research/2026-08-04-cloudflare-agents-assessment.md`](2026-08-04-cloudflare-agents-assessment.md);
[`docs/research/2026-08-05-cloudflare-ci-evaluation.md`](2026-08-05-cloudflare-ci-evaluation.md);
`packages/search/src/{port,corpus,split,extraction,settings}.ts`;
`packages/file-manager/src/file-statements.ts`; `packages/inference/src/catalog.ts`;
`status.d/discovery-search-index.md`; `roadmap.d/discovery.md`; `docs/operating-costs.md`.

---

_Researched and written by Claude Opus 5 (Claude Code) on 2026-08-06, at the owner's request. Primary
sources only — Cloudflare's own documentation and blog, and this repository's code and specs._
