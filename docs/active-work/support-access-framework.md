---
branch: support-access-framework
worktree: C:/dev/magna-carta-worktrees/support-access-framework
area: Platform — Support Access Framework (help-desk instance access; backend rails)
status: designing
touches: docs/specs/2026-06-25-support-access-framework-design.md, packages/database/src/control-plane-schema.ts (new platform_staff + support_grant tables), packages/access-control/src/registry.ts (new diagnostics:* namespace), apps/worker/src/session-context.ts + chokepoint (support-principal resolution), apps/worker auth/control-plane migrations, docs/decisions/pending/** (ADR), changelog.d/**, STATUS.md, ROADMAP.md
---

Backend framework + permissions for help desk to access a firm's instance to diagnose problems. Support is
**pull, not push**: a firm member's request mints a time-boxed, named, audited **grant**; a named platform
**staff principal** redeems it to obtain a `SessionContext` the chokepoint already understands.

Two tiers, one mechanism: `diagnostic` (system state only — permission set carries no decrypt keys, so
privileged content is unreachable by construction) and `privileged` + `scope: self` (exactly the
requester's own effective permissions — no firm-level escalation; the user sharing their own view).

Scope of THIS stream: the rails only — `platform_staff` identity (MFA, principal abstraction reserving a
future `agent` variant), `support_grant` lifecycle, chokepoint enforcement by tier, consent (any member
requests; admins notified + revoke; optional `require_cosign` firm policy on privileged), and the
firm-visible audit trail. UI (support console + privileged view-as render), notification transport, and
AI-agent principals are deferred named seams.

Design: `docs/specs/2026-06-25-support-access-framework-design.md`.
Related memory: step-up-reauth firm-setting pattern; release-channels backend-rails staging.
