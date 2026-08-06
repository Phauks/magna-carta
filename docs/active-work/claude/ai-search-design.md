# claude/ai-search-design

**Scope:** Design only — the Cloudflare AI Search integration over the merged assessment: a firm-facing,
retrieval-only natural-language search over a firm's own working documents. Spec plus implementation plan,
a decision fragment, and a changelog fragment. **No product code in this stream.**

Owner ask (2026-08-06): _"when ai search lands design then flags"_ and, on AI features generally, _"it will
need to be opt-in, like many other AI features of course."_

## Files this stream touches

Created, all new — no shared or generated file is edited:

- `docs/specs/2026-08-06-ai-search-integration-design.md`
- `docs/specs/2026-08-06-ai-search-integration-implementation-plan.md`
- `docs/decisions/pending/ai-search-retrieval-only-natural-language-search.md`
- `changelog.d/ai-search-design.md`
- this note

Explicitly **not** touched: `CHANGELOG.md`, `STATUS.md`, `STATUS.json`, `ROADMAP.md`, the white paper,
`docs/conventions/`, `docs/Decision-Log.md`, `docs/operating-costs.md`, and every package under
`packages/` and `apps/`.

## Overlap watch

The design **reads** these surfaces and proposes additions to them in a later build stream, so a concurrent
stream editing them should know:

- `packages/search/` — the design proposes a **new, separate** `NaturalLanguageSearchPort` beside the
  shipped `SearchIndexPort`, sharing `CorpusScope` and the `SearchHit` pointer discipline. Nothing shipped is
  removed, renamed, or re-signed. No edit is made in this stream.
- `apps/worker/src/search/` — the feed writer is proposed as a **second consumer of the extraction already
  performed** in the index job, not a second pipeline. Read as precedent only here.
- `packages/file-manager/` — **hard dependency on task 110**, the matter dimension written as an
  `x-amz-meta-*` header at file-version put time. This design names it as a dependency and deliberately does
  **not** design it. If task 110 is in flight in another worktree, it owns that file.
- `packages/inference/` — read only, for the opt-in setting pattern and the pinned embedding model. No
  change proposed.
- `docs/specs/2026-08-06-magnus-design.md` — this design names what fills the `MagnusContextPort` seam and
  the disclosure-version consequence of filling it. It proposes no edit to the Magnus spec.
- Discovery (`docs/specs/2026-08-05-discovery-5-1-design.md`) — untouched by design. The keyword engine is
  kept, the semantic half's engine choice stays deferred behind `SearchIndexPort` and flag D4, and the F4b
  transcript include/exclude control remains discovery's and is not duplicated.
