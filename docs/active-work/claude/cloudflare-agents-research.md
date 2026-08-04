# claude/cloudflare-agents-research

**Branch:** `claude/cloudflare-agents-research` · **Started:** 2026-08-04 · **Status:** complete, docs-only

## Scope

Research pass on Cloudflare's Agents platform (the `agents` SDK, the Think harness, the Agents Week
2026 surface) prompted by an owner-supplied Reddit link, assessed against the existing Durable
Objects / Queues / Workflows / `@magna-carta/inference` foundation. Establishes what is GA vs beta vs
experimental, what it costs, what it buys over the primitives already in use, and the per-firm
isolation and privileged-data-to-model questions any AI surface raises.

**Second pass (same day):** the first version was written from the docs landing page, blog posts, and
search results, and got three load-bearing claims wrong. It has been verified and corrected against a
complete crawl of `developers.cloudflare.com/agents/` — all 123 pages enumerated from the sitemap and
read as raw markdown. The corrections are recorded in the document itself, along with a per-class
verdict on migrating the existing Durable Objects to the Agent class, and a sequenced next-steps list.

**Research only.** No spec, no ADR, no decision, no code. The recommendations in the document are
labelled as recommendations; the binding decisions in this area remain ADR-0003 and ADR-0109 through
ADR-0113.

## Files touched

- `docs/research/2026-08-04-cloudflare-agents-assessment.md` (new)
- `changelog.d/cloudflare-agents-assessment.md` (new fragment)
- `docs/active-work/claude/cloudflare-agents-research.md` (this note)

No shared or generated file is edited — no `CHANGELOG.md`, no `STATUS.md`, no `ROADMAP.md`, no white
paper, no `docs/conventions/`. No overlap expected with any other stream.
