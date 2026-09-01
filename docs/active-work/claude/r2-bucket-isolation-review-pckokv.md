---
worktree: C:/dev/magna-carta-worktrees/claude/r2-bucket-isolation-review-pckokv
area: Review of the per-firm R2 bucket isolation options brief
status: review
touches: docs/specs/
---

Reviews the per-firm R2 bucket isolation options brief against the code, and records the
corrections: the guard's blast radius, a call-site-level bucket split inside
`routes/downloads.ts` and its bundle coordinator/consumer chain, Durable Objects as a
distinct injection problem, and a hardcoded S3 endpoint that ignores a firm's data region.
Documentation only — no source changes. Whoever implements the chosen option should take
`routes/downloads.ts` first; that chain is a live bug independent of which option lands.
