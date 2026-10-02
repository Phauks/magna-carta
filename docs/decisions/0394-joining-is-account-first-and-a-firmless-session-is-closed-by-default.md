---
number: 394
slug: joining-is-account-first-and-a-firmless-session-is-closed-by-default
status: Proposed
date: 2026-08-29
area: Authentication and access control
summary: "Registration creates a person and nothing else; which firm they belong to is settled afterwards, signed in, on a dedicated screen. A session carrying no firm is admitted by three routes and answered with the reserved 404 everywhere else."
---

Joining the platform is two acts — becoming a person, and becoming a member of a firm — and the role
fork at `/register` performed the second before the first. It asked a visitor to classify themselves
(a client of a firm, somebody who works at one, somebody founding one) before any account existed,
which is a question about a relationship put to somebody who is not yet a party to one. Two of the
three answers led to the same place, because membership of an existing firm is that firm's decision.

**The decision.** `/register` registers a person: a name, an address, two acknowledgements, one
confirmation mail. Spending the confirmation token creates the account — a `user` row with no firm —
and sends the link that sets its password. A dedicated in-app screen then settles what the account
is: found a firm, or redeem an invitation into one.

**The orphan account is represented, not worked around.** `user.firm_id` becomes nullable (a reviewed
control-plane table rebuild), which is what makes the state fail closed rather than open: a surface
that forgets to consider it resolves NO firm and answers the reserved cross-firm 404, instead of
resolving somebody else's firm. `RouteMeta` gains `firmlessSession`, defaulting to `reject`; the
bootstrap declares `allow`, and the two onboarding mutations declare `only` — unreachable for anybody
who already holds a firm, which is what lets them carry `permission: null` honestly, since a
principal with no firm holds no capability in any firm to name.

**`disableSignUp` stays true, and this is a restructuring rather than a public signup endpoint.** The
account is created by our own confirmation handler, exactly as invitation redemption already creates
one; Better Auth's signup route remains refused. The registration endpoint is unchanged in every
respect an attacker sees — same chokepoint, same tightest rate-limit bucket, same dormant human
verification, same identical answer for a taken address and a free one. Only what a *confirmed* token
buys moves, and it moves toward safety: it used to buy a firm, a bucket, a minted key and a second
mail, and now buys one row and one mail, with firm provisioning moved behind an authenticated act by
a proven mailbox.

**An invitation redeemed into an existing account must name that account's own address.** In the
anonymous flow the proof that a redeemer holds the invited mailbox is that the password link is sent
to it. The signed-in path sends no mail, so without the address check somebody holding a code, a
surname and a date of birth could attach their own account, with their own credential, to another
firm. The check restores exactly what the mail was proving, and its failure is the same single
neutral refusal as every other unsuccessful combination.

Design: [`../specs/2026-08-29-account-first-joining-design.md`](../specs/2026-08-29-account-first-joining-design.md).
Reconciled with `ADR-0280` (joining the platform) and the unified-identity design, whose
firm-tenancy-conditional-on-principal argument this generalizes.
