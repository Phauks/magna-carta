---
slug: community-surfaces-sequencing
status: Proposed
area: Community / Product updates
date: 2026-08-11
summary: "The three community surfaces ship in strict order of value against risk — public changelog first and alone, feature voting second and gated on there being enough firms for a vote to mean anything, and the forum NOT AT ALL. The forum is refused on three independently sufficient grounds: ABA Formal Opinion 511R restricts a lawyer from posting about a representation even hypothetically where a reader could infer the client or the situation, and a public indexed forum is strictly worse than the closed listservs that opinion addresses; the demand splits into product questions that a knowledge base answers better and practice questions that bar-association listservs already serve and we have no standing to host; and at one tenant an empty forum is a public page asserting nobody uses the product, which is hard to retreat from. The confidentiality-safe venue already exists and is called support — the platform is already the firm's data processor, so a lawyer can tell us what they cannot tell the internet. The dormant `discussion` seam stays dormant and the decision to wake it is re-taken against three named conditions rather than inherited."
---

**Changelog now, voting next and gated, forum not at all — and the forum decision is re-taken later
rather than merely deferred.**

**Context:** The owner asked to start work on the forums, changelog and feature-voting side of the
program, describing the surface hierarchy as login, then main application, then other (marketing,
forums). ADR-0044 (amended) already settled that the community board would be a native
`@magna-carta/community` build on Cloudflare with a dormant `discussion` seam, and ADR-0048 settled
the product-updates surface. What was never settled is the **order**, and the three surfaces have
sharply different risk: one has no user content at all, one has user content behind a session, and
one is a public page where lawyers are invited to write about their work.

**Decision:**

1. **Public changelog first, alone.** High value, low effort, near-zero risk: no writes, no accounts,
   no user-authored content, nothing to moderate, and a source that already exists. It also unblocks
   two things already built and waiting — the disabled `changelog` entry in the app's ecosystem-site
   registry, and the in-app updates route of ADR-0048, which reads the same artifact.

2. **Feature voting second, gated on firm count.** The board is worth building, but a vote count at
   one tenant is noise, and a board that opens before there is anyone to vote teaches its first
   readers that posting is pointless. Build it when there is a second cohort of firms.

3. **Do not build the forum.** Three grounds, each sufficient on its own:

   - **Confidentiality.** ABA Formal Opinion 511R (May 2024) holds that Model Rule 1.6 prohibits a
     lawyer from posting questions or comments relating to a representation to a listserv **even in
     hypothetical or abstract form** without informed consent, where a reader could **then or later**
     infer the client's identity or the situation — and that obtaining that consent requires
     explaining to the client that their identity and matter details may reach people with no duty of
     confidence who may represent adverse interests. The opinion addresses **closed,
     membership-verified** lists. A public, search-indexed, permanent forum is the same hazard with an
     unbounded and unverified audience: if the opinion restricts the closed case it forecloses the
     open one. Crucially the test is about **the client**, not the lawyer, so pseudonymity mitigates
     but does not cure, and a design that implies otherwise is worse than no protection because it
     invites the post that would not otherwise have been made.

   - **The demand is not forum-shaped.** It splits cleanly. Product questions ("how do I set up a
     Nevada trust account") are safe, have one correct answer, and belong in a knowledge base, which
     a forum answers worse — N approximate answers of varying vintage, the top one wrong after the
     next release, no owner. Practice questions ("how do I handle a client who disputes the fee") are
     exactly what 511R restricts, are already served by bar-association listservs where membership is
     verified and the audience bounded, and are not ours to host — being the software vendor in the
     room makes it worse rather than better. What remains is a thin band of product-specific,
     practice-adjacent workflow questions, served by curated question-and-answer authored from
     support volume — the same content with none of the risk, **and startable today, with the ticket
     volume itself as the measurement of whether forum demand exists at all.**

   - **Critical mass.** One tenant. An empty forum is not neutral; it is a public page asserting that
     nobody uses this product, on a domain we are trying to make credible, and closing one later is a
     visible retreat where a slowly growing knowledge base is just a knowledge base.

4. **The confidentiality-safe venue already exists and is called support.** The platform is already
   the firm's data processor and already holds the matter, the ledger and the documents — the same
   relationship that makes a public forum hazardous makes a private channel safe. The private
   diagnostics and bug-reporting pipeline is that channel, and the one-way escalation bridge from a
   private report to a public feature request (already accepted in ADR-0044) is the valve: the
   confidential half stays private and only what the lawyer chooses to publish becomes public.

5. **The `discussion` seam stays dormant and the decision is re-taken, not inherited.** Three named
   conditions must all hold before a forum is reconsidered: enough firms that a thread would have
   readers, with peer-answerable support volume as the evidence; a named human who owns moderation as
   part of their job rather than as an interruption; and demonstrated demand for product-specific,
   practice-adjacent content rather than general legal discussion.

**Considered & rejected:** **Shipping all three together** (triples the risk of the riskiest one and
couples a zero-risk surface to a permanent duty); **forum first, on the reasoning that it is the
hardest and therefore most valuable** (hardest here means highest downside, not highest reward);
**a forum restricted to product questions only** (unenforceable — the interesting question always
drifts toward the matter, and a rule that a moderator must police post-by-post is not a rule);
**deferring the forum with no conditions** (a deferral with no re-decision point becomes a commitment
by default the first time someone asks for it again). Extends **ADR-0044** (which is not superseded:
its package boundary, native-build reasoning, data model, display-name identity and escalation bridge
all stand) and **ADR-0048** (product updates, unchanged). Spec:
[`docs/specs/2026-08-11-community-surfaces-design.md`](../../specs/2026-08-11-community-surfaces-design.md).
