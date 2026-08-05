---
branch: claude/auto-file-rules-slice-1
worktree: .claude/worktrees/agent-ac64de3b111a6fdb9
area: Email filing — auto-file rules, build slice 1 (the rule model, the capability, and the pure guardrail decision)
status: building
touches: packages/identifiers/, packages/access-control/, packages/database/, packages/data-access/, packages/email-filing/, apps/worker/test/, docs/user/features/filing-email-to-a-matter.md, changelog.d/, status.d/, docs/active-work/
---

Build slice 1 of the auto-file rules plan: a firm can hold rules, and the guardrail function can be
handed evidence and asked what it would do. **Nothing evaluates during a capture yet** — no capture
path, no route, and no user interface change, so `main` behaves exactly as it does today.

What it lands:

- `emailAutoFileRule` / `emailAutoFileDecision` identifier prefixes and branded types.
- The `emails:manageAutoFileRules` capability, seeded to Owner/Admin and Attorney (Paralegal by firm
  grant), and its four inventories.
- Two per-firm tables (`email_auto_file_rule`, `email_auto_file_decision`), the nullable
  `auto_file_rule_id` column on the shipped `email_matter_link`, and their indexes — one migration,
  tag `20260805T220000_auto-file-rules`, snapshot refreshed in the same commit.
- `packages/email-filing/src/auto-file-rules.ts` — the typed evidence input and the pure
  `resolveAutoFileDecision` guardrail function, failing closed.
- `packages/data-access/src/email-auto-file-statements.ts` — the rule mutations with their audit
  rows, the fire-time lookups, the ledger insert, and the bounded activity derivation.

Also fixes the `@magna-carta/email-filing` `./already-filed` export entry, which pointed at a file
that never existed (the already-filed read lives in `apps/worker/src/routes/emails.ts` over
`packages/data-access/src/email-filing-statements.ts`).

## Overlap to watch

- **The billing branch** is in flight with per-firm migration tag `20260805T210000`. This stream's
  tag sorts after it, so the apply order is right whichever merges first; the second to merge retags
  its journal idx.
- **The email add-in client API stream** owns `packages/email-filing/src/matter-suggestion.ts` and
  `apps/worker/src/routes/email-add-in.ts`. This stream writes neither — the guardrail function
  gathers its own evidence shape and only re-uses `candidateMatterNumbers` conceptually.
- **`apps/worker/test/me.test.ts`, `apps/worker/test/auth-provisioning-e2e.test.ts`,
  `packages/database/test/node-sqlite.test.ts`, and
  `packages/access-control/test/registry.test.ts`** each carry a permission inventory this stream
  extends by one key. Any stream minting a capability touches the same four lists.
- **The case calendar design** registers `email_matter_link` as a federated timeline source; the new
  nullable column is additive and needs no registry change.
