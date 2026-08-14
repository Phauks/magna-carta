# The discovery semantic half — convergence with keyword, and what the second index actually costs

**Date:** 2026-08-14
**Status:** Analysis. **The convergence question is not answered here, and the reason is not the one
expected.** The cost question is answered, at the resolution the sources allow: every figure below is
labelled measured, vendor-quoted, or derived, and the figures that could not be obtained are named
rather than filled in. The recommendation in section 8 is **defer with a named trigger**; the owner's
call is recorded as a Proposed decision fragment, not taken here.
**Scope:** Discovery owner flag D4 — whether the Vectorize semantic half earns its place beside the
shipped Tantivy keyword engine. What a second index costs against the keyword side's now-measured
read profile; whether the two indexes converge on the same answers; what would have to be run to find
out; and what legal practice says about the question being asked at all.
**Excludes:** the AI Search natural-language surface over a firm's own working documents, which is a
different corpus behind a different gate
([`../specs/2026-08-06-ai-search-integration-design.md`](../specs/2026-08-06-ai-search-integration-design.md)) —
its own filter-semantics experiment is separately open. No feature code, no adapter, no schema.
**White-paper home:** _Core domain_ (search and discovery), with _AI / inference_ and _Performance and
concurrency model_ as the surrounding context.
**Governing decisions:** ADR-0012 (Tantivy keyword plus a semantic half), ADR-0003 (tenancy and the
firm-scoped data-access layer), ADR-0039 (nothing heavy on the hot path), ADR-0111
(`@magna-carta/inference` as the one credential-less chokepoint), ADR-0207 (splits in R2), ADR-0208
(the write pipeline).
**Decision inputs:** the shipped benchmark (`crates/search-eval`) and its committed baseline; the
shipped engine (`crates/search-core`), the R2 adapter (`apps/search-worker`, `containers/search`,
`apps/worker/src/search/`), and the deferred semantic half
(`apps/worker/src/search/semantic-search.ts`); the stateful-service spec
([`../specs/2026-07-17-discovery-search-index-stateful-service-design.md`](../specs/2026-07-17-discovery-search-index-stateful-service-design.md));
the discovery 5·1 design's scale statements and its correction of the Vectorize ceiling
([`../specs/2026-08-05-discovery-5-1-design.md`](../specs/2026-08-05-discovery-5-1-design.md));
Cloudflare's published Vectorize, Workers AI, and R2 pricing and limits, read on 2026-08-14.

---

## 1. The line, drawn first

Three kinds of number appear below and they are never mixed.

**Measured** means a figure this repository produced by running code. All of them come from
`crates/search-eval` over `crates/search-core` — the real Tantivy engine, nothing stubbed. They carry
that harness's boundary: no network, no Worker, no Container, no disk cache. Read counts transfer to a
deployment (each is one R2 range GET); milliseconds do not.

**Vendor-quoted** means a rate or limit copied from Cloudflare's own documentation on 2026-08-14, with
the page cited. Preview pricing drifts; these must be re-verified before anyone relies on them.

**Derived** means arithmetic this document performed over measured and vendor-quoted inputs, with the
inputs named. A derived figure is only as good as its assumption, so every assumption is stated in the
sentence that uses it.

**Not obtained** is a fourth category and it is used, not avoided. There is no measured convergence
rate in this document, no measured semantic latency, and no measured embedding token count for legal
prose. Section 9 collects every such gap, and section 5.3 specifies what would produce the largest of
them.

The benchmark's own discipline governs here: an invented plausible number is worse than a stated gap.

## 2. What is already known, and what changed

The keyword side's cost profile is known in a way the semantic side's is not, and that asymmetry is
the whole reason this question can be asked now.

**Measured**, from the committed baseline (`crates/search-eval/search-benchmark-baseline.json`, taken
2026-08-13) and reproduced independently on this machine on 2026-08-14 with identical read counts:

| Corpus tier | Documents | Passages | Compacted split size | Per-query ranged reads (all six query classes) |
| ----------- | --------- | -------- | -------------------- | ---------------------------------------------- |
| smoke       | 250       | 2,000    | 137.9 KiB            | 37–49                                          |
| expected    | 5,000     | 40,000   | 2.59 MiB             | 40–57                                          |
| large       | 25,000    | 200,000  | 13.00 MiB            | 40–59                                          |

Per-query ranged reads hold between **37 and 59** across a **96.5x** growth in index size. Read counts
are deterministic: the smoke tier reproduced byte-for-byte on a different machine and a different day
(40, 37, 45, 40, 42, 49 for the six query classes), which is what makes them safe to price against.

The semantic half has no equivalent line. `apps/worker/src/search/semantic-search.ts` returns
`engine-not-implemented`; `runHybridSearch` degrades to keyword-only; the benchmark's own
not-measured list names Vectorize and reciprocal rank fusion explicitly. Nothing about the semantic
half has ever executed.

## 3. The keyword side's cost, priced

Both halves share text extraction and OCR — the extraction runs once and feeds both. So the comparison
that matters is **marginal**: what each half adds on top of a pipeline that already exists. For the
keyword half that is split storage in R2 plus range GETs; for the semantic half it is embedding tokens
plus Vectorize.

Vendor-quoted (R2 Standard, 2026-08-14): storage **$0.015 per GB-month**, Class A **$4.50 per million**,
Class B **$0.36 per million**, egress free; included on the paid plan are 10 GB-month, 1 million Class A,
and 10 million Class B operations per month.

Derived, using the discovery 5·1 design's own scale statements — "one small production is 10,000
documents. A moderate matter is 100,000 to 500,000," at roughly 20 passages per document — and a
**measured** index density of 13,635,325 bytes for 25,000 documents, which is 545 bytes per document on
the benchmark's synthetic corpus:

| Review set                       | Index size (derived, linear from measured) | Storage / month | Range GETs / month at 59 reads per query | Class B / month | One-time split publishes (Class A) |
| -------------------------------- | ------------------------------------------ | --------------- | ---------------------------------------- | --------------- | ---------------------------------- |
| 10,000 documents, 1,000 queries  | ~5.5 MB                                    | ~$0.00008       | 59,000                                   | ~$0.021         | ~$0.045                            |
| 250,000 documents, 5,000 queries | ~136 MB                                    | ~$0.002         | 295,000                                  | ~$0.106         | ~$1.13                             |

The linear extrapolation of index size is the weak step and is labelled as such: it holds a measured
bytes-per-document ratio constant across a 10x corpus change, over a synthetic corpus whose vocabulary
does not grow the way real prose does. Real indexes sublinearly amortize a shared dictionary, so this
is more likely an over-estimate than an under-estimate — which is the safe direction here, because it
is the side being defended.

**The keyword half's marginal recurring cost for a moderate review set is on the order of ten cents a
month.** That is the number the semantic half has to be set against.

## 4. The semantic side's cost

### 4.1 Vectorize, and the metric that decides it

Vendor-quoted, from Cloudflare's Vectorize pricing page (last updated 2026-04-21; the page also records
that **Vectorize is now generally available**):

> Queried Vector Dimensions: The total number of vector dimensions queried. If you have 10,000 vectors
> with 384-dimensions in an index, and make 100 queries against that index, your total queried vector
> dimensions would sum to 3.878 million (`(10000 + 100) * 384`).

> Stored Vector Dimensions: The total number of vector dimensions stored.

The billing formula, quoted verbatim:

```
((queried vectors + stored vectors) * dimensions * ($0.01 / 1,000,000))
  + (stored vectors * dimensions * ($0.05 / 100,000,000))
```

Workers Paid includes the first 50 million queried dimensions per month and the first 10 million stored
dimensions; overage is $0.01 per million queried and $0.05 per 100 million stored.

**The consequence has been missed everywhere it has been costed in this repository, and it is the single
most decision-relevant figure in this document.** The queried-dimension metric counts the **resident
corpus**, not just the query vectors — once per month, as soon as one query is issued. And the queried
rate is **20 times the stored rate** per dimension ($0.00001 against $0.0000005). So a Vectorize index
that is queried at all costs roughly **21 times** what costing its storage alone suggests.

The discovery 5·1 design priced a 250,000-document review set at "~$2.56 per month. Cheap." That storage
figure is correct. The total is not:

| Review set (derived, 1,024 dimensions, 20 passages per document) | Vectors   | Stored dimensions | Stored / month | Queried dimensions (at the query volume shown) | Queried / month | **Total / month** |
| ---------------------------------------------------------------- | --------- | ----------------- | -------------- | ---------------------------------------------- | --------------- | ----------------- |
| 10,000 documents, 1,000 queries                                  | 200,000   | 204,800,000       | $0.10          | 205,824,000                                    | $2.06           | **~$2.16**        |
| 250,000 documents, 5,000 queries                                 | 5,000,000 | 5,120,000,000     | $2.56          | 5,125,120,000                                  | $51.25          | **~$53.81**       |

Included allotments are ignored above because they are per-account, not per-firm: the first firm absorbs
them and every firm after that pays list.

Two caveats on this arithmetic, both real:

- **The metric's behaviour for a namespace-filtered query is undocumented.** The formula is stated for an
  index. Whether a query scoped to one namespace inside a firm index is billed the namespace's resident
  vectors or the index's is not stated anywhere in the pricing page. Under the worse reading, one matter's
  query bills the whole firm's corpus. That is a single verification query to settle on first deployment
  and it is named in section 7.
- **A per-query rather than per-month reading of the resident term would be catastrophic**, and can be
  ruled out arithmetically: 5,000 queries against 5 million vectors would be $256,000 per month, which no
  vendor publishes an example for. The documented worked example ((30,000 + 10,000) × 768 for 30,000
  monthly queries against 10,000 vectors) confirms the resident term is counted once per month.

### 4.2 Embedding, the entry fee

Vendor-quoted, from Cloudflare's Workers AI pricing and model pages (2026-08-14). The platform-pinned
model is `@cf/baai/bge-large-en-v1.5` (`packages/inference/src/catalog.ts`,
`PLATFORM_EMBEDDING_MODEL_ID`): **1,024 output dimensions, a 512-token maximum input, $0.204 per million
input tokens** (the model page rounds this to $0.20; the pricing page's $0.204 is used below).

Derived. The tokens-per-passage figure is the weak input and there is no measured one, because the
benchmark corpus is generated filler rather than legal prose. Two bracketing assumptions are shown
rather than one invented middle:

| Review set        | Passages  | At 256 tokens per passage | At 512 tokens per passage (the model's ceiling) |
| ----------------- | --------- | ------------------------- | ----------------------------------------------- |
| 10,000 documents  | 200,000   | ~$10.45                   | ~$20.89                                         |
| 250,000 documents | 5,000,000 | ~$261.12                  | ~$522.24                                        |

This is a one-time charge per corpus, repeated on any re-index — an OCR-quality improvement or a schema
generation bump re-runs it in full. Query-time embedding is negligible (a twenty-token question costs
about four millionths of a cent).

**A quality problem hides inside the same number, and it is not a cost.** The pinned model truncates at
512 input tokens. A page of legal prose at roughly 450 words is on the order of 600 tokens, so on the
platform's own page-per-passage chunking (`packages/search/src/extraction.ts` — "one page of text becomes
one passage") **roughly the final 15% of every page would never be embedded at all**, and a denser page
loses proportionally more. That is a silent recall hole in the semantic half that no cost figure captures.
The words-per-page and tokens-per-word inputs are both estimated rather than measured, and the whole thing
is cheaply measurable by tokenizing a real corpus. The stateful-service spec's open item 8 already flags
the 512-token window; this is what it plausibly costs in recall terms if the chunk unit stays a page.

### 4.3 The comparison, stated plainly

For a moderate review set of 250,000 documents, marginal cost of each half on top of the shared
extraction pipeline:

|                                | Keyword (Tantivy over R2)                                        | Semantic (Vectorize plus Workers AI)                                  |
| ------------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| Recurring, per month           | ~$0.11 (derived from measured read counts)                       | ~$53.81 (derived from the vendor formula)                             |
| One-time, per corpus           | ~$1.13 of Class A publishes                                      | ~$261 to ~$522 of embedding                                           |
| Index size for the same corpus | ~136 MB (derived from a measured 13.00 MiB at 25,000 documents)  | 5,000,000 × 1,024 × 4 bytes = ~20.5 GB of float32, not billed by byte |
| Cost profile                   | measured, deterministic, holds flat across a 96.5x corpus growth | never executed; the figures above are vendor arithmetic               |

The recurring ratio is roughly **490 to 1**, and there is a several-hundred-dollar entry fee before the
first query. Both columns exclude the search Container's compute and the network, per the benchmark's
own boundary — those are shared or unmeasured and would not move the ratio's order of magnitude.

### 4.4 The model pin is a large lever and it is only cheap to move now

Vendor-quoted: `@cf/baai/bge-m3` is **$0.012 per million input tokens with a 60,000-token context**,
against the pinned model's $0.204 and 512 tokens. That is **17 times cheaper per token and 117 times more
context**. Cloudflare's model page does not state bge-m3's output dimensionality, so the Vectorize side of
the comparison cannot be completed here and is a named gap.

This matters now and stops mattering the moment vectors exist. `packages/inference/src/port.ts` records
the reason in its own comment — the embedding operation deliberately has no `modelId` field because a
firm-swappable model "would invalidate the index" — and the AI Search design pins the same model
unchangeably at instance creation. **If the semantic half is ever built, the model choice is decided once,
before the first vector, and the 17x is a real per-corpus difference on the entry fee in section 4.2.**
Re-opening the pin is close to free today and is a full re-index of every corpus later.

## 5. Convergence — why it cannot be answered, and the reason is not Vectorize

The expected answer to this section was "Vectorize is a deployed-only binding with no local substitute,
so convergence needs a deployment." That is true of the binding and it is **not** the blocker.

### 5.1 Two things stand in the way, and only one of them is the deployment

**The binding is the smaller obstacle, and it is avoidable.** Convergence does not require Vectorize. It
requires an embedding model, a nearest-neighbour search, the keyword engine, and one corpus queried
through both. Only the first is genuinely Cloudflare's: `@cf/baai/bge-large-en-v1.5` is BAAI's
open-weights model, runnable locally, and the `candle` crate is a pure-Rust inference path for
BERT-family models — which keeps golden rule 14 intact without ONNX Runtime's C++ dependency. Vectorize
itself is an approximate nearest-neighbour index; exhaustive cosine over a few hundred thousand vectors is
a matrix multiply, and exact neighbours are the **upper bound** on what an approximate index returns. So
substituting exhaustive cosine biases the measurement _in favour_ of the semantic half, which is the safe
direction for a decision about whether to drop it.

**The corpus is the real obstacle, and a deployment does not remove it.** `crates/search-eval`'s corpus is
built from a uniform draw over a filler word list with band terms planted to give BM25 a known
selectivity profile (`crates/search-eval/src/corpus.rs`). It is exactly right for what it does and
completely wrong for this: embeddings over generated filler measure the generator, not the domain. There
is no legal-prose corpus in this repository, and — decisively — **no corpus anywhere in it carries
relevance judgements**, which is what any recall claim has to be scored against. Deploying Vectorize
tomorrow would produce two ranked lists over synthetic nonsense and no way to say which of them was right.

So the honest statement is: **convergence cannot be measured today, and the missing piece is a judged
legal corpus, not a binding.** Anyone who reaches for a deployment as the trigger for this question will
spend the deployment and still not have the answer.

### 5.2 What the literature suggests the answer probably is — and why it does not decide anything

Out-of-domain evidence is consistent and points one way. On CORD-19, the mean Jaccard similarity between
a dense retriever's and BM25's top-10 sets is **0.213** — roughly 79% of retrieved documents differ
([SciRet, 2026](https://arxiv.org/html/2608.03860v1)). Broader surveys of hybrid retrieval report the same
complementarity, with BM25 dominating on exact identifiers and rare terms and dense retrieval dominating on
paraphrase, and reciprocal rank fusion as the standard combiner
([hybrid search reference, 2026](https://www.digitalapplied.com/blog/hybrid-search-bm25-vector-reranking-reference-2026)).

**Convergence is therefore almost certainly low, and that settles nothing.** Low overlap only says the two
indexes return different documents. It does not say the extra documents are responsive. A second index
that reliably surfaces a different set of irrelevant results has low convergence and negative value. This
is the trap in the question as posed, and it is worth naming: **the metric that decides D4 is not overlap,
it is recall gain at fixed review effort.**

One in-domain result cuts directly against the design's assumption. "Know When to Fuse: Investigating
Non-English Hybrid Retrieval in the Legal Domain" ([Louis et al., 2024](https://arxiv.org/abs/2409.01357))
finds that in zero-shot settings fusing domain-general models beats any single model regardless of fusion
method — but that **"when models are trained in-domain, we find that fusion generally diminishes performance
relative to using the best single system, unless fusing scores with carefully tuned weights."** The
platform's `packages/search/src/fusion.ts` is untuned rank fusion at the paper's default `k = 60`. That is
the zero-shot case, so the finding does not condemn it — but it does mean fusion is a parameter to measure,
not a combiner to assume, and the tuned-weights caveat is the one that applies the day a legal-tuned
retriever is used.

### 5.3 The experiment that would settle it

Specified to the level where it can be run without re-deriving anything.

**Corpus.** A public, redistributable legal corpus **with relevance judgements**, because recall is the
metric and recall needs ground truth. The TREC Legal Track's Enron collection (2009–2011) is the
appropriate choice and close to the only one: it is e-discovery by construction, the judgements were made
by attorneys, and it is large enough that the fan-out and compaction shapes the benchmark already measures
still apply. Licence and redistribution terms are a precondition to confirm, not an afterthought.

**Query set.** The TREC Legal Track topics, used as they were designed. Each topic carries **both** a
negotiated Boolean query and a natural-language request for production — which happens to be exactly the
two query shapes this platform has. The Boolean form drives the Tantivy half; the request-for-production
prose drives the semantic half. No query has to be invented, and the pairing is not a convenience: it is
the same pairing a real matter produces.

**Pipeline.** The corpus through the shipped extraction path (`packages/search/src/extraction.ts`), so
chunking is the product's own page-per-passage unit and the truncation problem in section 4.2 is measured
rather than assumed. Keyword through `crates/search-core` as `crates/search-eval` already drives it.
Semantic through a locally-run copy of the pinned model and exhaustive cosine. Fusion through the shipped
`reciprocalRankFusion` — which is also the first time that function will have executed against real result
lists rather than unit fixtures.

**Metrics, three, answering different questions.**

1. **Overlap at k** — Jaccard of the top-k document sets at k = 20 and k = 100. Answers "do they return
   the same documents". Descriptive only.
2. **Rank-biased overlap** at p = 0.9 ([Webber, Moffat and Zobel, 2010](https://dl.acm.org/doi/10.1145/1852102.1852106))
   — answers "where they agree, do they agree on order". Chosen over Kendall tau because the two lists are
   not conjoint and tau is undefined for lists that do not share their items; rank-biased overlap is
   top-weighted and handles non-conjointness, which is the actual shape of the data.
3. **Recall at fixed review effort** — recall@k against the TREC judgements for keyword alone, semantic
   alone, and the fusion of the two, with k held equal across all three. **This is the metric that decides
   D4.** The other two explain the result; this one is the result.

**The decision rule, written before the run so it cannot be fitted to the outcome.** Let `d` be the median
across topics of (fused recall@100 − keyword recall@100), in percentage points.

- **Drop the semantic half** if `d < 5` — and drop it regardless of how low overlap turns out to be. Two
  indexes that find different documents without finding more responsive ones are one index too many, at a
  490 to 1 recurring ratio.
- **Keep it, on by default** if `d >= 10`, or if the semantic half uniquely recovers responsive documents
  that share no term with the request at a rate above 2% of the responsive set — that is the Blair and
  Maron failure mode (section 6) and it is the specific harm a second index exists to prevent.
- **Keep it behind the per-review-set flag D4 already specifies** if `5 <= d < 10`. A gain in that band is
  real but not worth a platform default at the measured cost; it is worth a firm's deliberate choice on a
  corpus where recall is contested, which is precisely what the flag is for.

**Effort and prerequisites.** No deployment, no Cloudflare account, no Vectorize. What it needs that the
repository does not have is the judged corpus and the licence to hold it, plus a local embedding path. If
the corpus cannot be obtained, the question stays open and no amount of platform work closes it — which
is itself worth knowing, because it means D4 is blocked on a data-acquisition task rather than an
engineering one.

## 6. What legal practice suggests

Discovery is not general search, and the difference runs in the semantic half's favour in a way pure
retrieval quality does not capture.

**The foundational finding is that keyword recall in litigation is far lower than counsel believes.**
Blair and Maron's 1985 study of a 40,000-document, 350,000-page litigation collection found attorneys
estimated they had retrieved 75% of responsive documents; measured recall was about **20%**
([summary and provenance](https://complexdiscovery.com/revisiting-the-blair-and-maron-study-evaluation-of-retrieval-effectiveness-for-a-full-text-document-retrieval-system/)).
The mechanism is precisely the one an embedding addresses: counsel cannot enumerate every way a document's
author might have referred to the thing being sought. Forty years of e-discovery practice has not
overturned this; it has built process around it.

**The Sedona Conference has contemplated concept search since its Search and Retrieval Commentary**, whose
Principle 11 provides that a responding party may use electronic tools and processes including data
sampling, searching and selection criteria, and expressly contemplates using technology to search for
_concepts_ rather than terms
([Sedona Conference publications](https://www.thesedonaconference.org/publications)). The Commentary's
own framing is that keyword search has documented practical limits and that alternatives are legitimate,
not exotic.

**Courts have accepted machine-assisted retrieval, but they accepted a specific thing.** Da Silva Moore v.
Publicis Groupe, 287 F.R.D. 182 (S.D.N.Y. 2012), first held computer-assisted review an acceptable way to
search for responsive electronically stored information; by Rio Tinto PLC v. Vale S.A., 306 F.R.D. 125
(S.D.N.Y. 2015), Judge Peck wrote that it "is now black letter law that where the producing party wants to
utilize TAR for document review, courts will permit it"
([opinion](https://scholar.google.com/scholar_case?case=9258323747532682759)). **What was accepted is
technology-assisted review — supervised classification with a validation protocol — and an unsupervised
embedding index is not that.** The case law does not transfer to a semantic index automatically, and any
document that implies it does would be wrong. What transfers is the underlying posture: courts accept a
retrieval method that comes with a measured effectiveness figure and a documented process, and they accept
it because of the figure, not because of the technology.

**That is the argument that actually matters here, and it points at the same experiment.** Counsel
certifying a discovery response under Federal Rule of Civil Procedure 26(g) certifies that the search was
reasonable. A semantic index with no measured recall figure adds nothing to that certification — it is one
more unvalidated tool. A semantic index with a measured recall gain over the keyword baseline, on a judged
corpus, is a defensibility asset independent of whether it is cost-effective, because it lets the firm say
what its search recovers and what it misses. **So the defensible-recall argument does not favour keeping
the second index on faith. It favours running the section 5.3 experiment, and it raises the value of
running it above what the cost comparison alone would justify.**

The retrieval literature agrees on the direction while disagreeing on the size. Hybrid retrieval is now
the recommended baseline in general-purpose systems, with reported gains of roughly 7% in ranking quality
over either half alone on standard benchmarks, and BM25 and dense retrieval failing in complementary
ways — exact identifiers and rare terms against paraphrase and synonym. In-domain legal work is more
equivocal: the LexRAG benchmark reports that even the best dense retrievers with query rewriting reach
Recall@10 of only about 33% on legal consultation retrieval
([LexRAG, 2025](https://arxiv.org/pdf/2502.20640)), which is a reminder that the semantic half is not a
solved component being withheld from users.

## 7. Three things worth recording while in the area

**The 5-million-dimension ceiling is already corrected, and the correction has a second consequence
nobody has drawn.** The stateful-service spec's "~5M vector-dimensions per index" is the Workers **Free**
plan's stored-dimension allotment misread as an index capacity limit; the discovery 5·1 design already
records the correction, and this document does not restate it. The consequence still to record is the
account-level one: vendor-quoted limits are **20,000,000 vectors per index**, **50,000 namespaces per
index**, and **50,000 indexes per account** on Workers Paid. At 20 passages per document, one index holds
a **1,000,000-document** review set — comfortably above the discovery 5·1 design's "moderate matter is
100,000 to 500,000" band, so index-per-review-set is unconstrained by capacity. The binding limit becomes
**50,000 review sets across all firms**, which is 500 review sets each at 100 firms. That is a real
ceiling, it is far away, and it is the one to watch rather than the dimension count.

**The namespace billing question is the one verification worth a deployed query.** Section 4.1's caveat:
whether a namespace-scoped query bills the namespace's resident vectors or the index's is undocumented,
and under the worse reading namespace-per-matter inside a firm index bills the whole firm's corpus on
every matter's query. One query against a two-namespace index with a known vector count, read off the
usage dashboard, settles it. If the semantic half is ever built, this runs before the partition key is
chosen, not after.

**Reciprocal rank fusion has never executed against real results.** `packages/search/src/fusion.ts` is
pure TypeScript exercised only by unit fixtures; the benchmark names it as unmeasured; `runHybridSearch`
has never had two lists to fuse. Its correctness is not in doubt — the implementation is small and
matches the standard formulation at `k = 60`. What is unknown is whether `k = 60` is right for these two
engines on legal prose, and the "Know When to Fuse" finding in section 5.2 is a direct warning that
untuned fusion is not free. The section 5.3 experiment executes it for the first time as a by-product,
which is an argument for running the experiment even if D4 were already decided.

## 8. Recommendation

**Defer the semantic half. Do not build the Vectorize adapter. Keep flag D4 as the discovery 5·1 design
already sets it — off by default, enabled per review set — and note that the cost figures in section 4
now justify that default on evidence rather than on caution.**

The reasoning is short. The semantic half's marginal recurring cost is roughly **490 times** the keyword
half's for the same review set, with a **$261 to $522** entry fee per corpus before the first query, and
the benefit has never been measured on legal prose by anyone in this program. That is not a close call at
the current state of evidence. It is also not a permanent answer, because the evidence gap is closeable
and the legal-practice argument in section 6 says closing it has value beyond the cost question.

**The trigger that decides it later is the section 5.3 experiment — specifically, the median recall gain
`d` and the decision rule written there before the run.** The trigger is deliberately **not** a
deployment: section 5.1 shows a deployment does not answer this, and treating it as the trigger would
spend the deployment and leave the question open. The trigger is the acquisition of a judged legal corpus.

**Three things to do now, because each is cheap today and expensive later.**

1. **Re-open the embedding model pin before any vector exists.** Section 4.4: 17 times the token cost and
   117 times the context window separate the pinned model from `@cf/baai/bge-m3`, and the 512-token
   truncation would silently drop the tail of every full page. The pin is unchangeable once an index
   exists. Confirming bge-m3's output dimensionality is the open input.
2. **Record the namespace billing verification** as a first-deploy item against the partition key
   decision, per section 7.
3. **Leave the fusion path exactly as it is.** It degrades correctly to keyword-only, it costs nothing
   while the semantic half is deferred, and removing it would have to be rebuilt if the experiment comes
   back positive.

## 9. What could not be obtained

Stated so that nothing above is mistaken for more than it is.

- **A convergence rate.** No overlap figure, no rank correlation. Blocked on a judged legal corpus, not on
  a binding. Section 5.
- **A measured semantic latency or read profile.** Vectorize has never been queried from this program.
- **A measured tokens-per-passage figure for legal prose.** Section 4.2's embedding costs bracket an
  assumption rather than resting on a measurement; the bracket is stated instead of a midpoint.
- **bge-m3's output dimensionality**, which Cloudflare's model page does not state. Section 4.4's
  comparison is therefore complete on cost and incomplete on Vectorize sizing.
- **Whether a namespace-scoped Vectorize query bills the namespace or the index.** Section 4.1.
- **Any figure for the deployed keyword path.** The benchmark's boundary is unchanged: no network, no
  Worker, no Container, no disk cache hit rate. The read counts transfer; the milliseconds do not.

---

_Analysis written by Claude Opus 5 (Claude Code) on 2026-08-14, at the owner's request, against the
shipped `crates/search-eval` baseline and Cloudflare pricing read the same day. The decision it proposes
is recorded as a Proposed fragment for the owner to accept, amend, or refuse._

## Sources

- [Cloudflare — Vectorize pricing](https://developers.cloudflare.com/vectorize/platform/pricing/)
- [Cloudflare — Vectorize limits](https://developers.cloudflare.com/vectorize/platform/limits/)
- [Cloudflare — Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [Cloudflare — `@cf/baai/bge-large-en-v1.5`](https://developers.cloudflare.com/workers-ai/models/bge-large-en-v1.5/)
- [Cloudflare — `@cf/baai/bge-m3`](https://developers.cloudflare.com/workers-ai/models/bge-m3/)
- [Cloudflare — R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [SciRet: A Compute-Aware Empirical Study of Retrieval and Reranking for Scientific RAG (2026)](https://arxiv.org/html/2608.03860v1)
- [Know When to Fuse: Investigating Non-English Hybrid Retrieval in the Legal Domain (Louis et al., 2024)](https://arxiv.org/abs/2409.01357)
- [LexRAG: Benchmarking Retrieval-Augmented Generation in Multi-Turn Legal Consultation Conversation (2025)](https://arxiv.org/pdf/2502.20640)
- [Webber, Moffat and Zobel — A Similarity Measure for Indefinite Rankings, ACM TOIS 28(4), 2010](https://dl.acm.org/doi/10.1145/1852102.1852106)
- [Hybrid Search: BM25, Vector and Reranking Reference (2026)](https://www.digitalapplied.com/blog/hybrid-search-bm25-vector-reranking-reference-2026)
- [Revisiting the Blair and Maron Study](https://complexdiscovery.com/revisiting-the-blair-and-maron-study-evaluation-of-retrieval-effectiveness-for-a-full-text-document-retrieval-system/)
- [The Sedona Conference — publications, including the Best Practices Commentary on the Use of Search and Information Retrieval Methods in E-Discovery](https://www.thesedonaconference.org/publications)
- [Rio Tinto PLC v. Vale S.A., 306 F.R.D. 125 (S.D.N.Y. 2015)](https://scholar.google.com/scholar_case?case=9258323747532682759)
- [TREC Legal Track](https://trec-legal.umiacs.umd.edu/)
