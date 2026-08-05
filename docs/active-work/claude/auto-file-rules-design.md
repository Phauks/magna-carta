---
branch: claude/auto-file-rules-design
worktree: .claude/worktrees/agent-a7d5033b362556ca4
area: Email filing — auto-file rules (design only: the rule model, the guardrails, the consent posture, and the evaluation point)
status: designing
touches: docs/specs/, docs/decisions/pending/, changelog.d/, docs/active-work/
---

Design-only stream settling automatic filing of captured email over the suggestion machinery that
shipped with the add-in client API. It writes two specs, one decision fragment, and one changelog
fragment, and touches nothing in `packages/` or `apps/`. **No product code in this stream.**

What it settles: what a rule is (three typed kinds, no expression language, and the recognition that a
matter-bound capture address is already one); the guardrails that decide when a rule may act
unattended (ambiguity, the conflict/wall hook, creator access, the DKIM precondition, never
contradicting a human, matter state, and a per-rule circuit breaker); where the consent line falls
under the consensual-guided-data-conversion posture (staged by default, per-rule opt-in to direct
filing behind a firm-level ceiling); the audit and undo trail; and the evaluation point inside
`captureEmail` reached through an optional port. What it does not touch: any user interface,
notification delivery, mailbox sync, and machine-learned ranking.

## Overlap to watch

- **`claude/email-add-in-client-api`** owns `packages/email-filing/src/matter-suggestion.ts` and
  `apps/worker/src/routes/email-add-in.ts` and lands an index-only per-firm migration. This stream
  writes neither file; the build slice's migration ordinal reconciles against whatever lands first.
- **The build slice named in the plan** will add two per-firm tables
  (`email_auto_file_rule`, `email_auto_file_decision`), one nullable column on `email_matter_link`,
  one capability (`emails:manageAutoFileRules`) with its role seed, and an optional port on
  `CapturePorts`. Nothing here writes them.
- **The case calendar design** registers `email_matter_link` as a federated timeline source; an
  automatic link is an ordinary link and needs no registry change.
