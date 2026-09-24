---
category: Fixed
audience: internal
---

Eight failures the scoped gate never sees, found by the full test battery on the shipping branch.

Four were pinned state that the shipping work deliberately changed, each mechanism working as designed: the Owner/Admin permission list in `me.test.ts` and `auth-provisioning-e2e.test.ts` (which gained `integrations:useConnection`), the back-navigation exemption register — pinned by name precisely so a new exemption cannot be added without a second person reading its reason — and `tool-destinations`, which used shipping as its example of a `soon` tool. Shipping is `alpha` now; the case is about the STAGE, so it follows one of the three tools that still has it.

Two were real mistakes. A bare `window.open(url, "_blank")` in the shipment window bypassed `$lib/navigation/open-beside`, the one helper every new-tab opening goes through so the isolation a second tab gets is decided in one place rather than per caller. And the object-dimension scan read `credentials.put(...)` as a bucket write; it is the integration credential store and reaches no object storage at all, so it carries the sanctioned marker with that as its reason.

Two were one obsolete file: `shipping-unbuilt-credential-seam.test.ts` asserted that connect, rate, purchase, track and refund all refuse with 501 "because the per-firm credential read is still a seam". That read is built, so the file's premise is gone and the file with it.

Not fixed here, and not from this branch: `discovery-routes.test.ts` > "converges rather than duplicating when the same selection runs twice" fails with 409 where it expects 202. Verified against a clean worktree at `origin/main` — identical failure, same assertion — so it is pre-existing and belongs to whoever owns that lane.
