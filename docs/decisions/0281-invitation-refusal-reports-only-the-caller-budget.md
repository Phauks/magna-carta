---
number: 281
slug: invitation-refusal-reports-only-the-caller-budget
status: Proposed
date: 2026-08-12
area: Authentication
summary: "A neutral refusal may carry facts about the caller or constants, and nothing read from the row it looked up. Invitation redemption published the invitation row's remaining attempts, and because the row is found by the code alone that number answered 'does this code exist' to anyone submitting a guessed code with invented facts — the combined three-fact digest guards the verifier comparison, not the lookup. The budget is now read from a caller-keyed attempt ladder of the same kind the credential surfaces use, the lockout countdown likewise, and the refusal is built at exactly one call site so nothing row-derived can re-enter it. The invitation's own counter and lockout are kept and made silent, and the attempt-spending write now runs on every refusal path — against an id no row holds when there is nothing to spend — so the removed difference does not survive as a timing difference. The budget the caller reads is enforced (five tries per address, then a pause), because a count the server does not agree with is worse than no count."
---

**A deliberately-neutral refusal may report facts about the caller or constants only — never a value read from the row it looked up. Invitation redemption reports a caller-keyed attempt budget, and keeps the invitation's own budget silent.**

**Context:** Invitation redemption takes three facts — the code, the invitee's surname and their date of
birth — and stores one digest over all three, so the handler is structurally incapable of saying which
one was wrong. That defence guards the **comparison**. It does not guard the **lookup**: the row is
found by `code_hash` alone, because a lookup keyed on the combined digest could not find a row to spend
an attempt against when the surname or the date of birth was wrong, which is precisely the case the
per-invitation ladder exists for. The refusal then published `attemptsRemaining`, computed from that
row's `attempt_count`, under a comment asserting it was "a fact about the CALLER's own attempts and so
reveals nothing about whether any invitation was found."

The comment was false and the consequence was the exact attack the surface is built to deny. One
request carrying a guessed code and arbitrary garbage for the other two facts distinguished three
states: `4` — a live, pending, unlocked invitation with this code hash exists; `5` — no such code, or
one expired, revoked or already redeemed; `0` — a live invitation with this code, currently locked out.
The two facts the design leans on contributed nothing, since neither is consulted before the number is
computed. A secondary harm rode along: five probes against a code that turned out to be live spent that
invitation's whole budget and locked its rightful invitee out. The caller-keyed rate limit bounded how
many codes could be walked per address; it did nothing about a targeted probe of one code.

**Decision:** The invariant is stated as a rule rather than a repair: **a response on a deliberately
neutral failure path carries facts about the caller, or constants, and nothing derived from a row the
handler looked up.** Applied here:

- The published budget comes from a **caller-keyed attempt ladder** — a second instance of the same
  ladder the credential surfaces run, keyed on the edge-set client address — spent on every refusal
  including the already-registered-address collision, cleared by a redemption that works. `retryAfterSeconds` is that
  ladder's lockout, never the invitation's.
- The refusal is constructed at **exactly one call site**, which takes a caller budget and nothing else.
  A second construction site is how a neutral answer stops being neutral, and the single site is what a
  reviewer checks instead of reading every branch.
- The **invitation's own counter and lockout are kept**, and go silent. They bound depth against a code
  somebody genuinely holds, which the caller-keyed ladder cannot do across rotated addresses.
- The attempt-spending write runs on **every** refusal path. Where there is nothing to spend against, the
  same statement runs against an id no row can hold: zero rows changed, one round trip, the same cost.
- A caller whose own ladder is spent is refused **before** the lookup. That return is decided entirely by
  caller state, so it cannot vary with the row, and it stops a locked-out prober from continuing to burn
  a real invitation's attempts on the way past.
- The ladder is separate state from the credential ladder: a member mistyping a password should not
  spend a new joiner's tries, or the reverse.

**Consequence:** The response to a failed redemption is now identical for a live invitation, an expired
one, a revoked one, an already-redeemed one, a locked-out one and a code that matches nothing at all —
asserted as a table rather than as a claim, with the whole body compared and no field exempted by name,
so a field added to the refusal later is compared by default. The number on screen keeps working and
keeps being enforced, which matters because a count the server does not agree with is worse than no
count; what changes is what it counts, and the screens already described it as the caller's. The honest
costs: the caller-keyed ladder is per-isolate, so it can over-report on a fresh isolate (never
under-report), and an office behind one egress shares it — the same trade already accepted for sign-in,
and the reason the limit is a short pause rather than a long lockout. The invitation-lockout denial of
service is bounded rather than removed: five probes still lock a code, but the prober can no longer
confirm they hit anything, which is what made it worth doing.
