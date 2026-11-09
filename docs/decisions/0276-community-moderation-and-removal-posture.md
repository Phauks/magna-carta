---
number: 276
slug: community-moderation-and-removal-posture
status: Proposed
date: 2026-08-11
area: Community / Moderation
summary: "Two failures, two postures. SPAM AND ABUSE DEGRADE — a read-only kill switch in KV, one operator write and no deploy, built with the FIRST write endpoint because it is twenty lines then and a retrofit across every route later, under pressure; plus provisioned-firm writes, first-post pre-moderation, Turnstile, rate limits, and an N-distinct-firm report threshold. CONFIDENTIALITY REMOVES FIRST AND ASKS LATER, which is a deliberate inversion of normal moderation because the asymmetry is extreme: a false positive costs a lawyer an eight-hour wait for a template question, a false negative is a permanent disclosure of a client relationship. Four detectors in descending order of real work done: the AUTHOR, whose self-service delete is one click and one write with no queue and no operator; ANY READER, where a SINGLE confidentiality flag hides the post pending review rather than the distinct-firm threshold that is right for spam and wrong here; a FORMAT-ONLY detector on every post that never consults firm data, because checking a post against the poster's own Directory would cross the boundary the package fitness function exists to hold; and the moderator at 9am. So the honest answer to `what happens at 3am` is that the post is ALREADY HIDDEN. Attachments are off at launch because a screenshot of legal software carries a client name, matter number and balance and defeats every text-based control at once. The 511R notice is KEPT and REWORDED for a product-usage context: the operational rule leads, the citation stays as one line."
---

**Spam degrades; confidentiality removes first and asks later — and the 3am answer is that the post is
already hidden.**

**Context:** ADR-0044 recorded honestly that running a public board is a permanent moderation, spam and
security commitment, and left it there. There is no community team and there will not be one. Since the
board is now scoped to product usage and is publicly readable, the confidentiality question sharpens
into one concrete scenario: **a lawyer posts a real matter anyway.** That needs a mechanism, not an
acknowledgement, and it needs a different mechanism from the one that handles spam.

**Decision — spam and abuse degrade:**

1. **Writing requires a provisioned firm.** Email verification, Turnstile and a completed registration
   before one post is possible. The highest-value control in the list and already built.
2. **First-post pre-moderation.** A profile's first post and first comment are held until approved;
   after one approval the account posts freely. Nothing from a brand-new account is publicly visible
   before a human has seen it.
3. **Turnstile plus per-account and per-firm rate limits** on every write path.
4. **A read-only kill switch in KV** — one operator write, no deploy, every write endpoint returns a
   stated refusal. **Built with the first write endpoint:** twenty lines then, a pass across every route
   later, under pressure, during the incident that needed it.
5. **Spam and abuse reports need N reports from N distinct firms** to hide a post, bounding report abuse
   with the `firmId` the ranking already carries.

**Decision — confidentiality removes first and asks later:**

6. **The posture inverts, deliberately.** Ordinary moderation queues then reviews. Here the asymmetry is
   extreme: a **false positive** costs a lawyer an eight-hour wait for a template question; a **false
   negative** is a permanent disclosure of a client relationship. So a post suspected of carrying client
   detail is **hidden immediately, before review**, and restored if the review clears it.

7. **The author is the primary detector, and self-service delete is one click, instant, complete — no
   operator, no queue, the body gone in one write.** They are the fastest and most frequent detector,
   usually within minutes. Everything else catches what they miss. This is why removal was designed as
   one write rather than a distributed erasure.

8. **A single confidentiality flag from any authenticated reader hides the post pending review** — not
   the distinct-firm threshold, which is right for spam and wrong here. Abuse is bounded because a
   cleared post returns and repeat false flagging is visible on the account.

9. **A conservative format-only detector runs on every post, not just first posts** — strings shaped like
   matter or docket numbers, captions containing " v. ", currency figures adjacent to proper nouns, email
   addresses, phone numbers. **It never consults firm data:** the package may not bind a per-firm
   database, and checking a post against the poster's own Directory would cross precisely the boundary
   the fitness function exists to hold. Format-only means more false positives, which the remove-first
   posture makes affordable.

10. **The moderator decides at 9am** — restore, redact, or remove permanently. **So the honest answer to
    "what does the platform do at 3am" is that the post is already hidden**, by its author, by a reader,
    or by the detector. That is a mechanism rather than a staffing promise.

**Decision — the rules that make removal real:**

11. **A post body has exactly one home.** No second full-text index of member content, no search-service
    copy, no analytics copy of the body. Removal must be one write; a distributed erasure half-fails and
    nobody notices.
12. **Notification emails link, never quote.** A quoted body sits in inboxes forever and no removal path
    reaches it. Free as a rule, impossible to retrofit — you cannot unsend.
13. **`noindex` on the whole board, permanently.** Reversible in one direction only.
14. **Edit history is never public.** A lawyer who realises a post is over-identifying and edits it must
    not leave the original visible; an internal audit row is kept for moderation with short retention.
15. **No image or file attachments at launch.** Rich text and code or formula snippets, yes. **A
    screenshot of our product carries a client name, a matter number, a ledger balance and often the
    opposing party, and an image defeats every text-based control at once** — this is where legal
    software is genuinely worse than the reference product, whose board and changelog lean heavily on
    images. The cost is real and taken knowingly: "here is a screenshot" is the most natural way to ask a
    software question. **A "send this to support instead" control on the composer absorbs the demand**,
    and support is confidential because the platform is already the firm's data processor. Revisit when
    there is moderation capacity and a measured need.

**Decision — the notice, kept and reworded:**

16. **Shown on first post only, dismissible forever.** A modal on every post is patronising, blind within
    a week, and legally worthless.
17. **The operational rule leads and the citation follows.** In a product-usage context "do not post about
    a representation" is the wrong frame — abstract, a judgement call, and about a duty the reader already
    has. The notice instead says: this board is about the software; do not include client names, matter
    numbers, ledger balances, party names, or screenshots of your own data; a question that needs those
    belongs in support, where it stays confidential — followed by one cited line noting that **ABA Formal
    Opinion 511R** holds a post can breach confidentiality even in hypothetical form where a reader could
    infer the client or the situation. The citation stays because the thing practitioners do not know is
    not "be careful"; it is that a hypothetical counts.
18. **A permanent one-line statement beside the composer** giving the venue's facts — publicly readable,
    not indexed, removable instantly by you — and the "send to support" control in the same gesture,
    because a notice that tells an author their question is in the wrong place must offer the right one.

**Considered & rejected:** **Queue-then-review for confidentiality** (the asymmetry forbids it — the
false negative is permanent); **an N-distinct-firm threshold for confidentiality flags** (right for spam,
wrong here; one flag hides); **consulting firm Directory data to detect client names** (crosses the
per-firm boundary the package fitness function holds — format-only, and accept the false positives);
**allowing attachments at launch** (rejected above, cost stated, and it is the recommendation here most
likely to be wrong in practice); **routing uploaded images through the existing scrub and metadata
machinery** (a heavy build for a v1 board with no traffic; revisit); **treating moderation as a staffing
question** (there is no team, so the answer must be mechanical); **pre-moderating every post** (makes the
board feel dead and the owner the bottleneck on every reply); **post-moderation with no first-post hold**
(leaves the entire 3am exposure); **a third-party moderation service** (member content leaves the
boundary and our one-click delete); **a confidentiality modal on every post** (rejected above);
**dropping the 511R citation for the product-usage framing** (the bivalent question means the duty has
not gone away, and the citation is what makes the operational rule authoritative to this audience);
**public edit history for transparency** (transparency about an edit is exactly what the edit was made to
prevent). Extends **ADR-0044** (which named the moderation commitment without a mechanism); reuses
Turnstile and the self-serve registration flow of 2026-08-10 as the write gate, and the control-plane KV
pattern the shipped service-status work established for operator-authored, deploy-free state. Spec:
[`docs/specs/2026-08-11-community-surfaces-design.md`](../specs/2026-08-11-community-surfaces-design.md).
