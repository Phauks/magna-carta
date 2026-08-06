---
branch: claude/cloudflare-ai-search-research
worktree: .claude/worktrees/agent-aa5d6cc43ea982984
area: Research — Cloudflare AI Search (formerly AutoRAG) assessed against the discovery search subsystem and the natural-language-search question
status: review
touches: docs/research/2026-08-06-cloudflare-ai-search-assessment.md, changelog.d/cloudflare-ai-search-research.md, docs/active-work/claude/cloudflare-ai-search-research.md
---

Docs-only research stream. Crawls the current Cloudflare AI Search documentation and the recent
Cloudflare blog posts on the topic, then maps the product onto the shipped keyword write pipeline
(`packages/search`, `apps/worker/src/search`), the planned Vectorize semantic half, and the AI-consent
posture. No product code, no spec, no ADR — the deliverable is one research document plus its
changelog fragment. Adds only new files; touches no shared or generated file, so it cannot collide
with a concurrent stream.
