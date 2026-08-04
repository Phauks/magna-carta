---
branch: claude/passive-dev-orchestrator-m7f9jw
worktree: (remote session — orchestrator)
area: cross-stream orchestration — status truth, roadmap, delegated slices
status: building
touches: docs/active-work/ (sweeps), docs/deploy-queue.md, status.d/ (merged-stream repairs), delegated agent branches (each with its own note)
---

Long-lived orchestration stream, running while the owner is away. This session
delegates implementation to agent branches (each registers its own
active-work note), merges pull requests once the gate is green and a review
passes, and keeps the trackers and roadmap current through the docs-sync
routine. Production deploys are never made from here; the pending activation
steps accumulate in `docs/deploy-queue.md` for the owner's return.

In flight via delegated branches: the lopdf remediation repair
(`remediate-lopdf-advisory`), the PII-registry classification of the
email-filing tables (`claude/pii-registry-email-tables`). Queued next: the
email capture-address mint/rotate route, the conversion per-engine dispatch
close-out, the platform-seal branch, the LibreOffice conversion engine
(owner-consented), and the search-index write pipeline.
