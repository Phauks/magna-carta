---
branch: claude/trust-follow-ups
worktree: .claude/worktrees/trust-follow-ups (remote session)
area: trust — catalog citation re-verification + trust-jurisdictions review-gate hardening
status: building
touches: >
  docs/research/trust-rules/*.md (Nevada corrections + NOT-VERIFIED banners),
  packages/trust-jurisdictions/src/{resolve,types}.ts,
  packages/trust-jurisdictions/test/{review-gate,nevada-profile,display-seam-scan(new)}.test.ts,
  apps/worker/src/trust-refusal-problems.ts, apps/worker/test/trust-refusal-problems.test.ts (new),
  status.d/3-2-trust-accounting-jurisdiction-compliance.md, changelog.d/
---

Two follow-ups from the Nevada corpus work: sweep the narrative trust-rules catalog against the
primary-source research records now in the repository (correcting the home-jurisdiction entry's
repealed SCR 78.5 citations and marking every unverifiable sibling entry NOT VERIFIED), and harden
the trust-jurisdictions review gate before the port is bound — content-derived profile revisions,
the two newer jurisdiction refusal codes mapped in the worker, a display-seam source-scan fitness
guard, and frozen silence-value singletons. No migrations, no schema, no route changes.
