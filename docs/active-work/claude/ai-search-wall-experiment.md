# claude/ai-search-wall-experiment

**Scope:** AI Search slice 0 — the filter-semantics wall experiment (flags E1/E2 of the AI Search
integration design). This environment has no Cloudflare credentials, so the live half cannot run here;
this stream delivers the half that can be proven locally: a fenced, runnable protocol harness under
`packages/search/test/` that pins the exact filter shapes, feed-key layout, and delete/re-index
discipline our side will rely on, proves the experiment protocol itself can detect every failure shape
it exists to find, and a dated experiment record in `docs/research/` with a precise
must-verify-against-live checklist. **No production route, port, or schema is touched. No slice 1
code.**

## Files this stream touches

Created, all new:

- `packages/search/test/natural-language-filter-wall/` (harness: fixtures, filter construction,
  reference engine, protocol, tests)
- `docs/research/2026-08-07-ai-search-filter-wall-experiment.md`
- `changelog.d/ai-search-wall-experiment-local-half.md`
- this note

Edited:

- `docs/specs/2026-08-06-ai-search-integration-design.md` — one pointer added to the section 11
  verification list, linking the experiment record (no verdict is claimed there; E1/E2 stay open until
  the live run).

Explicitly **not** touched: `CHANGELOG.md`, `STATUS.md`, `STATUS.json`, `ROADMAP.md`, the white paper,
`docs/conventions/`, `docs/Decision-Log.md`, everything under `packages/search/src/`, and every app
under `apps/`.

## Overlap watch

- `packages/search/` — this stream adds test files only, in a new subdirectory of `test/`; the five
  shipped source modules are read as precedent and not edited. A concurrent stream starting AI Search
  slice 1 should reuse `natural-language-filter-wall/filter-construction.ts` as the pinned contract for
  the production filter builder rather than re-deriving it.
- The AI Search design and plan (`docs/specs/2026-08-06-ai-search-integration-*.md`) are read; only the
  design's verification list gains a link.
