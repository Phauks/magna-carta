---
category: Added
---

**Discovery hybrid search — reciprocal rank fusion.** The keyword half (Tantivy/BM25) and the semantic
half (Vectorize/cosine) rank hits in incomparable score spaces — a BM25 magnitude and a cosine
similarity cannot be added — so a hybrid query fuses them by reciprocal rank instead: a passage
contributes `1/(k + rank)` from each list it appears in, and the fused score is the sum. This needs no
score calibration between the halves, is robust to one half returning nothing, and lifts a passage both
halves surface above one only a single half found. The fusion is a pure function in
`@magna-carta/search` (`reciprocalRankFusion`), fusing at the passage (document + chunk) level with
deterministic tie-breaking, ready for the worker to combine the two halves once the semantic engine is
wired.
