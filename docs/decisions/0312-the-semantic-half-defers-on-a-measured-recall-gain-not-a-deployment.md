---
number: 312
slug: the-semantic-half-defers-on-a-measured-recall-gain-not-a-deployment
status: Proposed
date: 2026-08-14
area: Search
summary: "Discovery flag D4 — the Vectorize semantic half — stays deferred, and its trigger is a measured recall gain on a judged legal corpus rather than a deployment. The cost side is now answered: against the keyword half's measured read profile, the semantic half's marginal recurring cost for a 250,000-document review set is roughly 490 times the keyword half's, because Cloudflare's queried-vector-dimension metric counts the resident corpus once per month at twenty times the storage rate — so a queried Vectorize index costs about 21 times what pricing its storage alone suggests, a correction the earlier sizing missed. On top of that sits a one-time embedding charge of roughly $261 to $522 per review set at the platform-pinned model's rate. The convergence side is not answered and cannot be from here, and the blocker is not the deployed-only binding: the binding is substitutable (open-weights model run locally, exhaustive cosine as the upper bound on approximate nearest neighbour), while the missing piece is a legal-prose corpus carrying relevance judgements, which no deployment supplies. The experiment that settles it is specified in full — the TREC Legal Track Enron collection, its paired Boolean and request-for-production queries, overlap at k and rank-biased overlap as descriptive metrics, and recall at fixed review effort as the deciding one, with a drop/keep/flag rule written before the run. Two things are done now because they stop being cheap the moment a vector exists: the embedding model pin is re-opened, and the namespace-versus-index billing question is recorded against the partition-key decision."
---

**A second index is not justified by returning different answers; it is justified by returning more
responsive ones — and that has never been measured here, while its cost now has been.**

**Context:** Flag D4 has been open since the discovery 5·1 design because nobody had numbers. Two things
changed. Split compaction shipped and the R2 adapter shipped, so the keyword half now has a measured cost
profile: per-query ranged reads hold between 37 and 59 across a 96.5x growth in index size, and every one
of those reads is a single R2 range GET in a deployment. And that asymmetry is the point — the keyword
side is now priced from measurement, and the semantic side has never executed at all.
`apps/worker/src/search/semantic-search.ts` returns `engine-not-implemented`,
`packages/search/src/fusion.ts` has never seen two real lists, and the benchmark names both as
unmeasured.

**Decision:** The semantic half stays deferred and flag D4 stays as the discovery 5·1 design sets it —
off by default, enabled per review set. What changes is that the default now rests on evidence rather
than caution, and that the condition for revisiting it is named.

**The cost figures, and the one that was being missed.** Cloudflare bills Vectorize on two metrics, and
the queried-dimension metric counts the **resident corpus** — not merely the query vectors — once per
month, as soon as a single query is issued, at twenty times the per-dimension storage rate. A queried
index therefore costs roughly twenty-one times what pricing its storage alone suggests. For the discovery
5·1 design's own worked case of a 250,000-document review set at twenty passages per document, storage is
the $2.56 per month that design records and the total is about $53.81. The keyword half's marginal cost
for the same corpus, derived from measured read counts at published R2 rates, is about eleven cents a
month. On top of the semantic recurring line sits a one-time embedding charge of roughly $261 to $522 per
review set at the pinned model's published rate, repeated on every re-index.

**The trigger, and what it deliberately is not.** The trigger is the median recall gain of fused over
keyword-only retrieval at fixed review effort, on a legal corpus with relevance judgements, against a
drop/keep/flag rule written before the run. The trigger is **not** a deployment. Vectorize being a
deployed-only binding is the obvious blocker and it is the wrong one: the pinned embedding model is
open-weights and runnable locally through a pure-Rust inference path, and exhaustive cosine is the upper
bound on what an approximate nearest-neighbour index returns — so substituting it biases in favour of the
half being judged, which is the safe direction. The real blocker is that no corpus in this repository
carries relevance judgements, and the benchmark's own corpus is generated filler with planted band terms,
which would measure the generator rather than the domain. Deploying Vectorize would produce two ranked
lists over nonsense and no way to say which was right. D4 is therefore blocked on acquiring data, not on
building anything.

**Why convergence is not the deciding metric.** Out-of-domain evidence puts the overlap between lexical
and dense top-k sets around a fifth, so low convergence is close to certain — and it settles nothing,
because different is not better. A second index that reliably surfaces a different set of irrelevant
documents has low convergence and negative value. Recall gain against judgements is the metric that
decides; overlap and rank-biased overlap explain the result rather than being it.

**Why legal practice raises the value of running the experiment rather than of keeping the index.**
Keyword recall in litigation is documented to be far below what counsel believes, which is the failure an
embedding addresses. But what courts have accepted is technology-assisted review — supervised
classification with a validation protocol — and an unsupervised embedding index is not that; the case law
does not transfer automatically. What transfers is the posture: a retrieval method is defensible because
it comes with a measured effectiveness figure. A semantic index with no recall figure adds nothing to a
Rule 26(g) certification. One with a measured gain is a defensibility asset independent of its cost. Both
readings point at the same experiment.

**Considered and rejected:** **Building the adapter and measuring in production** — it spends the build
and the deployment and still cannot score recall without judgements, which is the specific trap this
decision exists to avoid. **Dropping the semantic half outright** — the cost case is strong but the
evidence gap is closeable and the legal-practice argument gives closing it value beyond cost;
`SearchIndexPort`, the flag, and the fusion path already exist and cost nothing while dormant. **Pricing
Vectorize on stored dimensions alone**, as the earlier sizing did — off by a factor of about twenty-one
once anyone queries. **Removing the fusion path while the half is deferred** — it degrades correctly to
keyword-only, costs nothing, and would have to be rebuilt.

**Consequences:** D4's default is unchanged but now justified by figures. Two items become due
immediately because both stop being cheap the moment a vector exists. The **embedding model pin** is
re-opened: the platform-pinned model is seventeen times the token cost and a hundred and seventeen times
less context than an available alternative on the same platform, and its 512-token window truncates the
tail of a full page of legal prose under the shipped page-per-passage chunking — the pin is unchangeable
once an index exists, and the alternative's output dimensionality is the open input. The
**namespace-versus-index billing question** is recorded against the partition-key decision: whether a
namespace-scoped query bills the namespace's resident vectors or the index's is undocumented, and under
the worse reading namespace-per-matter bills a firm's whole corpus on every matter's query. One query
against a deployed two-namespace index settles it, and it runs before the partition key is chosen.

The standing cost is that D4 remains open, deliberately. It is open on a data-acquisition task with a
fully specified experiment behind it, which is a different state from open because nobody looked.

Analysis, with every figure labelled measured, vendor-quoted, or derived, and the gaps named:
[`../research/2026-08-14-semantic-half-convergence-and-cost.md`](../research/2026-08-14-semantic-half-convergence-and-cost.md).
