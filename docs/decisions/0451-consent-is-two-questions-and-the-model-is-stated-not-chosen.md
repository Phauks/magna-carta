---
number: 451
slug: consent-is-two-questions-and-the-model-is-stated-not-chosen
status: Proposed
date: 2026-09-09
area: AI / Inference
summary: "The firm-administrator AI settings screen writes exactly the two consent gates the assistant's resolver reads and nothing else, under a new `firm:manageAiSettings` seeded to Owner/Admin alone rather than riding `magnus:converse` — asking the assistant a question is ordinary work that seeds to Attorney and Paralegal, while consenting for the whole firm that privileged client content may leave the platform is not, so the work key must not be the consent key. The two gates stay two controls and are never collapsed or inferred from one another, because a firm that enabled inference for drafting has not consented to a free-form assistant and a firm that switched the assistant off has not withdrawn consent for everything else; the screen additionally states the EFFECTIVE composition, because an assistant switched on above a closed processing gate does nothing and a screen showing only `Magnus: On` would report that it works. The firm's reasoning model is REPORTED with its pinned snapshot and both confidentiality facts and cannot be selected: a control writing `inference.primaryReasoningModel` would silently convert a firm that follows the platform's evergreen reasoning tier into one pinned to today's occupant of that tier, so selection waits on a setting that can express the tier itself. The screen does not pre-empt the pending client-consent decision, because reaching a provider takes a third, deploy-level switch (`MAGNUS_INFERENCE_ADAPTER`) that is absent by default and resolves to a stub; the screen therefore claims consent recorded, never content in flight."
---

**A consent screen is worth exactly what its statements are worth. This one writes two gates because
consent is two questions, states the model because consenting to an unnamed recipient is consenting to
nothing legible, and declines to claim content is in flight because a third gate it cannot see decides
that.**

**Context:** Both firm settings the assistant depends on —
`inference.aiProcessingEligibility` and `magnus.enabled` — had shipped with a fail-closed resolver, a
re-read before the model call, and **no writer at all** except the generic settings write path. Every
firm's assistant surface therefore rendered its honest closed state, and that closed state was one no
administrator could leave. The design that built the assistant said as much: it argued slice 1 was safe
to merge unconsented precisely because nothing was transmitted by a merged, **unconfigured** slice, and
named the enablement screen as the thing that would later switch it on.

**Decision:**

**One permission, and not the one that already existed.** `firm:manageAiSettings`, seeded to Owner/Admin
alone. `magnus:converse` seeds to Attorney and Paralegal because holding a conversation is ordinary
firm work; reusing it here would let any seat that can ask a question decide, for the whole firm, that
asking is allowed. That is the `firm:manageScanPolicy` / `firm:manageReportPolicy` bracket, and the
route test seeds exactly a `magnus:converse` holder and asserts 403 on the read and the write alike.

**Two controls, never one.** The outer gate asks whether this firm's content may reach a third-party
model at all; the inner asks whether the free-form assistant is one of the things that may send it.
Neither is inferable from the other in either direction. The screen also states the composition in a
sentence, over the STAGED values, so an administrator sees what will be true after saving rather than
what was true before.

**The model is stated, not chosen.** The route reports `inference.primaryReasoningModel` with its
provider-published snapshot and both confidentiality facts, and accepts no model field. The asymmetry
this protects is deliberate and already recorded in the inference settings: a firm that has never
chosen follows the platform's evergreen reasoning tier and moves forward as the tier moves, while a
firm holding a model id keeps that id forever. A dropdown writing an id would convert the first kind of
firm into the second by the act of touching it, which is not what a selection control should mean.
Selection therefore waits on a setting whose value is a tier.

**The screen records consent; it does not claim transmission.** Reaching a provider needs a third gate
this screen cannot read — the deployment's own `MAGNUS_INFERENCE_ADAPTER`, absent by default and
resolving to a stub that reaches no provider. So both switches open means the firm has consented, and
the screen says exactly that. Claiming content is being sent would be false in every deployment today,
and an overstatement about where privileged client content goes is the worst error this particular
screen could make.

**Consequences:**

The pending client-consent decision is **not** pre-empted: the deploy-level switch still stands between
a consenting firm and a provider, and it is set by hand outside this repository. What changes is that
"off" becomes a state a firm chose rather than one it could not leave.

Two things are deliberately left open. Reporting the third gate on the screen needs the route to expose
it, which is a contract change nobody has asked for yet; until then the screen is silent about the
deployment rather than wrong about it. And a firm cannot choose its model until the tier-expressing
setting exists.

The daily turn ceiling rides this permission rather than a spend-specific one, because it is a control
on exactly the traffic these gates open, and separating it would mean a firm could consent to the
spend without consenting to the processing.
