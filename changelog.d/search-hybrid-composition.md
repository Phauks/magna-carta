---
category: Added
---

**Discovery hybrid search — the keyword + semantic composition.** `runHybridSearch` runs the keyword half
(the Tantivy engine through the per-firm catalog) and the semantic half (Vectorize) concurrently and
fuses their rankings by reciprocal rank. A half that succeeds contributes its hits; a half that is
deferred or errors contributes nothing and the other half still answers — so hybrid degrades to
keyword-only or semantic-only without any score calibration, and only reports a failure when both halves
are unavailable. The semantic half is a deferred seam today (its Vectorize binding and per-firm namespace
are a deploy-time step, like the search engine and conversion engines), so a hybrid call currently
returns keyword results; when the Vectorize adapter is wired it drops into the same composition. Covered
by tests for the both-halves fusion, graceful degradation each way, the limit cap, and the deferred
default.
