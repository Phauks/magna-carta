---
category: Added
---

**Research: can Cloudflare AI Search back our search, and what does natural-language search actually
buy?** An assessment of AI Search (formerly AutoRAG) written from a full crawl of its current
documentation and the recent Cloudflare blog posts, mapped onto the three things we have or have
designed: the built keyword write pipeline, the unbuilt Vectorize semantic half, and the AI-consent
posture. The recommendation is **adopt-partially, and not for the thing the question points at** —
refuse it as the discovery keyword engine, keep it live as the leading candidate for the unbuilt
semantic half, and prove it on a smaller surface we have no plan for: a retrieval-only
natural-language search over a firm's own working documents.

Three findings carry it. **The keyword half is not a contest** — AI Search documents BM25 over chunks
with a tokenizer choice and an all-or-any match mode, and no phrase, proximity, wildcard,
field-scoped, or grouped boolean query at all, which is exactly what e-discovery search is; it also
returns a chunk and a score, never a highlight offset into the source document. **The decisive
constraint is in our own code** — the R2 object key is `files/{fileId}/{versionId}`, flat, with no
matter in the path, so AI Search's built-in `folder` attribute cannot express "this matter" against
the bucket as laid out today; the only route is one of five custom metadata fields, set at put time,
which we do not set. And **the confidentiality posture is better than expected**: retrieval-only AI
Search (`search()` rather than `chatCompletions()`, query rewriting off) makes no third-party frontier
model call at all, so it sits on the safe side of the ADR-0109 gate rather than behind it.

Corrects one claim in the [Cloudflare Agents assessment](docs/research/2026-08-04-cloudflare-agents-assessment.md),
which refused AI Search in a line partly on the grounds that it would "break the pin": AI Search
supports `@cf/baai/bge-large-en-v1.5` at 1,024 dimensions and fixes the embedding model at instance
creation, which is the same pin, enforced by the platform. Records the arithmetic the one-line refusal
skipped — the 100-namespace and 5,000-instance account caps that leave instance-per-firm as the only
allocation that scales, the 4 MB file limit, the 6-hour default sync that breaks index-on-commit, and
preview pricing published the same day that puts AI Search storage at roughly 130x R2's rate. Research
only — no decision, no code, nothing adopted; four owner flags with recommended defaults, and eleven
things explicitly not to conclude without testing.
