---
worktree: .claude/worktrees/agent-aa05818cd84b34048 (agent worktree)
area: Email auto-file rules — the management surface (rule writes, the matter's rule list, the "why did this file itself" read, and the review read)
status: building
touches: apps/worker/src/routes/auto-file-rules.ts, apps/worker/src/app.ts, apps/worker/test/, apps/worker/openapi/openapi.json, packages/api-client/, packages/data-access/src/email-auto-file-statements.ts, packages/database/src/per-firm-schema.ts, packages/database/drizzle/per-firm/, packages/email-filing/CLAUDE.md, packages/fixtures/src/load-profile/, docs/user/features/filing-email-to-a-matter.md, roadmap.d/communications.md, status.d/email-filing.md, ROADMAP.md, changelog.d/, docs/decisions/pending/
---

The auto-file engine evaluates on every unrouted capture and **nothing in the product creates a rule**
— no route, no service, no seed. `createEmailAutoFileRule` has exactly one caller in the repository
and it is a test. So the engine has been deciding over an always-empty candidate set since it landed:
every capture pays two indexed lookups, finds nothing, and returns `NO_AUTO_FILE_RULE_MATCHED`. This
stream closes that: the rule write surface (create from a filing, set promotion, suspend, resume,
revoke), the matter's rule list, the per-message decision history, and the firm-wide review read.

Also in scope because the reads need it: a **partial index on `email_matter_link.auto_file_rule_id`**.
The shipped undo derivation in `readAutoFileRuleActivity` subqueries that column with no index behind
it, which is a scan of the firm's every link on the capture path once a rule matches.

Nothing about the pure guardrail function, the capture port, or the evidence gatherer changes — the
decision is already built and already correct; only its inputs were unreachable.

**Overlap:** `claude/passive-dev-orchestrator-m7f9jw` and `claude/ledger-status-reconciliation` both
touch `roadmap.d/` and the three rendered register documents. This stream flips exactly one node
(`communications.email.filing.auto-file-rules`) and re-renders, so the collision surface is
`roadmap.d/communications.md` plus `docs/now.md` / `docs/now.html` / `docs/decisions-open.html`.
