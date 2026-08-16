---
worktree: /home/user/magna-carta/.claude/worktrees/billing-automations-design
area: Slice 3·7 — billing automations: design + implementation plan only, no application code
status: designing
touches: docs/specs/, docs/decisions/pending/, roadmap.d/financial.md, status.d/3-7-billing-automations.md, docs/now.md
---

Design-only cycle for the scheduled "no client present" layer over billing 3·4 — recurring and batch
bill generation, payment reminders, payment plans, and evergreen below-floor replenishment alerts. It
writes two documents in `docs/specs/`, one decision fragment, one new `status.d/` fragment, and adds
the billing-automation nodes to `roadmap.d/financial.md` (re-rendering `docs/now.md`). **No package,
schema, migration, route or test is touched** — a concurrent build stream can ignore this branch
except for `roadmap.d/financial.md`, where it appends nodes under `financial.billing.automations` and
edits no existing node except the retainer node's `notes`.
