---
number: 275
slug: community-identity-and-vote-eligibility
status: Proposed
date: 2026-08-11
area: Community / Identity
summary: "Community identity reuses Better Auth as a `community_profile` keyed to the account, and the model is REAL DISPLAY NAME BY DEFAULT with an account-level pseudonym permitted, the FIRM NEVER DISPLAYED, and a verified badge for staff — a move from the first draft's forced pseudonymity, caused by scoping the board to product usage and by the observation that ClickUp itself shows real full names and NO company affiliation. Firm was always the sharper edge than name: firm plus practice area plus question is the inference path. Account-level choice does not carry the per-post choice's defect, where non-disclosure becomes a signal. The VOTER LIST IS NEVER RENDERED — ClickUp publishes theirs and it is findable by web search, which is the demonstration of the harm, not a hypothetical. Eligibility: firm staff participate fully including paralegals, a firm's CLIENT is excluded STRUCTURALLY rather than by a permission check because a client in a cross-firm list discloses the firm-client relationship, and a prospect reads only. Requiring a PROVISIONED FIRM to write is the anti-astroturf control and beats real names, which do not stop a competitor's employee using their own. `firmId` on every vote, ranked by DISTINCT FIRMS with a display floor of five. The identity model DEPENDS on the absence of a general category and that dependency is written down rather than remembered."
---

**Real names by default with the firm never shown, an account-level pseudonym permitted, and the voter
list never rendered.**

**Context:** ADR-0044 settled that the board reuses Better Auth with a display-name-only public
identity. It did not settle who qualifies, nor how one firm avoids casting a hundred ballots. A first
draft of this design recommended **forced verified-pseudonymity**. Two things moved it: the board is now
scoped to product usage with no general category, and the reference product the owner named uses real
full names with no company affiliation shown.

**Decision:**

1. **One identity system.** A `community_profile` row on the control plane keyed to the Better Auth
   account; never a second account system. **Display name lives on the profile, never in the account's
   own name column**, so the public handle and the real name are structurally different fields.

2. **Real display name by default, suggested at profile creation — as ClickUp does.** With the subject
   scoped to the software, no general category, and no firm shown, a real name attached to "how do I
   bulk-edit custom fields" discloses nothing. A real name also supplies the credibility that makes an
   answer worth reading, which anonymity destroys.

3. **An account-level pseudonym is permitted as a setting.** This is not the per-post choice the first
   draft rejected, and the distinction holds: a persistent handle raises no "why did they hide *this*
   one" signal, because there is no per-post decision for a reader to interpret. Per-post choice stays
   rejected.

4. **The firm is never displayed.** Not by default, not opt-in. **Firm was always the sharper edge than
   name** — firm plus practice area plus question is the inference path, and name alone is not. ClickUp
   shows no company affiliation either, which is the tell that the reference product already made the
   choice that matters. The firm is held on the record for ranking and moderation and rendered never.

5. **A verified badge for staff, and later for ambassadors.** ClickUp badges staff and runs a separate
   verified-badge programme. **Granularity is left open for the owner:** a badge specific enough to be
   useful ("verified trusts and estates attorney, Nevada") can reconstruct the identity a pseudonym
   exists to hide.

6. **The voter list is never rendered. Aggregate counts only.** ClickUp publishes theirs — a post's
   voters page lists real names with "243 more" — **and it is findable by web search**, which is the
   mechanism of harm stated concretely rather than hypothetically. A lawyer's name in a public voter
   list beside a request about disputed-fee trust reversals would be held by a search engine
   permanently. This is the sharpest deliberate departure from the reference product in the design.

7. **This identity model depends on the absence of a general category, and the dependency is recorded
   rather than remembered.** If a "General" or practice-advice category is ever added, real names become
   the wrong default again. The category taxonomy and the identity model are one decision wearing two
   hats.

8. **Firm staff participate fully** — lawyers, paralegals, administrators. Deliberately not restricted to
   lawyers: a paralegal feels a workflow's cost more sharply than the partner does, and restricting the
   vote to the people who feel it least is the wrong instrument for the astroturf problem, which item 10
   solves properly.

9. **A firm's client is excluded structurally, not by a permission check.** Portal external principals
   authenticate on a different host with a different principal type. **Never build "any authenticated
   principal may participate."** A permission check is one refactor from being wrong and the failure is
   unrecoverable: a firm's client appearing in any cross-firm list discloses the firm-client
   relationship — the exact failure this design exists to prevent, caused by us rather than by a lawyer.

10. **A prospect reads and does not write. No third account type.** The self-serve free tier is the door,
    and **requiring a provisioned firm to write is the anti-astroturf control** — stronger than real
    names, which do not stop a competitor's employee signing up under their own, and stronger than any
    CAPTCHA, because it demands email verification, Turnstile and a completed registration before one
    post is possible.

11. **`firmId` on every vote and post at write time; rank by distinct firms.** Display both — "42 votes
    from 17 firms" — and order by the firm count, so a hundred votes from one firm rank exactly as high
    as one. **Unreconstructable later**, since firm membership changes. Distinct-firm counts render only
    at five or more; below that the vote count alone, because "two firms want this" beside a nameable
    author is a small correlation surface that is cheap to never create. **Default sort is trending over
    a trailing window** — ClickUp offers Trending, Top and New, and vote velocity is more manipulation-
    resistant than a lifetime total.

12. **Revenue- or plan-weighted voting rejected for v1, seam kept free.** The B2B literature recommends
    it, but on a platform whose reason to exist is escaping per-seat cost-scaling, a bigger cheque buying
    more influence is that same thing in a different coat. `firmId` is exactly what a later weighting
    would need, so both the rejection and its reversal cost nothing.

**Considered & rejected:** **Forced pseudonymity** (the first draft's position — withdrawn: the
product-usage scoping and the hidden firm remove the harm it protected against, at the cost of the
credibility that makes an answer worth reading); **per-post identity choice** (non-disclosure becomes a
signal); **displaying the firm, even opt-in** (the inference path, and ClickUp shows no company either);
**publishing the voter list as ClickUp does** (findable by search, permanently); **a separate community
account system** (a second identity to secure and reconcile, for no gain); **allowing any authenticated
principal** (discloses firm-client relationships, and the failure is ours); **a prospect account type**
(the free tier already serves it while doubling as the spam control); **one firm, one ballot**
(disenfranchises the paralegal who feels the cost most); **restricting the vote to lawyers** (same
objection, blunt instrument, wrong problem); **revenue-weighted voting** (rejected above, seam kept).
Extends **ADR-0044** (display-name-only identity — this supersedes its forced-handle reading and adds
eligibility, the firm dimension, the ranking rule and the voter-list prohibition); reuses the self-serve
provisioning and free tier of 2026-08-10 as the eligibility gate, and the client portal's distinct
external-principal auth surface as the structural exclusion. Spec:
[`docs/specs/2026-08-11-community-surfaces-design.md`](../specs/2026-08-11-community-surfaces-design.md).
