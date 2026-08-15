---
branch: claude/awaiting-owner-sweep
worktree: /home/user/magna-carta/.claude/worktrees/awaiting-owner-sweep
area: Surface the open owner flags from the merged designs onto the feature ledger, so the build register's "Waiting on you" section reflects what is actually blocked
status: review
touches: roadmap.d/auth.md, roadmap.d/conflicts.md, roadmap.d/core-domain.md, roadmap.d/document-automation.md, roadmap.d/financial.md, roadmap.d/intake.md, roadmap.d/payments.md, roadmap.d/tasks.md, docs/now.md, changelog.d/
---

Documents only — no source, no schema, no status flips. The stream reads the owner-flag sections of
the merged designs (trust PDF statement import, the Nevada court-form library, payments, client
intake, notes and activity, tasks and matter plans, plus the older sets swept for anything ADR-0255's
docket did not close) and adds one `awaiting-owner` line per genuinely blocked ledger node, then
re-renders `docs/now.md` with `vp run register-build`.

A concurrent stream that needs to edit a `roadmap.d/` fragment should expect a conflict only on the
node block it touches; every edit here inserts a single `awaiting-owner:` key and changes nothing
else. `docs/now.md` is regenerated wholesale, so re-run `vp run register-build` after merging rather
than resolving it by hand.
