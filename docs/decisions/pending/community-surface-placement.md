---
slug: community-surface-placement
status: Proposed
area: Community / Delivery model
date: 2026-08-11
summary: "The community board is PUBLIC TO READ and login-to-write, as ClickUp's is — a change from the first draft, which put it entirely behind the login and under-weighted the acquisition value of a prospect seeing an active board with staff replying in-thread. But public and INDEXED are different things: the board is `noindex` permanently, because ClickUp's public voter list with real names was located through a web search, which is the harm demonstrated rather than theorised. The board becomes its own deployable, `apps/community-worker`, because it is the only surface in the estate serving unauthenticated public reads of user-authored content, its availability is not load-bearing for billable work, and the `@magna-carta/community` package's no-per-firm-binding isolation is far stronger as a property of the deployment than as a lint rule. The public changelog needs no compute at all — static assets, no `main`, no bindings, more fate-isolated than the status worker, which at least reads KV. No Durable Object anywhere: vote counting is a unique constraint plus a counter, and the no-preview-URLs constraint is already priced in repo-wide since all thirteen workers in `apps/` set `preview_urls: false`. Recommended domain, now blocking: `changelog.magnacarta.esq` and `community.magnacarta.esq` beside the shipped status page — ClickUp likewise serves both product-side at `feedback.clickup.com`, not on a marketing microsite."
---

**Public to read, login to write, `noindex` always; the board is its own worker and the changelog is
static assets.**

**Context:** The owner described the hierarchy as login, then main application, then other (marketing,
forums), and asked whether these belong in the app, on the marketing site, or in their own worker,
noting that a Worker implementing a Durable Object gets no Cloudflare preview URLs. A first draft put
the board inside the application behind the login. The owner then directed the design at ClickUp, whose
board is publicly readable — and studying it changed two of the three placement answers.

**Decision:**

1. **The board is public to read and login-to-write, as ClickUp's is.** The first draft was wrong to
   gate reads. The acquisition value is real and was under-weighted: a prospect who sees an active board
   with staff replying in-thread is seeing evidence the product is alive, and no marketing page can
   manufacture that. Writing requires a session **and a provisioned firm**.

2. **`noindex` on the entire board, permanently, from the first byte.** Public and indexed are different
   things and the difference is the whole design. **ClickUp's public voter list — real names, "243 more"
   — was located through a web search**, which is the mechanism of harm demonstrated rather than
   theorised. A human who follows a link sees the board; a crawler does not keep it. The cost is search
   traffic, which was never the point: the changelog carries the indexable acquisition content, and it
   is indexed.

3. **The board is its own deployable — `apps/community-worker`** — binding the control-plane database
   and validating Better Auth sessions. Not routes on `apps/worker`, for three reasons: it is **the only
   surface in the estate serving unauthenticated public reads of user-authored content**, so its blast
   radius should not be the application's; its availability is not load-bearing for a firm doing billable
   work; and the `@magna-carta/community` package boundary from the 2026-06-17 design — no firm-scoped
   data-access layer, no per-firm binding — **is far stronger as a property of the deployment than as a
   lint rule**, because a deployable that cannot reach those bindings cannot regress into using them.
   The isolation is the confidentiality boundary, so making it structural is the point.

4. **The public changelog needs no compute at all:** a Workers static-assets deployment with no `main`
   and no bindings. More fate-isolated than the status worker, which at least reads a KV namespace, and
   it inherits the status page's own reasoning — every response is byte-identical for every reader, so
   the edge cache key fully determines the body.

5. **The board deliberately does not copy the status worker's isolated-read split.** Status split its
   read because a status page must survive the outage it reports and its responses are identical for
   everyone; a board read is per-reader and its availability during an incident is not the point.
   **Adding a database binding to the changelog's static deployment would destroy the one property it
   has.**

6. **No Durable Object anywhere.** Vote counting is a unique constraint on `(postId, userId)` plus a
   denormalized counter; thread reads are ordinary queries. A Durable Object would add a migration
   lifecycle and a stateful deploy to a workload with neither coordination nor contention. **The
   preview-URL constraint is real and costs nothing here** — all thirteen workers in `apps/` already set
   `preview_urls: false`, so no workflow depends on them. The reason to avoid a Durable Object is that
   nothing needs one, not the preview URLs.

7. **Recommended domain, now blocking on the owner: `changelog.magnacarta.esq` and
   `community.magnacarta.esq`, beside the shipped `status.magnacarta.esq`.** The owner states
   `magna-carta.com` is marketing and `magnacarta.esq` is the product, while the white paper's _Delivery
   model_ hosts table puts marketing, the help center, intake **and the public product-updates pages** on
   `magnacarta.esq`/`www`. Those are not the same plan and the changelog is the page they disagree about.
   Status, changelog and board are one trust surface — a reader checking what broke, what changed, and
   whether anyone else hit it is usually the same person in the same ten minutes — and splitting them
   across two registrable domains halves the credibility of both while doubling the routing and
   certificate surface. **ClickUp agrees in practice:** it serves its board at `feedback.clickup.com` and
   its changelog on the same host, both product-side, not on a marketing microsite. **A published URL is
   permanent, so this is settled before the first public page ships.**

**Considered & rejected:** **A login-gated board** (the first draft's position — withdrawn: it discards
the acquisition value, and `noindex` addresses the permanence problem that motivated it without
discarding the human reader); **indexing the board for search value** (irreversible, and ClickUp's
searchable voter list is the demonstration); **hosting on Canny as ClickUp does** (already rejected in
ADR-0044 on cost-scaling; two further reasons — their changelog and board share one vendor so one outage
takes both, and member content outside our own store cannot honour a one-click instant delete); **the
board as routes on `apps/worker`** (public reads of user-authored content should not share a blast
radius with the application, and package isolation is stronger as a deployment property); **extending
the shipped status worker to serve the changelog** (its area guidance forbids exactly this scope creep
and its fate-isolation is the point of its existence); **the board on the marketing site** (it needs the
control-plane database and session validation); **a Durable Object for vote counts** (a unique constraint
suffices); **avoiding a Durable Object because of preview URLs** (a correct conclusion from a reason that
does not apply). Extends **ADR-0044** (the package boundary is unchanged and is made structural) and
**ADR-0048**; reuses the shipped service-status placement reasoning (ADR-0186) by contrast rather than by
copy. Spec:
[`docs/specs/2026-08-11-community-surfaces-design.md`](../../specs/2026-08-11-community-surfaces-design.md).
