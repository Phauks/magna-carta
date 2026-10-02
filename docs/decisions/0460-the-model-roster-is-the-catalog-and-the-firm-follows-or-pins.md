---
number: 460
slug: the-model-roster-is-the-catalog-and-the-firm-follows-or-pins
status: Proposed
date: 2026-09-11
area: AI / inference
summary: "The roster a firm chooses its reasoning model from is the platform's curated catalog and nothing else, because nothing at runtime can list models AND carry the verified retention facts a legal platform needs: the Workers AI binding exposes run, gateway and log methods but no model enumeration, the AI Gateway's unified REST API offers run, chat-completions, responses and messages but no roster, and the Anthropic passthrough would need a provider key the platform does not hold outside the gateway and could not tell the firm what a listed model retains. So the settings page offers the catalog's ZDR-eligible reasoning entries, states each entry's verification dates and the catalog's version and effective date, and says the freshness pass is what keeps the list current. The firm setting keeps its two postures: a firm that has never chosen FOLLOWS the platform's reasoning tier, and choosing the platform's option on the page deletes the firm's row rather than writing today's default, so touching the control never silently converts following into pinning."
---

**The model roster a firm chooses from is the catalog, stated with its date; a firm follows the
platform or pins a verified model, and the page cannot silently turn one into the other.**

**Context:** The owner's Magnus round asked for the model to be selectable (M1) and for the list to
keep itself current rather than being a list somebody has to remember to edit (M2), naming
Cloudflare's AI Gateway as the candidate route. The research question was whether the gateway or the
Workers AI binding can enumerate models at runtime. Read against the current Cloudflare
documentation (2026-09-11): the Workers AI binding exposes `run`, `aiGatewayLogId` and `gateway()`
with `patchLog`, `getLog` and `getUrl`, and no method that lists models; the AI Gateway REST API
documents `POST /ai/run`, `/ai/v1/chat/completions`, `/ai/v1/responses` and `/ai/v1/messages` and
points at a web catalog for browsing, with no roster endpoint; the Anthropic provider passthrough
documents the messages endpoint and takes either a provider key or a gateway-stored key, and this
platform runs on Cloudflare-managed billing with no provider key of its own. And even a roster that
could be fetched could not carry what `packages/inference/src/catalog.ts` carries per entry: a
person's recorded finding that the model is zero-data-retention eligible and not trained on, with the
dates those facts were last re-read. On a platform whose content is privileged, that finding is the
fact that cannot be inherited from a list.

The firm setting `inference.primaryReasoningModel` already had two postures that a naive control
would collapse: an unconfigured firm follows the platform's reasoning tier and moves forward with it,
while a firm holding a model id keeps that choice forever. A dropdown that wrote a model id on the
firm's behalf would convert "follow" into "pinned" the first time anybody touched it.

**Decision:** The roster is the catalog's reasoning entries, every one of which is ZDR-eligible by
the catalog's own refinement. `GET /api/v1/firm/ai/settings` returns them with their retention facts,
both verification dates, the provider's published retirement date and the tier each occupies, plus
the catalog's version and effective date; the settings page states those beside the control, and
states that the platform's verification pass is what keeps the roster current. The catalog's
verification is not removed or bypassed; a model joins the roster only through it.

The control offers "the platform's current model" and each roster entry through the product's
combobox. `PATCH` with `model.modelId: null` DELETES the firm's setting row, returning the firm to
following the platform; `model.modelId: "<roster id>"` writes it, pinning the firm; an id off the
roster is refused with a 422. The response reports `selection: "platform" | "chosen"`, read from the
row's existence rather than its value, so the two postures are legible and neither is converted into
the other by accident. Magnus's availability read reports the answering model so the composer can
name it.

**Considered and rejected:** **A runtime roster from the gateway or the binding** — there is none to
fetch, and one that existed could not carry the verified facts. **Storing the tier name as the
setting value** — it would let the firm's row express "follow", but every consumer of the setting
reads a model id today and the read is total; the row's absence already expresses "follow" exactly,
and deleting a row is a smaller change than teaching every reader a second value shape. **Writing
today's default when the firm chooses the platform's option** — that is the silent conversion this
decision exists to prevent.

**Consequences:** Moving the platform forward is still a catalog edit or a deploy-time tier override,
and a firm that follows moves with it while a firm that pinned does not until it chooses again. The
roster is as fresh as the catalog, which is as fresh as the freshness pass makes somebody look; the
page says so rather than implying a live list. A future runtime source, if one appears, would be a
second column marking which of its entries the catalog has verified, and only those selectable — the
catalog stays the authority on what may process firm content.
