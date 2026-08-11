# Trust — authority-based authorization — design

**Date:** 2026-08-10
**Status:** Design proposed, owner-directed. No product code, no migration, no schema in this
cycle.
**Scope:** How the owner's authority-based rule for money leaving a client ledger maps onto the
authorization machinery already shipped: which stored posture expresses it, how the shipped default
changes, how a member without authority is routed to one who has it, whether the database mirrors
can express the four-cell matrix, and what each path records on its face.
**Area:** `packages/trust` (`authorization-policy.ts`, `disbursement-authorization.ts`,
`transfer.ts`), `packages/billing` (`apply-authorization.ts`), one new per-firm migration carrying a
seed row, the trust routes in `apps/worker`, and the authorization surfaces in `apps/web`.
**Not in scope:** matter-to-matter reallocations (still outside the policy), per-payee or per-day
threshold aggregation (a stated limitation of the threshold posture), and the question of whether
changing the posture itself takes a second person — already flagged on the shipped decision.

---

## 1. The direction being implemented

The owner, verbatim:

> "one person should be able to do trust authorizations. really, the person who can approve can do
> it solo. but if someone doesn't have that, it needs to go to a person to approve."

And the composition settled in follow-up:

- an authority holder acts **solo below any firm-set threshold**;
- **above** the threshold even an authority holder needs a **second person**, and the firm may
  require that second person to **also hold authority** (peer approval — two holders satisfy it, no
  regress);
- the **lone-holder exception** covers a firm with only one authority holder.

## 2. What is already built

The disbursement-authorization policy shipped with:

- `trust_authorization_policy` — append-only, densely versioned, one row per posture change:
  `policy` in (`off`, `threshold`, `always`), a `threshold_amount_minor`, and an independent
  `require_authorized_approver` flag demanding that whoever lets money go holds `trust:authorize`.
- **Absent row = version 0 = always two-person, authority off** — the strict posture, so nothing
  relaxed on migrate.
- **Stamping.** Every `trust_disbursement_request` and every `trust_transfer` carries the policy
  version in force when it was submitted; the decision triggers read the **stamp**, never the latest
  row. A stamp-is-current trigger stops a caller reviving a superseded posture.
- **One queue, two kinds.** A `disbursement` request and an `earned_fee_application` request share
  the table, the decision row, and the trigger set.
- **The lone-holder fix.** The sole actor must _be_ the counted `trust:manage` holder, in the
  composers and in both triggers — a member who can submit but not authorize cannot borrow the
  exception.

**The four mirrors** of the exemption predicate — the one question "does this amount take a second
person under this stamped policy", written out four times and required to agree:

| #   | Mirror                                                               | Where                                                                |
| --- | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1   | `trustAuthorizationRequiresSecondPerson`                             | `packages/trust/src/authorization-policy.ts` (the TypeScript switch) |
| 2   | `trust_disbursement_decision_sole_basis_requires_two_person_policy`  | migration `20260807T050000` (CASE over the stamped row)              |
| 3   | `trust_disbursement_decision_exempt_basis_requires_exempting_policy` | same migration, the inverse CASE                                     |
| 4   | `trust_transfer_requires_second_person`                              | same migration, the transfer's own CASE                              |

Two further pairs mirror alongside them: the authority requirement
(`trust_disbursement_decision_approver_holds_authority` /
`trust_transfer_authorizer_holds_authority`, fronted by `assertActorHoldsTrustAuthority`) and the
lone-holder count (`trust_disbursement_decision_sole_basis_requires_lone_manager` and the
`trust:manage` subquery inside mirror 4). **Every mirror this design leaves untouched is a mirror
that cannot drift**, which is the criterion the model mapping below is judged on.

---

## 3. Decision 1 — model mapping: no new policy kind

**Recommendation: re-read the existing kinds. Add no `'authority'` value, and do not widen the
policy CHECK.**

The owner's composition is already a representable point in the shipped model, because
`require_authorized_approver` binds **whoever lets money go** — the second-person approver _and_ the
sole actor on an exempt amount. Set it, and the exemption stops being amount-only in effect: an
amount the threshold exempts can still only be released by a holder, and a non-holder's
self-approval is refused, leaving the request pending for a holder. That is the owner's sentence,
enforced.

| The owner's posture                                          | Stored as                                                                               |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Holders act solo at any amount; everyone else routes         | `policy = 'off'`, `require_authorized_approver = 1`                                     |
| Holders act solo below X; above X takes a second person      | `policy = 'threshold'`, `threshold_amount_minor = X`, `require_authorized_approver = 1` |
| Every payment takes two people, the releaser holds authority | `policy = 'always'`, `require_authorized_approver = 1`                                  |
| The pre-existing amount-only postures                        | the same three kinds with `require_authorized_approver = 0`                             |

**Peer approval falls out rather than being added.** Above the threshold the person who decides
_is_ the second person, and the authority trigger binds the decider — so with the flag on, the
second person necessarily holds authority. Two holders satisfy it and there is no regress, exactly
as the composition requires.

**Trade-offs.**

- _A new `'authority'` kind_ would be self-describing in the stored row and in the admin surface,
  and would let the exemption read "this actor holds authority" directly rather than as a
  consequence of two predicates. It costs: a widened CHECK on `trust_authorization_policy.policy`
  (SQLite cannot widen a CHECK in place, so a **second table rebuild** of a table that now holds
  firms' evidentiary posture history), a new branch in **all four mirrors** — three of them
  requiring the actor's capability inside a trigger CASE, which today reads only the row and the
  amount — and a fifth possible value the "unrecognized kind requires two people" fallback must keep
  refusing safely. Four mirrors grow; the migration stops being additive.
- _Re-reading_ costs legibility: `policy = 'off'` with the authority flag on does not read as
  "authority-based" to anyone looking at the raw row. The answer is presentational, not structural —
  the admin surface and the audit face name the composed postures ("authority holders act alone",
  "…below $X, two people above") and the stored triple stays the vocabulary. Add no synonym to the
  database for a sentence the UI can compose.

**Migration index.** The only migration this design needs is the seed in decision 2. The per-firm
journal head is idx 49 (`20260807T060000_billing-fee-models`); the calendar slice in flight holds
idx 50 and possibly more, so this one lands at **51 or later** — the index is assigned when the
migration is generated, never pinned in a design document.

## 4. Decision 2 — changing the shipped default

**Recommendation: seed a version-1 policy row per firm in the new migration. Do not change what an
absent row means, and do not touch a shipped trigger.**

The default the owner wants is `policy = 'off'`, `require_authorized_approver = 1`: an authority
holder acts alone, anyone else routes to one. A firm that wants a ceiling writes a `threshold`
version.

Two ways to get there:

1. **Re-read the absent row** — change `SHIPPED_TRUST_AUTHORIZATION_POLICY` and the
   `WHEN r.policy_id IS NULL THEN 0` branch inside mirrors 2, 3 and 4. Three shipped triggers must
   be dropped and recreated, and the NULL stamp — which is _also_ the historical record of a request
   submitted before any posture existed — silently changes meaning for those rows.
2. **Seed version 1** — one `INSERT` in the new migration. The absent-row reading stays strict and
   keeps describing exactly the history it describes today; the new default is **data**, visible in
   the firm's own policy history, with a version number and a `set_at` like any other posture.

Option 2 is purely additive, leaves all four mirrors untouched, and makes the default auditable
rather than implicit. `set_by` is NOT NULL, so the seed uses a documented platform sentinel
identifier in the same shape as the migration's existing seeded role-permission ids, and the
sentinel means "the posture the platform shipped, never a person". The seed writes no `audit_log`
row: the append-only version row **is** the record, and a change _by a member_ still writes
`trust.authorization_policy_changed` as before. The dense-version trigger accepts it (version 1 =
`MAX(version) + 1` on an empty table), and the composer's "unchanged" refusal then correctly stops a
firm re-stating the seeded posture.

_Alternative considered:_ seed at firm provisioning instead, so `set_by` is the founding owner. It
reads better but leaves any firm provisioned before that code lands with no row, and puts a
correctness-bearing write outside the lineage every firm database is defined by. Rejected.

**Safety.** No firms exist. Nothing weakens for anybody, because there is no body of stored
authorizations, no pending queue, and no firm that chose the strict posture and would be surprised
out of it. The capability the default now leans on is seeded narrowly — `trust:authorize` reaches
Owner/Admin and Attorney only, deliberately narrower than `trust:manage`.

**In-flight stamped requests — confirmed, by three mechanisms.** A pending request keeps the policy
it was submitted under: the request carries `policy_id`; `resolveTrustAuthorizationApproval` loads
that stamp through `loadTrustAuthorizationPolicy` rather than reading the current row; and mirrors
2, 3 and 4 join `trust_disbursement_request.policy_id`, never `MAX(version)`. A seeded version 1
therefore governs requests submitted **after** it exists and nothing else. At cutover the set of
in-flight requests is empty anyway, so the property is being confirmed rather than relied on — which
is the right order.

**Cost to state.** Every fresh per-firm database now starts authority-based, so tests and fixtures
that exercise two-person behaviour must write their own `always` or `threshold` version instead of
leaning on the absent row. That is a real, bounded edit across the trust and billing suites and
belongs in the build slice, not in a footnote.

## 5. Decision 3 — routing a member without authority

**`trust_disbursement_request` already carries the shape. No schema change.** It is the pending
queue, it is kind-tagged (`disbursement` / `earned_fee_application`), it is policy-stamped, pending
is derived from the absence of a decision, and billing already keeps its invoice lines beside an
application row. Both money-out paths already have a route-to-approval arm; what changes is **who
decides to take it, and when**.

- **Disbursements already route.** The request is composed first in every case; the "solo" path is
  the submitter immediately deciding their own request with basis `policy_exempt`. When the
  submitter holds no authority, `assertActorHoldsTrustAuthority` refuses that decision and the
  request simply stays pending for a holder. Structurally nothing is missing — but a refusal is the
  wrong face for an ordinary outcome. The caller should never attempt the self-decision it can know
  in advance will be refused.
- **The earned-fee path is where the refusal arm is today.** `composeTrustToOperatingTransfer`
  refuses a direct application when the stamped policy needs a second person or the actor lacks
  authority. That refusal **stays** — it is the last guard before a posting and must never become a
  route, or the composer would start writing queue rows in a batch that was meant to move money.
  The arm that changes is billing's, one level up: `packages/billing/src/apply-authorization.ts`
  chooses between `applyTrustFundsToInvoices` (direct) and `submitTrustApplicationRequest` (queue),
  and that choice must now be made from the same predicate the guard uses.

**The one addition: a shared disposition read** in `packages/trust/src/authorization-policy.ts`,
alongside the predicate it wraps —

> `resolveTrustAuthorizationDisposition(database, { amountMinor, actor })` →
> `{ mode: "solo" | "route", basis, policyId, eligibleApprovers }`

— answering, before anything is composed, whether this member may release this amount alone, on
what basis, and if not, who can. Both callers use it: the trust route to decide whether to
auto-decide a fresh disbursement request, and billing to decide direct-versus-queue. It is a read
in front of the guarantees, exactly like the holder reads that already exist, and it introduces no
fifth mirror — it _calls_ mirror 1 rather than restating it.

## 6. Decision 4 — the matrix, and why the mirrors do not explode

The matrix is the cross product of **two predicates that are already independent and already
implemented**, not four new cases:

- **P1 — authority:** the deciding member (`decided_by` / `authorized_by`) holds `trust:authorize`.
  Required whenever the stamped policy sets `require_authorized_approver`.
- **P2 — second person:** `decided_by <> requested_by`, required when the amount is above the
  stamped threshold (`off` never, `threshold` above X, `always` regardless).

Everything the owner described is P1 x P2. A non-holder cannot satisfy P1 alone, so their request
can only be settled by someone else — the routing is a _consequence_ of P1, and P2 never has to
learn who holds what.

| Amount vs threshold | Actor holds `trust:authorize` | Who acts                                                                   | Recorded basis  | What enforces it                                                                          |
| ------------------- | ----------------------------- | -------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------- |
| At or below         | yes                           | the actor, alone                                                           | `policy_exempt` | mirror 3 (the stamp exempts this amount) + the authority trigger (satisfied)              |
| At or below         | no                            | one approver, who is a holder                                              | `second_person` | the authority trigger refuses the self-decision; the approval is an ordinary two-name row |
| Above               | yes                           | the actor plus a second person, who is a holder when the flag is on (peer) | `second_person` | mirrors 2 and 4 require the second person; the authority trigger binds the decider        |
| Above               | no                            | the actor plus an approver who is a holder                                 | `second_person` | identical to the row above — enforcement never branches on the _submitter's_ authority    |

The last two rows **collapse into one enforcement path**: above the threshold the record needs two
distinct people, and P1 binds whichever of them decides. Cells 1 and 2 differ only by whether the
submitter may be their own decider, which is P1 again. Four cells, two predicates, zero new mirrors,
zero new columns.

**The lone-holder exception, in this matrix.** A firm with exactly one `trust:manage` holder: above
the threshold that holder self-decides with basis `sole_trust_manager`, and with the flag on must
also hold `trust:authorize`. Note that an ordinary second-person approval requires only
`trust:authorize` — a member holding authority but not `trust:manage` can still approve — so a firm
is never locked out; the exception is the narrow case, not the escape hatch. The asymmetry between
the two capabilities is flagged in section 8.

**The reading this design refuses.** "Above the threshold, a non-holder needs an approver _plus_ a
second" can be read as three humans: submitter, authority approver, and a further countersignature.
That is not what this recommends. The threshold exists so more than one pair of eyes sees a large
payment, and the submitter's eyes have always counted — `recorded_by` and `authorized_by` are the
two people, and the record has said so since the two-person rule shipped. A third signature is not a
harder rule expressed in the same shape; it is a **different shape**: a second decision row, the
loss of `UNIQUE(request_id)` — the index that makes two concurrent approvals produce one payment —
and a countersignature table with its own append-only discipline. If the owner meant three people,
that is a slice of its own and this design should not smuggle it in. Flagged in section 8.

## 7. Decision 5 — the audit face

**Recommendation: no new basis codes.** The vocabulary stays `second_person`, `sole_trust_manager`,
`policy_exempt`, and NULL for a rejection or withdrawal.

The basis states the **relation between the actors**; the stamped `policy_id` states the **rule**.
An examiner reading a decision joins request to policy version and sees the kind, the threshold, the
authority flag, who set it and when — every fact the composed sentence needs, each in one home.
Adding a code would duplicate the policy row into the basis column, where the two can then disagree.

If the reviewer wants the footing legible without the join, the additions would be
`authorized_solo` (the deciding member held `trust:authorize` and the stamped policy exempted the
amount) and `authorized_peer` (a second person who also held authority). The cost is concrete:
`authorization_basis` lives inside a table CHECK, so widening it is a **second full rebuild** of
`trust_disbursement_decision`, and `policy_exempt` would mean two different things either side of
that migration unless existing rows are rewritten — which append-only forbids. Not worth it while
the join is free and the tables are empty.

What does change is presentational: the decision surface and the client-ledger history render the
composed sentence — "released alone by an authorized member under the firm's authority-based
posture", "approved by a second authorized member above the firm's $X threshold" — from
`(basis, stamped policy)`. That is a UI and user-documentation obligation of the build slice, not a
schema one.

## 8. Genuinely open questions

1. **Which capability does the lone-holder exception count?** It counts `trust:manage` today, while
   the owner's model makes `trust:authorize` the operative authority. The two can diverge: a firm
   with one `trust:manage` holder and two authority holders, or the reverse. Recommendation: when
   the stamped policy sets `require_authorized_approver`, the exception should belong to the firm's
   one `trust:authorize` holder, since that is the capability the posture is about. It costs
   dropping and recreating two shipped triggers plus the mirroring composer reads — near-free today
   with no firms and no stored decisions, and materially more expensive after the first firm. Worth
   deciding **in this slice** rather than later.
2. **Two people or three, above the threshold?** Section 6 reads the owner's "approver plus second"
   as submitter plus approver — two named people, the shape already recorded. If three humans were
   meant, say so before the slice starts: it changes the decision table's cardinality.
3. **Should "solo restricted to holders" be separable from "peer approval above the threshold"?**
   One flag drives both, so a firm cannot restrict solo release to holders while letting any member
   be the second person above the threshold. Recommendation: leave it unrepresentable. A second
   person who cannot authorize is a _witness_, and the record has no column for one — inventing an
   optional flag now would encode a distinction nobody has asked for into all four mirrors.
4. **Is a platform sentinel acceptable as `set_by` on the seeded version 1?** The alternative is
   seeding at provisioning with the founding owner's identifier (section 4). This is a small
   presentational call about a row every firm will see in its posture history.

Two things do **not** need re-asking. The shipped decision's flag — "should one person be able to
dismantle the two-person control" — is answered by implication: the owner's direction is that an
authority holder acts alone on client money, and changing the posture already requires
`trust:authorize`. And matter-to-matter reallocations stay outside the policy, unchanged.

## 9. Build sequence, when it is authorized

1. **Migration** (idx assigned at generation, 51 or later): the seeded version-1 row; the two
   trigger recreates from question 1 only if the owner ratifies. Register it in
   `apps/worker/src/per-firm-migrations.ts` and the drizzle journal, and refresh the per-firm
   snapshot in the same commit.
2. **`packages/trust`:** `resolveTrustAuthorizationDisposition` beside the predicate; the composers
   and their refusals unchanged.
3. **`packages/billing`:** `apply-authorization.ts` chooses direct-versus-queue from the
   disposition rather than from a caught refusal.
4. **`apps/worker`:** the disbursement request route stops attempting a self-decision the
   disposition says will be refused, and returns who can approve instead.
5. **`apps/web`:** the posture editor names the composed postures; the queue and the ledger history
   render the composed sentence from `(basis, stamped policy)`.
6. **Tests:** the four matrix cells against both money-out paths, both mirrors of each; the lone
   holder in a one-authority firm; a fresh database proving the seeded default; the fixture and
   suite edits section 4 names.
7. **User documentation:** `docs/user/` gains the firm-administrator page for the posture and the
   member-facing explanation of why a payment is waiting for someone else.
