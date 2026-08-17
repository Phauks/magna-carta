---
number: 323
slug: an-unreviewed-court-form-cannot-be-adopted
status: Proposed
date: 2026-08-14
area: Document automation
summary: "A shipped court form whose `attorneyReview` is null cannot be adopted at all — the route refuses `court-form-not-reviewed`, and the whole Nevada starter set ships NOT REVIEWED, exactly as the Nevada trust profile does. Review is per form rather than per library, because forms are revised one at a time by different authorities and a library-wide review would be invalidated by any single amendment; and a review binds a content-derived revision, so amending an entry re-closes the gate. An unreviewed form is LISTED with its state rather than hidden, because 'do you have a Nevada notice to creditors' should be answered 'yes, awaiting review' rather than 'no'. Staleness is our obligation expressed as a check that fails: no Nevada source emits a machine-readable currency signal, so each entry declares a re-verification interval and a CI fitness function fails when one is past due. `Provenance`, `SourceTier` and `AttorneyReview` move to a shared `@magna-carta/legal-provenance` package rather than being written a second time."
---

**A shipped court form nobody has reviewed does not look the same as one that has been: it cannot be adopted at all.**

**Context:** `@magna-carta/trust-jurisdictions` already answered a very close question — how a platform ships compiled legal reference data without making a claim nobody checked — and its answer is the strongest posture in this codebase: a profile whose `attorneyReview` is null refuses every requirement, Nevada ships NOT REVIEWED, and filling that field in "is an attestation by a named person on a stated date, not a flag". A form library inherits that or it invents a weaker second answer to the same question.

The form domain differs from the jurisdiction domain in two ways that matter, and is identical in every other way.

**Decision:**

(1) **`attorneyReview: null` means unadoptable.** The adopt route refuses with `court-form-not-reviewed`. The whole Nevada starter set ships that way, so the library is inert on release and becomes live one form at a time. This is a stronger statement than a badge: a form nobody has reviewed is not something a firm can accidentally file from.

(2) **Review is per form, not per library.** A jurisdiction profile is reviewed whole because its values are one body of rules read together. Forms are promulgated and revised independently, by different authorities, on no shared calendar — a library-wide attestation would be invalidated by any single amendment and would put a reviewer in front of everything again to release one correction.

(3) **A review binds a content-derived revision, and amending an entry re-closes the gate.** The trust package's mechanism verbatim, for its reason verbatim: a review of superseded text is not a review, and deriving the revision from the entry's own content means an amendment that forgets to bump the date still closes the gate rather than silently inheriting an attestation.

(4) **An unreviewed form is listed, with its state.** Not hidden, not greyed out and unexplained. Hiding it answers "do you have a Nevada notice to creditors?" with "no" when the true answer is "yes, awaiting review", and the count of what is awaiting review is precisely the thing that should be visible to the person who can clear it.

(5) **Staleness is a build-time obligation on us, expressed as a check that fails.** No Nevada source emits a machine-readable currency signal, and the ones that move do so by court order on no calendar — so a shipped form goes stale silently by default. Each entry declares `lastVerifiedOn` and `reverifyWithinDays`, and `lint:court-form-staleness` fails when one is past due, in the shape `lint:ledger-staleness` already has. That is separate from review currency, which is a runtime gate: the two are distinguished because different people fix them. Neither reaches a firm that already adopted a form — their template is theirs — which is what the supersession notice is for.

(6) **The provenance vocabulary is lifted, not written twice.** `Provenance`, `SourceTier` and `AttorneyReview` move into a small shared `@magna-carta/legal-provenance` package that `trust-jurisdictions` imports and re-exports, with `profileRevision` renamed `reviewedRevision` because what is reviewed is a jurisdiction profile in one package and a form entry in the other. Two copies of a citation-and-attestation shape is exactly the drift the merge-field catalog contract's projection test exists to prevent, one domain over. `FieldConfidence` is deliberately **not** lifted: its four members answer "how much is known about this rule", and a form's uncertainty is about its basis instead.

(7) **A value without a verbatim quote is not shippable**, and an entry declares its `basis` as a discriminated union — statutory text, court rule, court publication, or firm-drafted — so an unsupportable claim is unrepresentable rather than merely discouraged. The reviewing attorney is checking the quote against the authority; a form whose prescribed text cannot be quoted is a form they cannot review.

**Considered and rejected.** *A warning banner instead of a refusal* — a badge on an adoptable form is a badge somebody clicks past on a filing deadline, and it makes an unreviewed form look like a reviewed one at the moment it matters. *One review covering the library* — one amendment invalidates everything. *Trusting a hand-set revision date* — the trust package already learned that an editor forgets, which is why the revision is content-derived. *Restating `Provenance` in the new package* — a second citation vocabulary free to disagree with the first. *Hiding unreviewed entries* — turns a tractable backlog into an invisible one.

**Consequences:** The Nevada library ships inert and stays inert until a named Nevada-licensed attorney attests to each entry, which is the correct cost and is visible as a count rather than as an absence. CI fails when the library goes stale, so re-verification is scheduled work rather than a note in a document. There is exactly one `Provenance` type in the repository. Whether a firm must additionally acknowledge a form before first use remains an owner decision.
