---
number: 256
slug: nevada-trust-jurisdiction-corpus-review-gated
status: Proposed
date: 2026-08-07
area: Trust accounting / Jurisdiction compliance
summary: "The trust-accounting jurisdiction corpus ships NEVADA FIRST and REVIEW-GATED, answering flags T7 and T8 of the trust-accounting analysis as owner-ratified. T7: one jurisdiction, researched from the state's own published rule text, with every other jurisdiction explicitly not-encoded and refusing exactly as before — no baseline profile, no fallback, no 'most states require' default. T8: attorney review is a hard shipping gate, and it is a gate rather than a flag — an encoded-but-unreviewed jurisdiction surfaces as not-verified and refuses every requirement with its own code (jurisdiction-not-verified), distinct both from the unrecorded-office refusal and from the never-researched one. Nevada ships NOT VERIFIED. The review record names who reviewed, when, and WHICH REVISION of the profile they read, so amending a value re-closes the gate rather than silently inheriting an attestation about superseded text. The research turned up three corrections to facts this repository had already written down, all traceable to the State Bar's own 2019 handbook rather than to the rules: retention is five years and not seven (the seven-year wording predates the 2021 amendment), the account-mechanics rule is SCR 78 and not the repealed SCR 78.5, and Nevada mandates no reconciliation at any cadence (the string does not occur in either rule set, and the guidance asserting a monthly duty miscites a subsection about interest remittance). The approved jurisdiction schema design's golden test for Nevada — '7 years, monthly three-way' — would have locked both errors in. The firm-funds bank-charge carve-out is encoded as a CITED RULE and deliberately NOT WIRED: NRPC 1.15(b) permits it, but states no cap, is nearly inapplicable to a pooled account under SCR 217(3), and enabling it would require changing both the no-commingling composition guard and the three-way proof — so the permission is recorded beside a platform that does not act on it."
---

**Nevada's trust-accounting rules are encoded first and alone, behind an attorney-review gate that
refuses rather than resolves until a named lawyer has signed off on the revision they read.**

**Context:** The trust subsystem's jurisdiction seam was built to refuse. It publishes the resolver
contract and a default port that declines every field for every jurisdiction, on the reasoning that a
jurisdiction fact asserts something about the world — who receives the interest, where unclaimed
funds go, whether an advance fee even belongs in trust — and a wrong silence states a wrong fact to a
lawyer who will act on it. Filling that seam is the first time the platform speaks about anybody's
legal obligations, which is why both the breadth of the first fill and the conditions on trusting it
were left to the owner.

**Decision — T7, Nevada first.** One jurisdiction, and it is the firm's own state. The alternative
considered was encoding all 56 at once from the existing narrative catalog on the reasoning that the
marginal cost of breadth is review rather than research. The research done for this decision is the
counter-argument: the catalog's Nevada entry is the one marked "HOME JURISDICTION — verified in full,
overall confidence HIGH", and reading the current rule text against it found a repealed rule number,
a superseded retention figure, and a reconciliation mandate that does not exist. If the entry
researched most carefully carries three errors, breadth would have shipped 55 more entries at lower
confidence, and the review that was supposed to catch them would have been a review of 56
jurisdictions rather than one. Every other jurisdiction stays not-encoded and refuses exactly as it
did before, with no baseline profile behind it — there is precisely one way to reach a value, which
is a jurisdiction somebody researched and a lawyer reviewed.

**Decision — T8, review is a gate and not a flag.** An encoded jurisdiction whose `attorneyReview` is
null refuses every requirement with `jurisdiction-not-verified` — a third refusal code, narrower than
"nobody researched this" and different again from "the account's office has no state recorded". Three
consequences follow from making it a gate.

*It cannot be forgotten.* A half-finished corpus cannot leak into a compliance answer by anyone
neglecting to check a boolean, because there is no code path from an unreviewed profile to a value.

*It binds to a revision.* The review records who, when, and which revision of the profile they read.
Amending a value bumps the revision and re-closes the gate. A review is an attestation about specific
text, and court rules move by court order on no fixed schedule — Nevada's own three source rules were
last amended in 2019, 2021, and 2022 respectively, none of them on a legislative calendar. Without
the revision binding, one review in 2026 would silently cover every amendment forever.

*It still shows its work.* Refusing to resolve is not refusing to display. `describeJurisdiction`
returns the whole profile with its citations and quotes, marked unverified, and never throws. A firm
told the platform knows nothing about Nevada would have no reason to get anything reviewed; a firm
shown Nevada's rules marked unverified has both the reason and the material.

**Nevada ships NOT VERIFIED.** No attorney has reviewed it. That is the honest state and it is
recorded as data rather than as a caveat in prose.

**The three corrections, and what they say about method.** All three trace to the same source — the
State Bar of Nevada's published handbook, copyright 2019, which is the first result for almost every
Nevada trust-accounting search and is authoritative-looking because it is published by the body that
disciplines Nevada lawyers. It quotes NRPC 1.15(a) as seven years (the rule now says five, amended
2021), it cites SCR 78.5 throughout (repealed 2019), and it teaches a monthly reconciliation
attributed to SCR 217(4)(a), a subsection that directs a depository institution to remit interest and
imposes no duty on the lawyer at all. This is the same failure mode the custodian research named as
the uniform-act trap, in a domestic register: a fluent secondary source restating a rule that has
moved. The method that catches it is the one this decision binds the corpus to — **every value carries
the verbatim text it was taken from**, because a value nobody can check against the rule is a value
the reviewing attorney cannot review.

**Two type distinctions the encoding keeps.** A **silence** (the rule was read and says nothing) and
an **absence of research** (nobody looked) are opposite types, and only the first can ever resolve.
Nevada's reconciliation and prohibited-methods fields are recorded silences; its processor-fees field
is unresearched and refuses. And a silence resolves **only where a silence means something**: a
restriction's recorded silence means the method is not banned, which is the whole reason to insist the
silence be recorded rather than assumed, while every data requirement is excluded on purpose — "the
rule does not say who receives the interest" is not "nobody does".

**Decision — the bank-charge carve-out is cited, not wired.** NRPC 1.15(b) permits a lawyer's own
funds in a client trust account for the sole purpose of paying that account's bank service charges,
in the amount necessary. The permission is real and is encoded with its verbatim text. It is not
acted on, and the composition guard keeps refusing every posting to a firm-funds node, for four
reasons the rule itself supplies. The rule states **no cap** — "only in an amount necessary" is a
standard applied to a known schedule of charges, not an integer a bound can hold, and choosing one
would be the platform legislating. The permission **barely applies**: SCR 217(3) exempts pooled
interest-bearing trust accounts from service charges and fees, so on the account most Nevada firms
hold there is nothing to pay, and the trust account record carries no discriminator that would tell a
pooled account from any other. Enabling it means **changing the one guard** that owns no-commingling
for the whole platform and that billing and the payments rail inherit by calling. And the **three-way
proof would stop tying out** — the client side is the sum of the matter leaves, so a non-zero
firm-funds balance would surface as a book-to-client disagreement, which is the signal reserved for
something having reached the ledger without passing the guard. Nevada also does not require the
record such a leaf would produce; unlike some states it never asks the lawyer to identify which funds
in the account are their own. Nevada supplies a permission and no obligation, which is the weakest
possible mandate for building the structure.

**Considered & rejected:** **Encode all 56 from the existing catalog** — the marginal cost really is
review rather than research, and the review is exactly what would have been overwhelmed; the
best-researched entry in that catalog turned out to carry three errors. **Ship a baseline profile
with per-jurisdiction overrides** — it converts every unresearched field into a confident answer, and
half the discovered gaps in this subject are facts about the world rather than degrees of strictness.
**Make review a boolean flag consulted by callers** — a control that lives in the caller protects
only that caller, and this one has to hold for every surface that will ever ask. **Record review
without binding it to a revision** — one attestation would then cover text nobody reviewed, which is
the specific failure the amendment history of these rules makes likely rather than hypothetical.
**Encode the State Bar handbook's monthly three-way reconciliation** — it is good practice and it is
not Nevada law, and the citation offered for it does not support it; a firm shown it as a requirement
would have no way to discover that. **Encode the handbook's advice against automated-teller access as
a prohibited method** — the restriction bucket is where a wrong value refuses a lawyer something the
rules permit, in the platform's own voice; it is carried as prose that a firm may opt into instead.
**Wire the firm-funds leaf because the rule permits it** — permission is not specification, and every
number the wiring needs would have had to be invented.

**Consequences:** Nothing behaves differently today: Nevada refuses, every other jurisdiction refuses,
and the trust domain's existing refusal paths are unchanged. What exists now is the material for a
review, and a gate that makes the review load-bearing. Binding the port is safe by construction —
for every jurisdiction and every requirement it refuses wherever the refusing default refused, which
is asserted rather than assumed. The retention value carries **two clocks** (five years from
termination of the representation under NRPC 1.15(a); at least five years from final disposition of
the underlying matter under SCR 78(1)(b)) because the two rules count from different events, and a
single number without its trigger would be a fabrication of precision. Two type-fit problems in the
approved schema design are recorded rather than worked around: its `UnclaimedFunds` cannot express
that Nevada's remittance is permitted rather than required, or that its five years run from receipt of
the property rather than from a dormancy determination; and its `Reconciliation` requires a cadence a
jurisdiction mandating nothing does not have. And the existing narrative catalog's other 55 entries
should now be treated as research leads rather than findings.
