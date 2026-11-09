# @magna-carta/email-filing — CLAUDE.md

**Purpose.** The pure core of email capture and filing: one `captureEmail` both entrances converge
on, the record model, the thread DAG, dedup, capture-address tokens, the DKIM verifier, matter
suggestion ranking, and the auto-file guardrail decision. It holds no database handle, no `env`, and
no clock — callers gather with firm-scoped reads, this package decides, and every decision is
testable with no database.

**White paper:** _Email filing and capture_ —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md).
**API standard:** [`docs/conventions/api.md`](../../docs/conventions/api.md).

## Key files / entry points

- `src/capture.ts` — `captureEmail` and the `CapturePorts` it orchestrates over: parse, persist,
  Directory resolution, DKIM verification, the auto-file decision, and the atomic write. Both the
  Email Worker forward path and the authenticated API path enter here.
- `src/record.ts` — the row shapes a parsed message becomes, and `normalizeAddress` (trim +
  lowercase), the one normalization every address in the subsystem is keyed on.
- `src/thread.ts` / `src/dedup.ts` — thread resolution and the dedup key.
- `src/capture-address.ts` / `src/capture-token.ts` — the forward/CC credential.
- `src/dkim.ts` — RFC 6376 verification over WebCrypto; a three-value verdict plus a reason.
- `src/matter-suggestion.ts` — the four-signal ranking a mail client asks for, with `ambiguous`.
- `src/auto-file-rules.ts` — `resolveAutoFileDecision`, the guardrails, and the phrasing tables.
- `src/seams.ts` — `checkFilingConflict` and `raiseEmailFiledNotification`, both placed and both
  no-ops today.

## Local conventions

- **Gather outside, decide inside.** Every ranking and every decision here takes assembled evidence
  and returns a verdict. Adding a database read to this package is the wrong fix for a missing fact;
  add the fact to the evidence type and make the caller supply it.
- **A reason is an enum plus a sentence from a table.** Never an interpolated string. The tables in
  `auto-file-rules.ts` and `matter-suggestion.ts` are the only place wording lives, and no entry may
  interpolate anything from a message — which is what makes "the explanation carries no message
  content" a property of the code rather than of the caller's care.
- **The vocabulary has four homes and they are swept.** A rule kind, a suppression reason, and a
  demotion reason each appear in this package's unions, the per-firm schema's column enums and CHECK
  constraints, the data-access layer's structurally-identical declarations, and the API's zod enums.
  `test/auto-file-closed-set-fitness.test.ts` reads all four and fails when one moves alone.

## Invariants that apply here

- **The auto-file decision fails closed, structurally.** The result type's default arm is `stage`,
  never `file`. A precondition that cannot be evaluated produces a named suppression reason, never an
  exception. Every field of `AutoFileEvidence` must be STATED — an absent one is `incompleteEvidence`,
  because a gatherer that omitted a field did not answer the question and an unanswered question is
  never permission. A malformed entry inside a list is unevaluable rather than absent: skipping it
  would shrink the deciding set, and a deciding set of one is exactly what permits a firing.
- **Ambiguity is structural, never score-based.** The deciding evidence is matched rules, thread
  continuation, and an exact subject matter number; more than one distinct matter among them
  suppresses. It is deliberately not read off `matter-suggestion.ts`'s `ambiguous` flag, which is a
  tie on a sum of tuning constants for ordering a list a human reads — coupling an unattended filing
  to those constants means retuning the suggestion order silently changes which messages file
  themselves.
- **No automatic path reaches `filed` without the conflict hook.** The hook arrives at the evidence
  gatherer as a closure the capture core supplies, so `checkFilingConflict` keeps exactly one call
  site and the recorded reason and the actual link state cannot disagree. The core re-applies the same
  memoized answer to the decided matter before it commits.
- **A rule may not outlive the access that authorized it.** The delegating member's access to the
  matter is re-checked at every fire. `false` suppresses and recommends suspension; `null` — the
  question could not be answered — suppresses and recommends nothing, because unanswerable is not
  proof that access was withdrawn.
- **The signature gates the robot, not the record.** The DKIM precondition binds asymmetrically and
  only where the question is answerable: `correspondentMatter` requires an intact-original capture, a
  `pass`, a signature covering the whole body, and a verified domain matching the rule's address; the
  other kinds are suppressed only by an outright `fail` on an intact original. `unverified` is "no
  answer", never "no". Nothing the verdict says may cause a message to be lost, hidden, or degraded.
- **A rule never contradicts a person.** No firing on a message somebody already filed elsewhere, and
  none onto a matter somebody removed it from.
- **Nothing here retro-files.** A rule is forward-looking. Creating, promoting, or resuming one never
  touches a message the firm already holds.
- Firm-scoped data access (root golden rule 3) binds the CALLERS of this package; nothing here holds
  a handle to enforce.

## Dependencies & contracts

- Depends on `@magna-carta/email` (the Rust parse core through its WASM edge),
  `@magna-carta/identifiers`, and `@magna-carta/money` only for value types.
- Consumed by `apps/api-worker/src/emails/` (the capture consumer, the evidence gatherer, the firm policy
  helpers) and by `apps/api-worker/src/http/routes/` (`emails.ts`, `capture-addresses.ts`, `email-add-in.ts`,
  `auto-file-rules.ts`, `auto-file-policy.ts`).
- The statements those callers use live in
  `@magna-carta/data-access/email-filing-statements` and `.../email-auto-file-statements`.

## Gotchas

- **A rule's `match_value` must be in the form the capture path looks it up by.** For
  `correspondentMatter` that is `normalizeAddress(address)`. A rule stored in any other form is a row
  that can never match, and nothing fails — it simply never fires.
- **`resolveAutoFileDecision` returning `noRule` with a null suppression reason means nothing
  happened at all**, and its caller must write no ledger row. `NO_AUTO_FILE_RULE_MATCHED` is exported
  precisely so a gatherer that short-circuits before assembling evidence returns the same value this
  function would have.
- **The circuit breaker's window limit must sit above its fire threshold.** The activity read CAPS the
  count it reports, so a cap at or below the threshold means the reported count can never reach it and
  the breaker is disabled while reading as configured. `activityWindowLimitFor` derives it for exactly
  that reason.
- **A correspondent rule structurally cannot fire on the forward or catch-all path.** Forwarding
  breaks the original signature, so the identity precondition can never be met there. That is the
  guardrail working, not a gap: on that path the platform knows who forwarded a message, not who sent
  it. Thread continuation still works there, which is what makes the catch-all case pay.
