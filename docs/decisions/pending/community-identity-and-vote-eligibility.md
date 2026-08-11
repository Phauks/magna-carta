---
slug: community-identity-and-vote-eligibility
status: Proposed
area: Community / Identity
date: 2026-08-11
summary: "Community identity reuses Better Auth on the control plane as a `community_profile` keyed to the account, never a second account system, and the three claimants get three different answers: firm staff participate fully (including paralegals, who feel a workflow's cost most sharply), a firm's CLIENT is excluded STRUCTURALLY rather than by a permission check because a client appearing in any cross-firm list discloses the firm-client relationship — the confidentiality failure this design exists to prevent, caused by us rather than by a lawyer — and a prospect reads only, with the self-serve free tier as the door. Requiring a PROVISIONED FIRM to write is the anti-astroturf control and is stronger than real names, which do not stop a competitor's employee signing up under their own. `firmId` is captured on every vote and post at write time and the board RANKS BY DISTINCT FIRMS rather than by votes, so a hundred ballots from one firm rank exactly as high as one; both numbers display, with distinct-firm counts floored at five. Revenue-weighted voting is rejected — a bigger cheque buying more influence is per-seat cost-scaling in a different coat on a platform whose reason to exist is escaping it — but the seam is free because `firmId` is exactly what a later weighting would need. If a forum is ever built, identity is VERIFIED-PSEUDONYMOUS with no firm displayed and no per-post choice."
---

**Community identity reuses Better Auth, portal principals are excluded structurally, writing requires
a provisioned firm, and the board ranks by distinct firms.**

**Context:** ADR-0044 settled that the board reuses Better Auth with a display-name-only public
identity. It did not settle **who qualifies**, and three different people have three different claims:
a lawyer at a firm, a client of a firm, and a prospect evaluating the product. Nor did it settle how
one firm does not get a hundred ballots, which is the question that decides whether a vote count means
anything at all.

**Decision:**

1. **One identity system, not two.** A `community_profile` row on the control plane keyed to the
   Better Auth account. Never a separate community account system. **Display name lives on the profile,
   never in the account's own name column**, so the public handle and the real name are structurally
   different fields rather than the same field rendered differently.

2. **Firm staff participate fully** — lawyers, paralegals, administrators. The vote is deliberately not
   restricted to lawyers: a paralegal feels a workflow's cost more sharply than the partner does, and
   restricting the vote to the people who feel it least is the wrong instrument for the astroturf
   problem, which item 4 solves properly.

3. **A firm's client is excluded structurally, not by a permission check.** Portal external principals
   authenticate on a different host with a different principal type. **Never build "any authenticated
   principal may participate."** A permission check is one refactor away from being wrong, and the
   failure is not recoverable: a firm's client appearing in any cross-firm list is a disclosure of the
   firm-client relationship — the exact confidentiality failure this whole design exists to prevent,
   and caused by us rather than by a lawyer. The two surfaces already differ today, so the exclusion is
   free now and expensive to impose later.

4. **A prospect reads the public changelog and nothing else. No third account type.** If prospect input
   is wanted, the self-serve free tier is the door — and **requiring a provisioned firm to write is the
   anti-astroturf control.** It is stronger than real names, which do not stop a competitor's employee
   signing up under their own name, and stronger than any CAPTCHA, because it demands email
   verification, Turnstile, and completion of the registration flow before a single post is possible.

5. **`firmId` is captured on every vote and every post at write time, and the board ranks by distinct
   firms.** Display both — "42 votes from 17 firms" — but order by the firm count. A hundred votes from
   one firm rank exactly as high as one. This is better than one-firm-one-ballot, which disenfranchises
   the people who actually do the work, and better than raw counts, which the largest firm dominates.
   **The column is unreconstructable later** — firm membership changes, so it cannot be derived from
   the account after the fact — which makes it a decide-now item even though the board is built later.

6. **Distinct-firm counts display only at five or more; below that, the vote count alone.** "Two firms
   want this" beside a post body written by a nameable person is a small correlation surface and it is
   cheap to never create.

7. **Revenue-weighted or plan-weighted voting is rejected for v1, and the seam is kept for free.** The
   B2B practice literature recommends it and it is defensible in general, but on a platform whose stated
   reason to exist is escaping per-seat cost-scaling, a board where a bigger cheque buys more influence
   is that same thing in a different coat. `firmId` on the vote row is precisely what a later weighting
   would need, so both the rejection and its reversal are free.

8. **If a forum is ever built, identity is verified-pseudonymous:** a public handle backed by a verified
   account the platform holds and moderators can resolve, a coarse verified badge, **the firm never
   shown**, and **no per-post choice**. Real names kill the question set that motivates a forum, make
   every post a marketing act, and sit closest to the ABA Formal Opinion 511R hazard because firm
   attribution is the inference path. Free anonymity gives an unbounded account supply, no
   accountability, and content that is worth nothing because it comes from nobody. A per-post choice is
   worst of all: once disclosure is optional, non-disclosure becomes a signal and the pressure the
   design exists to remove comes straight back. The accepted cost is that the platform holds the
   real-identity mapping, making it a subpoena and breach target — mitigated by the mapping being the
   ordinary account record already held rather than a new secret, and by publishing the disclosure
   policy in the terms. **Badge granularity is left open for the owner:** a badge specific enough to be
   useful ("verified trusts and estates attorney, Nevada") can reconstruct enough of the identity to
   defeat the pseudonym.

**Considered & rejected:** **A separate community account system** (a second identity to secure, reset,
and reconcile, for no gain); **allowing any authenticated principal** (discloses firm-client
relationships, and the failure is ours rather than the lawyer's); **a prospect account type** (a third
identity class, and the free tier already serves the purpose while doubling as the spam control);
**one firm, one ballot** (disenfranchises the paralegal who feels the cost most; distinct-firm ranking
gets the same anti-stuffing property without it); **restricting the vote to lawyers** (same objection,
and it aims a blunt instrument at the wrong problem); **revenue-weighted voting** (rejected above, seam
kept); **real-name-and-firm forum identity** and **free anonymity** and **per-post identity choice**
(each rejected above); **exposing the voter list** (aggregate counts only was already ADR-0044's rule
and remains so — `firmId` is never rendered, only counted). Extends **ADR-0044** (identity model —
display-name-only is unchanged; this adds eligibility, the firm dimension and the ranking rule); reuses
the self-serve provisioning and free-tier work of 2026-08-10 as the eligibility gate, and the distinct
external-principal auth surface of the client portal as the structural exclusion. Spec:
[`docs/specs/2026-08-11-community-surfaces-design.md`](../../specs/2026-08-11-community-surfaces-design.md).
