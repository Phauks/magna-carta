# Client intake / CRM — implementation plan

**This plan does not start.** Seven build-gating owner flags in
[`2026-08-15-client-intake-design.md`](2026-08-15-client-intake-design.md) — **J1 through J7** —
decide what is in it. J1 decides whether stage 3 exists at all, J2 decides what stage 2's gate does
when it fires, J4 decides whether stage 4 ships a shared board or a per-attorney view, and J6 decides
whether stage 5 has a note to render. The plan is written now so that answering those seven flags is
the only work between here and a first commit.

**Ordering principle.** Each stage is a vertical slice — schema through the firm-scoped data-access
layer, domain, route, interface, tests and documentation — and each ships something a firm can use.
The ordering is by **how much of the front door has to be open**: stage 1 needs one member and a
keyboard, stage 2 needs the shipped conflicts engine and nothing else, and the anonymous surface does
not appear until stage 3, where every question about untrusted input has to be answered at once.

**What every stage inherits and none re-implements.** Firm-scoped data access, the effect batch and
its audit row, idempotency on every mutating route, the permission registry, the OpenAPI
code-as-contract surface, and the design system. A stage below that appears to write a table directly
is a defect in this plan, not a licence.

---

## Stage 1 — The consultation, typed by a member (gated on J1; no public surface)

The whole point of this stage is that it has no anonymous surface at all. It is the flow a
receptionist, a walk-in and a phone call all share, and it works before any of the harder questions
are answered.

1. **`@magna-carta/intake`**, pure on the house pattern: validates in memory, composes statements into
   `composeEffectBatch`, holds no D1 binding, performs no input and output of its own, calls no
   external service. Modelled on `packages/matters` file for file.
2. **`intake_submission` schema.** The verbatim payload, the typed columns for the bounded field
   vocabulary, `source` as an open catalog (`staff_entered`, `public_form`, `telephony` reserved), the
   form and form-version references (nullable — a staff-typed submission arrived through no form), the
   receipt instant, and the triage outcome with its reason and its acting member. Append-and-flip on
   the outcome, never an in-place edit, so a re-triage keeps the first answer.
3. **Identifiers.** `intakeSubmission` and `intakeStage` in
   `packages/identifiers/src/registry.ts`, spelled in full.
4. **The promotion composer.** One function: a submission plus a member's choices produces, in one
   atomic batch, a Directory entity (through `@magna-carta/directory`'s own create path, never a
   statement of intake's own), the `matter_party` link, a prospective matter through
   `@magna-carta/matters`'s `createMatter`, the submission's acceptance stamp, and the audit row. It
   takes an existing entity id instead when the member picked a duplicate candidate.
5. **Duplicate suggestion at triage, staff-side only.** `findDuplicateCandidates` over the typed name
   and email, rendered for the member to choose. This is the read the public surface may not perform
   and the staff surface must.
6. **Permissions.** `intake:triage` (accept or reject a submission) and `intake:read`. Conversion
   continues to require `matters:open`; intake mints no permission that opens a matter.
7. **Route, contract, interface.** The triage queue and the accept and reject actions, behind
   `intake:triage`, with the mutating-route idempotency requirement, OpenAPI as code-as-contract, and
   surfaces built only from `@magna-carta/design-system`.
8. **Fitness.** The two source scans from the design's section 13 that apply here: the intake package
   never imports `findDuplicateCandidates`, `phoneticCodes` or `normalizeName` into any path a
   submission reaches, and no queue consumer or scheduled handler imports the promotion composer.
9. **PII registry.** `intake_submission` with a stated action, under that registry's coverage test.
10. **Docs.** `docs/user/` for the "take an enquiry" task; a `packages/intake/CLAUDE.md`; the changelog
    fragment; the ledger nodes.

**Depends on nothing outside the repository.** If J1 is answered as recommended, this stage can start
the day the flags come back.

## Stage 2 — Conflicts at intake, and the conversion gate (gated on J2, J5, J7)

Nothing in this stage is a matching change. It is two calls into a shipped engine and one precondition
in front of a shipped transition.

1. **The preliminary check at acceptance.** `runConflictsCheck` with `trigger: "preliminary"`, the new
   subject entity ids, and no `matterId` — so `imputation` records `unavailable` honestly. Run from the
   member's own request, so `actor_user_id` is theirs and `trigger_source` is `manual`.
2. **The comprehensive check before conversion.** `trigger: "comprehensive"` with the matter and its
   full party set.
3. **The reader-facing surface.** `describeCheck`'s statement list and the hits grouped by evidence
   tier with `describeEvidence`'s strings, `co_party` bucketed apart, every unavailable source listed
   with its reason. No badge, no colour that means safe, no summary boolean — and
   `tooling/lint-conflicts-vocabulary/` extends its scan set to these surfaces in the same commit.
4. **The gate**, as a matter close-precondition's mirror on the open side: a named, registered
   precondition on `openMatter` reading `readMatterConflictsPosture` for `neverChecked`,
   `scopeShortfall`, undisposed hits and `pendingRecheck`. It lives where the rule lives — a conflicts
   precondition registered by the composition root, never a conflicts import inside the matter shell,
   exactly as `closePreconditions` is threaded today.
5. **The override, if J2 says there is one.** A named member, a mandatory rationale, an audit row, and
   the posture as at that instant reproducible from the log. It is a distinct permission
   (`intake:overrideConversionGate`), never an implication of `matters:open`.
6. **Decline.** The recorded outcome on the intake record plus `closeMatter` on the matter, in one
   batch. J5 decides whether a completed check is a precondition of recording it.
7. **The fee agreement hand-off.** `setBillingArrangement` at conversion, or before it if J7 permits.
   Intake composes no billing statement of its own.
8. **Fitness and tests.** The conversion refusals one test each, by name; the declined consultation
   still surfacing on a later unrelated check and its original report still reproducing unchanged
   through `describeCheck`; and the assertion that the intake conversion path composes no `matter`
   UPDATE of its own.

## Stage 3 — The public form (gated on J1, J3, J10, J11)

This stage is where every untrusted-input question has to be answered at once, which is why it is not
stage 1.

1. **The form definition and its versions.** Per-firm, versioned, published at a path checked against
   the reserved route namespace. Fields drawn only from the bounded platform vocabulary J10 confirms.
2. **The conformance test that keeps the vocabulary safe.** No form field kind maps to a
   `protectedField` declaration, asserted against the registry so widening either side fails the gate.
3. **The public route.** `surface: "public"`, `authenticated: false`, `permission: null`,
   `idempotency: "optional"`, `rateLimit: "auth"` — the registration route's posture, for the
   registration route's reasons.
4. **The disclosure rule, structurally.** One write, no read. The route module carries the source scan
   that proves it: no `SELECT` against a Directory, matter or conflicts table on the submission path.
   A timing test would be flaky and would pass on a fast machine with the bug present.
5. **Turnstile**, in managed mode, gated on J11 having a running control rather than a checkbox.
6. **The per-form submission budget**, so a flooded firm can throttle or close one form without
   touching the others or its authenticated surface.
7. **Attachments**, only if J3 says so, and then through the existing untrusted-ingest and
   malware-scan pipeline with its per-firm policy — never a second upload path.
8. **Tests.** The identical-response behaviour asserted against a seeded corpus containing a name with
   several duplicate candidates, a name adverse to a live matter, and an unknown name: identical
   status, identical body, identical shape.

## Stage 4 — The pipeline (gated on J4, J8)

1. **`intake_stage` schema.** Per-firm, name, sort order, active flag; soft-deactivated rather than
   deleted, on the matter-type precedent. Seeded at provisioning with the set J8 confirms.
2. **The current stage on the prospective matter**, append-and-flip so the history of a lead's
   progress survives, changed by an audited write.
3. **The board.** Firm-visible or per-attorney per J4, reading the same prospective matters the
   Consultations folder reads so the two can never disagree.
4. **The rule, held mechanically.** A stage is never read by a precondition. The fitness function is a
   source scan: no precondition, permission check or gate imports the stage reader.
5. **Fitness.** No matter carries both `opened_at` and a stage; every stage reference resolves within
   its own firm.

## Stage 5 — CRM fields, the timeline, and the engagement letter (gated on J6)

1. **Custom fields on the consultation and the prospect**, rendered on the pattern the matter detail
   surface already uses. Intake defines no fields; the firm does.
2. **The derived timeline**: submissions received, triage, stage changes, conflicts checks and their
   dispositions, calendar events, filed emails, assembled documents. One batched read per source, never
   a per-item resolver.
3. **The note**, only if J6 puts it here — and if it does, it belongs to every matter and is a platform
   slice this stage depends on rather than a part of it.
4. **The engagement letter hand-off.** The assembly is `packages/document-assembly`'s, against a
   template the firm registered, filed to the open matter through the ordinary path. Intake supplies no
   template and no merge fields.

---

## Deliberately not in this plan

- **The telephony port, transcription and call recording.** The port does not exist. This plan reserves
  `telephony` in the submission source catalog and stops there; the port has its own design cycle.
- **Ethical walls**, and therefore any per-matter concealment of a declined prospect's information.
  Unbuilt seam, named in the design and flagged for the owner.
- **E-signature of the engagement letter**, the client portal, marketing attribution and automated lead
  scoring — each named in the design's section 11 with its reason.
- **A `lead` table.** A lead is a prospective matter. Nothing in these five stages creates a second one.
- **A submission purge job**, until J9 settles what distinguishes an untriaged genuine enquiry from a
  bot post.
