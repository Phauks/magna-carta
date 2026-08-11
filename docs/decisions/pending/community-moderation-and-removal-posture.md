---
slug: community-moderation-and-removal-posture
status: Proposed
area: Community / Moderation
date: 2026-08-11
summary: "The platform does not moderate at 3am — it DEGRADES, and a human deals with it at 9am. The mechanism is a read-only kill switch in KV, one operator write and no deploy, BUILT WITH THE FIRST WRITE ENDPOINT because it is twenty lines then and a retrofit across every route later, under pressure, during the incident that needed it. Around it: writing requires a provisioned firm, a profile's first post and first comment are held until approved so nothing from a brand-new account is ever publicly visible before a human sees it, Turnstile and per-account and per-firm rate limits on every write, and report-to-hide bounded by a distinct-firm threshold. The owner moderates; a design that assumes a community team is a design that fails on a Saturday, and if the standing cost exceeds minutes per week the correct response is to NARROW THE SURFACE, not to hire. Removal is the real confidentiality protection, not warnings: a post body has exactly ONE home so removal is one write, notification emails LINK AND NEVER QUOTE because a quoted body in an inbox is unrecallable, member content is `noindex` permanently from the first byte, and edit history is never public. A confidentiality modal on every post is rejected as patronising and legally worthless; one cited first-post notice naming ABA Formal Opinion 511R and stating the actual test is not."
---

**Degrade rather than moderate at 3am, and make removal real rather than warning loudly.**

**Context:** ADR-0044 recorded honestly that running a public board is a permanent moderation,
spam/abuse and security commitment regardless of who builds it, and left it there. That is the item
that decides whether any of this is sustainable, and it needs a mechanism rather than an
acknowledgement. There is no community team and there will not be one. Separately, the confidentiality
analysis for a lawyer audience turns on what happens **after** a post is made — a lawyer who realises a
post is too identifying needs it gone, completely and quickly — which makes removal a load-bearing
design property rather than an administrative feature.

**Decision — the operational half:**

1. **A read-only kill switch in KV.** One operator write, no deploy, and every community write endpoint
   returns a stated refusal. **Built with the first write endpoint, not added later:** twenty lines at
   the start, a pass across every route afterwards, done under pressure during the incident that needed
   it. This is the concrete answer to what the platform does at 3am — it goes read-only and a human
   deals with it at 9am.

2. **Writing requires a provisioned firm** (see the identity decision). The single highest-value spam
   control in the list, and it is already built.

3. **First-post pre-moderation.** A community profile's first post and first comment are held until
   approved; after one approval the account posts freely. Nothing from a brand-new account is ever
   publicly visible before a human has seen it, which removes the entire drive-by class. Cost: latency
   on genuine first posts, which is acceptable and is stated in the interface.

4. **Turnstile plus per-account and per-firm rate limits** on every write path.

5. **Report-to-hide with a distinct-firm threshold.** N reports from N distinct firms hides a post
   pending review; requiring distinct firms bounds report abuse using the same `firmId` the ranking
   already needs.

6. **The owner moderates, and this is written down rather than assumed.** Everything above exists so
   the standing cost is minutes per week rather than hours per day. **If it ever exceeds that, the
   correct response is to narrow the surface, not to hire** — and the surface is narrowable precisely
   because the board is login-gated and gated on provisioning. For a public forum the load is unbounded,
   which is an argument about shape and not about staffing.

**Decision — the removal half, which is the real confidentiality protection:**

7. **A post body has exactly one home.** No second full-text index of member content, no search-service
   copy, no analytics copy of the body. Removal must be one write; a distributed erasure across stores
   is a removal that half-fails and nobody notices.

8. **Notification emails link, never quote.** A quoted body sits in inboxes forever and no removal path
   reaches it. This costs nothing as a rule and is impossible to retrofit — you cannot unsend.

9. **`noindex` on all member-authored content, permanently, from the first byte.** The changelog and
   roadmap want indexing; member content must never have it. Reversible in one direction only: allowing
   indexing later is easy, recalling it is impossible.

10. **Author-initiated removal is a supported, fast path**, not an operator data task. Attribution can be
    dropped independently of the body ("a member"); a request that has accumulated votes keeps its votes
    and status and loses its body, so removing one author's words does not destroy the record other
    firms voted on.

11. **Edit history is never public.** A lawyer who realises a post is over-identifying and edits it must
    not leave the original visible. An internal audit row is kept for moderation with a short retention;
    no public diff, ever.

**Decision — the warning:**

12. **No confidentiality modal on every post.** It tells a lawyer their own professional obligation as
    though they might not know it, earns banner-blindness within a week, and provides no protection —
    legal, practical or reputational. It is a disclaimer wearing a design.

13. **Instead: one cited notice, one permanent factual line, and a real undo.** On the first post only,
    dismissible forever, a short notice naming **ABA Formal Opinion 511R** and stating the actual test —
    could a reader infer the client or the situation, now or later. The thing practitioners do not know
    is not "be careful"; it is that a **hypothetical** counts, which surprises most people. A citation is
    respected where a nag is resented. Beside the composer, permanently, one line giving the venue's
    facts rather than restating ethics: who can read this, whether it is indexed, how long it lasts, how
    fast it can be removed. And the removal path above, because a warning that a post is permanent is
    only honest if the post is permanent — and it should not be.

**Considered & rejected:** **Treating moderation as a staffing question** (there is no team, so the
answer must be mechanical); **post-moderation only, with no first-post hold** (leaves a window where a
brand-new account's content is publicly visible, which is the entire 3am exposure); **pre-moderating
every post** (makes the board feel dead and makes the owner the bottleneck on every reply); **a
third-party moderation service** (member content leaves the boundary and leaves our removal path, which
items 7 to 10 make non-negotiable); **relying on Turnstile alone** (bot control, not abuse control —
the provisioned-firm requirement is what actually raises the bar); **report-to-hide on raw report
count** (one motivated account hides anything; the distinct-firm threshold is the fix); **a
confidentiality modal on every post** (rejected above); **allowing indexing of member content for
acquisition value** (impossible to reverse, and the board is login-gated anyway so there is nothing to
gain); **public edit history for transparency** (transparency about an edit is precisely what the edit
was made to prevent). Extends **ADR-0044** (which named the moderation commitment without a mechanism);
reuses Turnstile and the self-serve registration flow of 2026-08-10 as the write gate, and the
control-plane KV pattern the shipped service-status work established for operator-authored,
deploy-free state. Spec:
[`docs/specs/2026-08-11-community-surfaces-design.md`](../../specs/2026-08-11-community-surfaces-design.md).
