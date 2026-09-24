---
number: 164
slug: network-resilience-constrained-networks
status: Accepted
date: 2026-06-29
area: Delivery / Performance
summary: Magna Carta adopts a forward-binding network-resilience standard for slow, high-latency, metered, and intermittent connections — because its users work from courthouses, rural offices, hotels, and the road against hard filing deadlines, where a transfer that aborts and restarts is a missed filing, not a nuisance. The standard ratifies four commitments and lives as a cited convention (`docs/conventions/network-resilience.md`); behaviour-vs-measurement is split so each fact has one home (this file and the convention own how to BEHAVE; `performance.md` owns how to MEASURE). (1) Resumable transfer is a required seam NOW — file bytes move only through the established R2 seam (multipart-resumable upload, presigned-GET download, HTTP Range serving), never a monolithic non-resumable in-app fetch; the backend already realises it, so this codifies the reference rather than retrofitting. (2) A slow-network / transfer-weight profile is added to the load-profile harness. (3) A shared client transport seam (one utility owning timeout, backoff, retry, and stale-cache exposure) is required so "no hardcoded timeout" and "render last-known value" are implemented once, not per call site. (4) A per-route transfer budget is a fitness function — mechanism decided now, numeric gate triggers once (2) lands and the SPA route baseline is measured. The standard binds all NEW work immediately; existing surfaces are audited once (the backend is conformant; the single bounded retrofit is the inline-ZIP stream) and migrated from findings, not reworked en masse. Commitments (2) and (3) are decided-but-deferred: the SPA is a one-page skeleton with nothing to route or measure, so building the machinery now would be speculative (ADR-0039). Builds on ADR-0078 (build expensive-to-retrofit seams up front), ADR-0039 (off the hot path / measure-first), ADR-0083 (load-profile harness), and respects ADR-0003 / ADR-0067 at the transfer seam.
---

**Magna Carta behaves well on a hostile network as a matter of correctness, not polish.** The
prompt was field reporting on extreme links (Antarctic stations: 750 ms round-trips, sub-2 Mbps,
packet loss, scheduled-window connectivity), but the lesson is ordinary for us: a document-heavy SPA
with an external client portal, used by lawyers from courthouses, rural county recorders, hotels, and
the road — often the night before a filing is due. The canonical hostile-network failure (a download
that times out, cache-busts, and restarts from zero) is, in this domain, a missed deadline. So the
question this decision settles is not "should the UI feel fast" but "does a transfer that is still
making progress survive a bad link" — and the answer is a standard, not a per-feature judgement call.

**The four commitments.**

1. **Resumable transfer is a required seam — now.** Any feature that moves file bytes uses the
   established R2 transfer seam — multipart-resumable upload, presigned-GET download (a 302 to a real
   URL the browser's download manager drives), or HTTP Range serving with If-Range resume — never a
   monolithic, non-resumable in-app fetch. This is the expensive-to-retrofit foundation (ADR-0078),
   and the backend already realises it: `routes/files/uploads.ts` does single-shot-PUT-or-multipart over
   `files/presign.ts`; `routes/files/downloads.ts` redirects single-file and over-threshold bundles to a
   presigned GET; `files/preview-serve.ts` serves Range/206 with conditional resume. The commitment
   therefore **codifies the reference**, it does not retrofit.
2. **A slow-network / transfer-weight profile is added to the load-profile harness** (ADR-0083). The
   _measurement_ rule is anchored in `performance.md` (one home for "how we measure"); the
   constrained-network _behaviour_ rules live in the convention.
3. **A shared client transport seam is required** — one utility owning timeout, backoff, retry, and
   stale-cache exposure, so "no hardcoded timeout" and "render the last-known value" are implemented
   once at a chokepoint, not hand-rolled per call site (the client-side analogue of the route
   chokepoint, ADR-0067).
4. **A per-route transfer budget is a fitness function.** Cold-load weight is budgeted per route and
   split aggressively. The mechanism is decided now; the numeric gate goes enforcing once commitment
   (2) lands and the SPA's per-route baseline is measured — a named trigger replacing `performance.md`'s
   open-ended "gates land with the code to measure."

**Scope: forward-binding, audited once, not reworked en masse.** The standard binds all new work
immediately. Existing surfaces were audited once rather than retrofitted wholesale (matching how
`performance.md` and `security.md` phased in, and honouring "verify before asserting a cause"): the
backend transfer paths are conformant and become the reference; the sole bounded retrofit is the
inline bulk-ZIP stream (`routes/files/downloads.ts`, multi-file under the live threshold), which is a single
non-resumable streamed response a mid-stream drop restarts — backlogged for constrained-network
threshold tuning, not a rebuild. A behaviour-neutral DRY extraction (the duplicated
R2-entries-to-zip-inputs generator → one `zipEntriesFromR2` helper) is folded in. The remaining items
— transport seam, harness profile, budget gate, client UX, portal lite-mode — are forward seams with
named triggers.

**Considered & rejected.** _Audit-and-retrofit every transfer path now_ — rejected: a big-bang across
recently-shipped, working, well-reviewed code (safe-delivery, bundling, every tool, the upload
pipeline) for little gain, and partly speculative since the audit shows those paths are conformant.
_Defer everything until the client is built_ — rejected: resumable transfer is precisely the seam
that is cheap now and expensive to retrofit (ADR-0078); deciding it late is how the 20 MB-to-send-a-
message anti-pattern slips in. _Bury the rules in `performance.md`_ — rejected: network resilience is
a client-and-delivery concern with a different reader than server compute placement; folding it in
would stretch that file's single-home scope and weaken citations (a path cite beats a section
anchor). _Ratify a hard CI budget gate today_ — rejected: there is no measured baseline yet, so a gate
would be either vacuous or obstructive; the fitness-function mechanism is decided, the numbers wait
for the harness profile.

**Consequences.** A new cited convention, `docs/conventions/network-resilience.md`, becomes the home
for how to behave on constrained networks; `performance.md` gains the measurement pointer and keeps
the single home for how to measure. The backend gains nothing but a name (`R2Presigner` is now "the
transfer seam") and one behaviour-neutral extraction. New builders inherit named forward seams instead
of re-litigating per feature: the transport seam lands with the first data-fetch consumer, the harness
profile with the first real routes, the budget gate once measured, client pause/resume UX over the
already-resumable server paths, and the client portal — the highest-hostility surface — gets lite-mode
and resumable delivery when built. Builds on **ADR-0078** (build expensive-to-retrofit seams up
front), **ADR-0039** (off the hot path / measure-first), **ADR-0083** (load-profile harness);
generalises **ADR-0067** (route chokepoint) to a client transport chokepoint; respects **ADR-0003**
(firm-scoped data access) and the presigner seam it already runs through.
