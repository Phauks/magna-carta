---
category: Added
---

Billing — taking earned fees out of trust. The transfer that moves a client's money to the firm has
been refused by the platform since trust accounting shipped, on the stated grounds that what evidence
permits money to leave trust had not been settled. It is settled now, and this is the answer: **a
finalized bill, with enough still owing on the specific matter the money sits against.**

**Money leaves trust only against a bill the client has actually been charged, and there is no
override.** A bill that is still a draft is refused. A bill for a different client is refused. A bill
that does not charge the matter whose ledger the money is in is refused. An amount above what that
matter still owes on that bill is refused. Each refusal says which of those it was, so a member can
act on it rather than guess. This is the operation where real-world trust violations happen, and the
friction is deliberate: the honest cost is that a firm billing out of band — in a spreadsheet, or
through an insurer's portal — has to finalize the bill here before it can take its own fees, and
finalizing one here is cheap and does not require the platform to have produced it.

**The guarantee is structural, not a check that ran first.** Every condition above is read before the
money moves so the refusal reads as a sentence, but what actually holds the line is the ceiling on
what each matter owes, enforced by the database in the same all-or-nothing write as the money
movement. If a payment or another transfer consumes the balance in the instant between looking and
acting, the entire thing is abandoned — the money never leaves the client's ledger, no record of a
transfer is written, and nothing is half-done. Both halves are needed: one produces an answer a
person can use, the other is what makes it true.

**Applying part of a bill is ordinary.** A retainer replenishment that covers two thousand of a
six-and-a-half-thousand bill applies two thousand and leaves the rest owing, exactly, to the penny;
the next replenishment applies more. Nothing about the bill itself changes — it was evidence the
moment it was finalized, and what has been paid against it is a separate, permanent record of its
own. One transfer can settle several of the same client's bills at once.

**Trust's own rules still decide what trust permits.** Money under a disputed-funds hold cannot be
taken even when the balance looks sufficient; a closed account, an office with no recorded
jurisdiction, and a matter holding no client ledger each refuse in trust's own words. None of those
rules were restated, relaxed, or routed around to make this work — no trust code changed at all,
which is the test that the boundary was drawn in the right place.

Correcting a bill after fees have already been taken out of trust is deliberately **not** built yet.
When a firm concedes it did not earn part of what it has already moved, the money is sitting in the
firm's own account and giving it back is a decision about firm funds — a refund, a return to the
client's trust ledger, or a credit against a later bill — with real differences between them. The
platform will record that obligation and let the firm choose; it will not choose on its own, and it
will not pretend the trust ledger can be rewound.
