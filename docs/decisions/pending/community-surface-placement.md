---
slug: community-surface-placement
status: Proposed
area: Community / Delivery model
date: 2026-08-11
summary: "The feature board is an IN-APP, LOGIN-GATED surface in `apps/worker` and the application shell — not a public website — which removes its indexing, public-identity, anonymous-abuse and competitive-leakage problems in one move; the public gets a curated three-column roadmap projection instead. The public changelog needs no compute at all: a Workers static-assets deployment with no `main` and no bindings, more fate-isolated than the status worker because it reads nothing. The board deliberately does NOT copy the status worker's isolated-read split — status split its read because a status page must survive the outage it reports and its responses are byte-identical for every reader, and neither holds for a board whose read is per-reader and whose availability is not load-bearing during an incident; adding a database binding to the public read worker would break the one invariant that worker has. No Durable Object anywhere: vote counting is a unique constraint plus a counter, and the constraint that a Worker implementing a Durable Object gets no preview URLs is already priced in repo-wide, since all thirteen workers in `apps/` set `preview_urls: false` today. The `magna-carta.com` versus `magnacarta.esq` split is a live contradiction between the owner's statement and the white paper's hosts table and needs settling before the first public URL exists."
---

**The board lives inside the application; the changelog is static assets with no bindings; no Durable
Object.**

**Context:** The owner described the surface hierarchy as login, then main application, then other
(marketing, forums), and asked whether these belong in the app, on the marketing site, or in their own
worker — noting that a Worker implementing a Durable Object gets no Cloudflare preview URLs. The
platform already has a strong precedent in the shipped service-status design: the write path lives in
`apps/worker` and an isolated, bindingless-except-KV read worker serves the public page. The question
is whether that split generalizes. It does for the changelog and it does not for the board, and the
reasons are worth recording so nobody harmonizes them later.

**Decision:**

1. **The feature board is a login-gated, in-app surface** — `/community` behind the session, in the
   existing application shell, served by `apps/worker`, which already binds the control-plane database
   and already holds Better Auth. In the owner's own hierarchy it sits in **main application**, not in
   *other*. Four reasons, each sufficient: a logged-out board is a page full of member content that is
   permanently `noindex`, so it has no acquisition value and only the risks; it deletes the
   anonymous-read abuse surface entirely (scraping, enumeration, unauthenticated rate-limit design); a
   complete public list of everything customers wish the product did is competitive intelligence given
   away for nothing; and behind a session, among verified firms, a feature request is a statement about
   software rather than about a matter, so the confidentiality analysis barely applies. The public
   "what is coming" need is met by a **curated three-column roadmap projection** on the public
   changelog surface — no vote counts, no author attribution, hand-selected.

2. **The public changelog is a Workers static-assets deployment with no `main` and no bindings.** It is
   a build-time artifact rendered to static pages; there is nothing to invoke and nothing to read. That
   is **more** fate-isolated than the status worker, which at least reads a KV namespace, and it
   inherits the status page's own reasoning: every response is byte-identical for every reader, so the
   edge cache key fully determines the body.

3. **The board's read path deliberately does not copy the status split, and the asymmetry is
   intentional.** Status split its read into an isolated worker for two reasons: a status page must
   survive the very outage it reports, and its responses are identical for everyone. Neither holds
   here. A board read is per-reader (your own vote state differs), so it is not cacheable that way, and
   a board being unavailable during an incident is fine — being up during an incident is the status
   page's job, not the board's. **Adding a database binding to the public read worker to serve the
   board would break the one invariant that worker has** and buy nothing.

4. **No Durable Object anywhere in this design.** Vote counting is a unique constraint on
   `(postId, userId)` plus a denormalized counter in the control-plane database; a Durable Object would
   add a migration lifecycle and a stateful deploy to a workload with neither coordination nor
   contention. **The preview-URL constraint the owner raised is real and costs nothing here**, because
   it is already priced in repo-wide: all thirteen workers in `apps/` set `preview_urls: false` today,
   so no workflow depends on them. The reason to avoid a Durable Object is that nothing needs one — not
   the preview URLs.

5. **The `@magna-carta/community` package boundary from the 2026-06-17 design is retained unchanged**,
   including its fitness function: no dependency on the firm-scoped data-access layer and no per-firm
   binding. The isolation is the confidentiality boundary and keeps a later repository split cheap.

6. **A forum, if one were ever built, gets its own deployable on its own host** — precisely so it can
   be turned off without touching the product.

7. **Recommended domain: the public changelog goes on `magnacarta.esq`, beside status.** The status
   page already shipped at `status.magnacarta.esq`, and status and changelog are the same trust surface
   — a reader checking whether something is broken and a reader checking what changed are usually the
   same person, mid-incident. Splitting them across two registrable domains halves the credibility of
   both and doubles the routing and certificate surface. The cost is that search-engine value accrues
   to the product domain rather than the marketing domain, which is small. **This is flagged as
   unresolved and needs the owner:** the owner states `magna-carta.com` is marketing and
   `magnacarta.esq` is the product, while the white paper's _Delivery model_ hosts table puts
   marketing, the help center, intake **and the public product-updates pages** on `magnacarta.esq`/`www`.
   Those are not the same plan and the changelog is the page they disagree about. A published URL is
   permanent, so this is settled before the first public page ships, not after.

**Considered & rejected:** **A public, logged-out feature board** (trades member content and
competitive intelligence for acquisition value that `noindex` has already removed); **an isolated
public read worker for the board, mirroring status** (responses are per-reader, availability is not
load-bearing during an incident, and the binding it would need is the one the status worker's invariant
forbids); **extending the shipped status worker to also serve the changelog** (its own area guidance
forbids exactly this scope creep, and its fate-isolation is the point of its existence); **putting the
board on the marketing site** (it needs a session and the control-plane database, which is the app
worker's job); **a Durable Object for vote counts** (a unique constraint suffices; a stateful deploy
for no gain); **avoiding a Durable Object because of preview URLs** (a correct conclusion from a reason
that does not apply — the repo already sets `preview_urls: false` everywhere). Extends **ADR-0044**
(the package boundary is unchanged) and **ADR-0048**; reuses the shipped service-status placement
reasoning (ADR-0186) by contrast rather than by copy. Spec:
[`docs/specs/2026-08-11-community-surfaces-design.md`](../../specs/2026-08-11-community-surfaces-design.md).
