---
slug: the-providers-model-list-informs-and-never-offers
status: Accepted
area: AI / inference
date: 2026-11-09
summary: "The catalog moves to the current Anthropic generation (version 4): Opus 5.5, Sonnet 5.5, Opus 5 and Sonnet 5 become selectable reasoning entries, Opus 4.8 and Sonnet 4.6 stay for firms that pinned them, and the utility slot moves from claude-haiku-4-5 (past its earliest published retirement) to claude-haiku-5-5. The platform may now read Anthropic's live GET /v1/models with an optional read-only key, cached, and the AI settings screen reports per roster entry whether it is still published and which published models are not yet curated. The live list is information beside the roster and never a source of choices: a model becomes selectable only through a catalog entry that records its retention facts."
---

**What the provider publishes is stated beside the roster and decides nothing.**

**Context:** The firm's model picker offered `claude-opus-4-8` and `claude-sonnet-4-6` only, two
generations behind, and the pin-freshness gate failed on `claude-haiku-4-5`, whose earliest published
retirement (2026-10-15) had passed. The owner asked that the model choice reflect the models that
actually exist. The catalog-era record of how pins rot (`0315-a-model-pin-carries-the-date-it-was-last-true`)
named the gap this leaves: no in-repo data can show a successor released since the last check.

**Vendor-quoted**, read on 2026-11-09 from Anthropic's model-deprecations page: `claude-opus-5-5`
(retires not sooner than 2027-09-22), `claude-sonnet-5-5` (2027-09-28), `claude-opus-5` (2027-07-24),
`claude-sonnet-5` (2027-06-30), `claude-opus-4-8` (2027-05-28), `claude-sonnet-4-6` (2027-02-17) and
`claude-haiku-5-5` (2027-10-07) are Active. From Anthropic's zero-data-retention page the same day:
the Covered Models (`claude-fable-5-1`, `claude-fable-5` and the Mythos counterparts) require 30-day
retention and are not available under ZDR; no other current model is excepted.

**Decision:**

1. **Catalog version 4.** The four current-generation reasoning models join the roster with their
   facts re-read; the previous two stay, because a firm that pinned one made a decision about its own
   content that a catalog edit must not reverse. `supersededBy` is cleared on entries whose successor is
   now curated, since the field marks a successor nobody has decided about. The utility slot moves to
   `claude-haiku-5-5`; no code calls that slot today, so the move changes no running behaviour. Each
   entry gains the provider's display name for the screen.
2. **The provider's list is read, cached, and reconciled — never offered.** With an
   `ANTHROPIC_MODELS_API_KEY` secret set, the settings route reads `GET /v1/models` (three-second
   timeout, Workers Cache API, six hours on success and five minutes on failure). The screen reports
   whether each roster entry is still listed and names published models the roster does not carry.
   None of those becomes selectable: the list carries no retention finding, and some published models
   (the Covered Models) must never be offered. Absent the key, the screen says the check is not
   configured and the roster is unchanged.
3. **The key is not an inference credential.** Inference still reaches the model only through the AI
   binding; the key lists models and nothing else.

**Consequences:** The freshness gap named in 0315 is closed at request time for an administrator to
read, while the gate itself stays offline and credential-free. Which model occupies each reasoning tier
remains an owner decision recorded in the catalog.
