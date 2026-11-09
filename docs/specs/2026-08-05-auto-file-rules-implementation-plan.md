# Auto-file rules for captured email — implementation plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Each build slice below is sized for one agent batch and leaves `main` shippable on its own.

**Goal:** Build the rule engine that lets captured email reach the right matter without a person
present — a closed set of three typed rule kinds, a guardrail function that fails closed, a staged-by-
default consent posture with an opt-in to direct filing, an evaluation ledger that records what fired
and what was suppressed, and the feedback loop that suspends a rule which keeps getting it wrong. No
user interface in these slices.

**Architecture:** The decision is a **pure function** in the shipped `@magna-carta/email-filing`
package, on the shape `rankMatterSuggestions` already established — the caller gathers evidence with
firm-scoped reads, the pure function decides, and the decision is testable with no database. It is
reached from `captureEmail` through a new optional port on `CapturePorts`, so the automatic link
rides the existing atomic write batch and the existing idempotency outcome body. Two new per-firm
tables (`email_auto_file_rule`, `email_auto_file_decision`) and one nullable column on the shipped
`email_matter_link`. No new capture path, no new filing path, no rule interpreter. Design spec:
[`docs/specs/2026-08-05-auto-file-rules-design.md`](2026-08-05-auto-file-rules-design.md).

**Tech stack:** TypeScript (ESM, ES2022), Drizzle (schema types; the column addition and the index
work are hand-written raw SQL where drizzle-kit would emit a rebuild), Cloudflare D1 (per-firm),
Cloudflare Queues (the capture consumer), Hono + `@hono/zod-openapi`, Vitest (+
`@cloudflare/vitest-pool-workers` for the worker suite), `vp` for test/lint/format.

## Global constraints

Every task's requirements implicitly include this section.

- **Full names, no shorthand** (golden rule 12): `emailAutoFileRule_`, `emailAutoFileDecision_`;
  `resolveAutoFileDecision`, never `resolveRule`; "the firm-scoped data-access layer", never an
  abbreviation; `newIdentifier`, never `newId`.
- **No process-artifact references in source, tests, or OpenAPI `description`s** (golden rule 13): no
  ADR numbers, no "spec", no "slice N" except a forward-looking schedule note. Enforced by
  `pnpm lint:process-refs`.
- **All business data through the firm-scoped data-access layer** (golden rule 3). The pure decision
  function holds no database handle and no `env`.
- **The guardrail function fails closed.** Its return type's default arm is `stage`; an unevaluable
  precondition produces a suppression reason, never an exception. A thrown error anywhere in evidence
  gathering degrades the capture to today's behaviour — staged, or unrouted — and never loses it.
- **Promotion to `filed` traverses `checkFilingConflict`.** No automatic path may reach `filed`
  without it; a fitness test asserts this.
- **Every matter set a member reads passes `filterAccessibleMatters`** before hydration, never after
  paging.
- **No message content in the decision ledger, the audit metadata, or any log line** — identifiers
  and enums only, the rule the capture idempotency body already follows.
- **No unbounded read.** Every rule lookup is by an indexed match value; every ledger read carries a
  `LIMIT`; the blast-bound window is capped.
- **Nothing retro-files.** Creating, resuming, or editing a rule never touches an existing message.
- **TDD:** write the failing test, watch it fail, implement the minimum, watch it pass, commit.
- **Migration ordinals, identifier prefixes, and ADR numbers reconcile at merge** if a sibling slice
  lands first. The add-in client API stream and the case-calendar build both touch this lineage.
- **Owner flags F1-F8 are answered before slice 2 starts.** Slice 1 is safe under every answer; slice
  2 hard-codes F1, F3, and F5.

## Commands

- Package tests: `pnpm --filter @magna-carta/email-filing test`
- Worker tests: `pnpm --filter @magna-carta/worker test`
- Repo tests including the Miniflare worker suite: `pnpm test`
- Scoped gate (inner loop): `pnpm check:scoped` · full gate: `pnpm check`
- Process-reference lint: `pnpm lint:process-refs` · decision lint: `pnpm lint:decisions`
- Per-firm migrations: `pnpm --filter @magna-carta/database run generate-per-firm-migrations`, then
  `refresh-per-firm-snapshot` in the SAME commit as any hand-written migration
- OpenAPI snapshot: `pnpm --filter @magna-carta/worker run emit-openapi`
- Typed client: `pnpm run generate-client`
- Measurement baseline: `pnpm --filter @magna-carta/fixtures run measure`

---

# Build slice 1 — The rule model and the pure decision

The walking slice: a firm can hold rules, and the guardrail function can be handed evidence and asked
what it would do. Nothing evaluates during a capture yet, so `main` behaves exactly as it does today.
This slice is safe under every answer to the owner flags.

## Task 1 — Identifiers, permission, and the schema

- [ ] `packages/identifiers/src/registry.ts` + `types.ts`: `emailAutoFileRule` and
      `emailAutoFileDecision` prefixes and branded types.
- [ ] `packages/access-control/src/registry.ts`: `emails:manageAutoFileRules`, with the comment
      stating why it is separate from `emails:manageLinks` — filing mail and configuring the machine
      to file mail are different grants.
- [ ] `packages/database/src/per-firm-schema.ts`: `email_auto_file_rule` per the design's section 6
      column list, with check constraints on `kind`, `promotion`, `state`, and `suspended_reason`,
      and a check that `suspended_reason` is present exactly when `state = 'suspended'`.
- [ ] `email_auto_file_decision` per the same section: message, nullable rule, matter, outcome,
      nullable suppression reason, the evidence structure, created instant. Check constraints on
      `outcome` and `suppression_reason`; a check that `suppression_reason` is present exactly when
      `outcome = 'suppressed'`.
- [ ] Add `auto_file_rule_id` to `email_matter_link` — nullable, expand-contract, no rebuild.
- [ ] Indexes: unique `(kind, match_value, matter_id)`; `(kind, match_value)`; `(matter_id)`;
      `(state)` for the suspension review; on the ledger, `(rule_id, created_at)` for the
      fire/undo derivation and `(email_message_id)` for the "why did this file" read.
- [ ] Generate the migration; hand-write the `role_permission` seed for the new capability on the
      `20260717T120001_seed-emails-permissions.sql` pattern (Owner/Admin and Attorney per flag F5).
- [ ] Refresh the per-firm snapshot **in the same commit** and run `check-snapshots`.
- [ ] Test: the chain applies to a fresh `node:sqlite`; every check constraint rejects its bad case;
      the unique index rejects a duplicate rule; no table rebuild is emitted.

## Task 2 — The evidence shape and the pure decision function

- [ ] `packages/email-filing/src/auto-file-rules.ts`: the typed evidence input — matched rules,
      thread-resolved matters, subject-number matters, the message's existing links, the DKIM verdict
      and reason, `captured_via`, the target matters' status, and the creators' current access — and
      the `AutoFileDecision` result: `file` | `stage` | `noRule`, the matter, the rule, and the
      reasons.
- [ ] Implement the guardrails as one function, in the order the design states them, each producing
      a named suppression reason: ambiguity, conflict hold, access, DKIM, human decision, matter
      state, blast bound.
- [ ] Ambiguity is **structural**, not score-based: partition evidence into deciding (rules, thread
      continuation, subject matter number) and non-deciding (participant party, search term); more
      than one distinct matter in the deciding set suppresses.
- [ ] The DKIM precondition is per-kind and asymmetric (design section 4.3): `correspondentMatter`
      requires an intact-original capture, a `pass`, and a verified domain matching the rule
      address's domain; the other kinds are suppressed only by a `fail` on an intact-original
      capture. `unverified` is "no answer", never "no".
- [ ] Reason phrasing lives in one table, as `matter-suggestion.ts` does, and carries no message
      content.
- [ ] Test the whole truth table — one test per guardrail proving it suppresses, one proving it does
      not fire spuriously, and the composite cases: two rules disagreeing; a rule pointing one way
      and the subject line another; a thread resolving to two matters; a `pass` whose domain does not
      match the rule address; a forwarded capture with a `correspondentMatter` rule (never fires); a
      message a person already filed elsewhere; a message previously unlinked from the target.
- [ ] Test that an evidence input with any field absent decides `stage`, never `file`.
- [ ] Export from `packages/email-filing/src/index.ts`.

## Task 3 — Statements and the rule service

- [ ] `packages/data-access/src/email-auto-file-statements.ts`: rule create, update promotion,
      suspend with reason, resume, revoke; the fire-time lookups by `(kind, match_value)`; the
      ledger insert; the bounded per-rule fire/undo derivation; the message's decision history.
- [ ] Every mutation composes a `domainAuditStatement`: `emails.autoFileRule.created`,
      `.updated`, `.suspended`, `.resumed`, `.revoked`, metadata carrying identifiers only.
- [ ] Test against `node:sqlite`: the lookups use the index (assert the query plan); the fire/undo
      derivation is bounded; an audit row lands for every mutation.

---

# Build slice 2 — Evaluation in the capture consumer

The slice where a rule actually acts. A message arriving at the firm catch-all, whose thread is
already filed to a matter, lands staged onto that matter with its reasons attached — and, where the
firm has enabled it and the rule opted in, lands filed. Requires flags F1, F3, and F5 answered.

## Task 1 — The port on the capture core

- [ ] `packages/email-filing/src/capture.ts`: add optional `resolveAutoFileDecision` to
      `CapturePorts`, called at the point where `matterId` and `linkState` are decided — before the
      write plan is built, so the automatic link rides the existing atomic batch.
- [ ] An absent port means today's behaviour exactly. A port that throws is caught and degrades to
      today's behaviour, logged through the standard pipeline with no message content.
- [ ] The resulting link carries `autoFileRuleId` on `CaptureLinkPlan`; a person-made link carries
      null.
- [ ] Promotion to `filed` still traverses `checkFilingConflict`, unchanged — a conflict demotes to
      `staged` exactly as it does for the API entrance.
- [ ] Test: every existing capture test passes untouched with the port absent; with a port returning
      `file`, the plan writes one `filed` link naming the rule; with a conflict, the same input
      writes `staged`; a throwing port produces the unrouted or staged result and never loses the
      capture.

## Task 2 — The evidence gatherer in the consumer

- [ ] `apps/worker/src/emails/auto-file-evaluation.ts`: the five bounded reads of design section 8,
      issued together, reusing `readFiledMattersForThreads` and `findMattersByNumbers` rather than
      new statements.
- [ ] Resolve each candidate rule's creator access through `filterAccessibleMatters` — the same
      single narrowing point, never a second filter.
- [ ] Wire it into `apps/worker/src/emails/capture-consumer.ts` as the port implementation.
- [ ] Test in the Miniflare suite: a catch-all capture whose thread is filed lands staged on that
      matter; the same capture with a direct-filing rule and the firm policy on lands filed; with the
      policy off it lands staged; a rule naming a closed matter never fires.
- [ ] Test that a queue redelivery replays the identical decision through the idempotency record and
      does not re-evaluate into a second link.

## Task 3 — The ledger write and the audit rows

- [ ] Write one `email_auto_file_decision` row per capture where a rule matched or a match was
      suppressed — and nothing where no rule looked twice, so the table stays proportional to rule
      activity rather than mail volume.
- [ ] The ledger row and the link ride the same batch as the capture write, so a body can never claim
      a decision that rolled back.
- [ ] `emails.autoFiled` and `emails.autoFileStaged` audit rows on the shipped `domainAuditStatement`
      pattern, metadata `{ matterId, ruleId }` and nothing else.
- [ ] Raise `raiseEmailFiledNotification` on an automatic filing exactly as the manual path does.
- [ ] Test: a suppressed match writes a ledger row with its reason and no link; a capture no rule
      matched writes no ledger row; no ledger column and no audit metadata field ever holds a
      subject, an address, or a display name (assert over the written rows).

## Task 4 — The firm policy

- [ ] The firm-level pair on the `apps/worker/src/routes/firm/scan-policy.ts` precedent: read the resolved
      policy (whether direct filing is permitted, whether `matterNumberInSubject` is enabled), and
      patch any subset. Owner/Admin only.
- [ ] The policy is a **ceiling**: with direct filing off, a rule whose promotion is `file` still
      stages, and the ledger records the policy as the reason.
- [ ] Test: a `file` rule under a policy-off firm stages, with the reason recorded; flipping the
      policy changes the next capture with no re-ingest.

## Task 5 — The blast bound and the undo feedback

- [ ] The circuit breaker in the consumer path: a bounded ledger read over the rolling window per
      flag F7; over threshold, the rule is suspended with `blastBound` and the capture stages.
- [ ] `apps/worker/src/routes/email/emails.ts`: unlinking a link whose `auto_file_rule_id` is non-null also
      records a reversal in the ledger. The unlink route's contract is otherwise unchanged.
- [ ] Undo-rate suspension on the same mechanism with the undo input.
- [ ] Test: a burst of matching messages trips the breaker and subsequent captures stage; undoing
      three of the last ten firings suspends the rule; a suspended rule stops firing and stays
      visible with its reason.

---

# Build slice 3 — Management surface, review read, and measurement

The slice that makes rules creatable, prunable, and legible. No user interface — the routes and the
reads a surface will consume.

## Task 1 — The rule write routes

- [ ] Create (from a filing, or directly), update promotion, suspend, resume, revoke. All through
      the chokepoint with full route metadata, `emails:manageAutoFileRules`, `resource: "matter"`,
      idempotency-keyed, audited.
- [ ] Creation validates: the creator can access the matter now; the matter is open; the rule is not
      a duplicate; a `correspondentMatter` address is a syntactically valid, normalized address; a
      `threadContinuation` thread exists and has at least one filed link on the named matter.
- [ ] Creation from a filing records `created_from_email_message_id` — the authorizing act.
- [ ] Setting `promotion` to `file` is refused outright when the firm policy is off, with a problem
      response that says so rather than silently accepting a posture that cannot take effect.
- [ ] Test: each validation rejects its case; a member without the capability is refused; a member
      who cannot access the matter is refused; creation never files an existing message.

## Task 2 — The reads

- [ ] The matter's rules, and the "why did this file itself" read for one message — the ledger rows
      rendered through the phrasing table.
- [ ] The review read: recent automatic links with their rules, fire and undo counts, and suspension
      state, narrowed through `filterAccessibleMatters` **before** hydration.
- [ ] `emails:read` on all three, on the precedent that a member who can read filed mail can be told
      why it is filed.
- [ ] Test: a rule on a matter the caller cannot access contributes nothing to any read — no row, no
      count, no suspension entry.

## Task 3 — Fitness tests

- [ ] A source scan asserting no automatic path reaches `filed` without traversing
      `checkFilingConflict`.
- [ ] A test asserting the rule-kind set is closed — the schema check constraint, the TypeScript
      union, and the guardrail function's switch agree, so a fourth kind cannot be added in one place
      only.
- [ ] A test asserting no decision-ledger column and no audit metadata key can hold free text from a
      message.

## Task 4 — Load profile and the four measurements

- [ ] Extend the existing fixtures corpus (never a new harness): capture with and without rules; a
      firm with ten thousand rules across a thousand matters; a long thread; a hundred-message burst
      against one rule.
- [ ] Record the four numbers of design section 10 with their budgets, and assert the flat-cost claim
      — rule population must not move per-capture cost.

## Task 5 — Contract and documentation

- [ ] Re-emit `apps/worker/openapi/openapi.json` and regenerate the typed client in the same commit.
- [ ] `docs/user/features/filing-email-to-a-matter.md`: the sentence "every capture lands staged —
      nothing is silently auto-filed" needs its conditional clause, plus a section on what a rule is,
      what it will refuse to do, and how to undo one. User docs are the one home for this.
- [ ] `packages/email-filing/CLAUDE.md` (create from the area template if absent): the guardrail
      list as local rules, and the fail-closed obligation.
- [ ] `changelog.d/` and `status.d/email-filing.md` fragments; never the rendered trackers.
- [ ] Declare the two notification emission points ("a rule was suspended", "the review digest is
      ready") without wiring them.
