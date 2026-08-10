---
branch: claude/kitesurf-assessment
worktree: .claude/worktrees/kitesurf-assessment
area: Research — Cloudflare Kitesurf (the agent-first browser engine on Browser Run) assessed against the shipped Safe Website Viewer render path and the designed-but-unbuilt email-to-PDF render stage
status: review
touches: docs/research/2026-08-10-cloudflare-kitesurf-assessment.md, changelog.d/kitesurf-assessment.md, docs/active-work/claude/kitesurf-assessment.md
---

Docs-only research stream. Reads the 2026-08-06 Kitesurf announcement, then checks every load-bearing
claim against the Browser Run product documentation — the Kitesurf page, pricing, limits, the FAQ's
Security and Data Handling section, the Wrangler bindings reference, the automatic-request-headers
reference, the `/pdf` and `/json` Quick Actions and the `/pdf` REST reference — and maps the product
onto the one browser consumer we ship (`packages/safe-browse`, `apps/worker/src/routes/safe-browse.ts`,
ADR-0119) and the one we have designed and not built (the email-to-PDF render stage in
`docs/research/in-app-conversion.md` and ADR-0204).

Verdict is **adopt later**, so no ADR fragment: a defer belongs in the research document, not the
decision register. Adds only new files; touches no shared, generated or owned file, so it cannot
collide with a concurrent stream. Two follow-ups are recorded in the document for whoever next touches
that area rather than done here — the Browser Rendering to Browser Run rename in ADR-0119 and the
safe-browse files, and the missing Browser Run row in `docs/operating-costs.md` (a pre-existing gap;
the proposed row text is in the document).
