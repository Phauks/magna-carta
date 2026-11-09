---
number: 278
slug: community-surfaces-sequencing
status: Proposed
date: 2026-08-11
area: Community / Product updates
summary: "Public changelog first and alone, then the community board — ONE board carrying two post kinds (votable requests with a status pipeline, and threaded questions with votable answers), which wakes the dormant `discussion` seam rather than replacing it. The owner directed the design at ClickUp, and studying ClickUp's live surfaces resolved the earlier recommendation against a forum rather than merely overruling it: ClickUp has NO first-party discussion forum, closed the 2023 request for one as `Not on the roadmap` in August 2025, and points users to Facebook and Reddit — so what ClickUp does under the word `forum` IS a category-structured, status-tracked, publicly readable board with long-lived comment threads. That shape sits outside ABA Formal Opinion 511R because the subject is the software rather than a representation, and the scoping is held by STRUCTURE rather than by rules: every category is a product area and there is NO general category, so a practice-advice question has nowhere to go. Three failure modes are named rather than absorbed — the bivalent question, screenshots (the serious one, because our screenshots carry client names, matter numbers and balances), and the long tail of specificity. A general discussion space is still not built, which is also what ClickUp concluded."
---

**Changelog first, then one board with two post kinds — and the reference product's own answer for
"forum" is that board, not a forum.**

**Context:** The owner asked to start work on the forums, changelog and feature-voting side of the
program, describing the hierarchy as login, then main application, then other. A first draft of this
design recommended against building a forum. The owner then directed: *"Look at what clickup does for
changelogs and forums, that is what i want."* That recommendation is withdrawn — **and the evidence
that withdrew it is ClickUp's own.**

**What ClickUp actually runs (studied 2026-08-11).** Its changelog and feedback board are both hosted
on Canny; the board is publicly readable with login required to write, carries 59-plus product
categories across several boards, and uses six statuses (Future, Planned, Building Now, Beta,
Completed, Not on the roadmap). **It has no first-party discussion forum.** `clickup.com/community`
lists a Facebook Group, r/clickup, X, LinkedIn, ClickUp University, webinars and events. Users have
asked for a forum twice: a 2018 request (48 votes) was marked **Completed** by the existence of the
Canny board, and a 2023 request asking for "an organized, searchable format with different boards" was
**closed Not on the roadmap on 29 August 2025** after a representative pointed to Facebook and Reddit
— the poster objecting that those "are more like social media walls you have to scroll through rather
than an organised searchable forum with different boards."

**Decision:**

1. **Public changelog first, alone.** No writes, no accounts, no user content, and a source that
   already exists. It unblocks the disabled `changelog` entry in the app's ecosystem-site registry and
   the in-app updates route of ADR-0048, which reads the same artifact.

2. **Then one community board carrying two post kinds**, sharing categories, identity and moderation:
   **requests** (votable, status pipeline, roadmap projection) and **questions** (threaded, with
   votable answers and an accepted-answer marker, off the roadmap). **A question that turns out to be
   a missing capability converts to a request in one operator action, carrying its thread.** ClickUp
   cannot do this because it has only one post kind — which is why its 2018 forum request was closed
   as Completed by a board that answers a different question. This wakes the dormant `discussion` seam
   the 2026-06-17 design already put in the model, exactly as that design intended.

3. **The reconciliation holds, and it holds because of scope.** ABA Formal Opinion 511R restricts a
   lawyer from posting about a **representation** — even hypothetically — where a reader could infer
   the client or the situation. A board about **the software** has no client in it. "How do I structure
   custom fields for a contingency matter" and "what is the right way to build a fee-agreement
   template" are product questions, and 511R has nothing to say about the product.

4. **Structure holds the scope; rules do not.** Every category is a product area — trust and
   reconciliation, billing, matters, templates and automation, discovery, custodian, portal,
   integrations, and so on. **There is no "General", no "Off-topic", no "Practice management", no
   "Ask a lawyer", and no jurisdiction categories.** A practice-advice question has nowhere to go, and
   the composer demands a category before accepting a post, so every author is asked which part of the
   software this is about before writing a word.

5. **Three failure modes are named rather than absorbed.** **The bivalent question** — "how do I record
   a settlement where the client disputes the fee" is a product question or practice advice depending
   on whether the facts come with it. **Screenshots**, which is the serious one and where legal software
   is genuinely worse than ClickUp: a screen capture of our product carries a client name, a matter
   number, a ledger balance and often the opposing party, and an image defeats every text-based control
   at once. **The long tail of specificity** — a question specific enough to be useful is occasionally
   specific enough to identify, and no rule separates those; only a norm, a moderator and a fast undo
   do. Attachments are therefore off at launch, and the moderation posture is remove-first.

6. **A general discussion space is still not built.** The 511R analysis applies to that space and only
   to that space, and ClickUp reached the same conclusion in August 2025 from an entirely different
   direction. "Build what ClickUp does" and "do not build a general forum" are the same instruction.

**Considered & rejected:** **Shipping all three at once** (couples a zero-risk surface to a permanent
duty); **a separate forum product beside the board** (two moderation surfaces, two identity models, and
the conversion path between a question and a request is lost — the thing ClickUp's single-post-kind
board cannot do); **a general discussion category "with a rule against practice advice"** (a rule a
moderator must police post-by-post is not a rule; the absent category is the control); **keeping the
first draft's recommendation against the forum** (it was scoped to lawyers discussing representations
and did not survive contact with what the reference product means by the word). Extends **ADR-0044**
(whose package boundary, native-build reasoning, data model and escalation bridge all stand, and whose
`discussion` seam this wakes as designed) and **ADR-0048** (unchanged). Spec:
[`docs/specs/2026-08-11-community-surfaces-design.md`](../specs/2026-08-11-community-surfaces-design.md).
