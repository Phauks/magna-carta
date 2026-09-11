# Magnus — the owner's standing rulings

Every ruling the owner has issued on Magnus, cumulative, newest round last. **A ruling here is
settled.** It is not re-derived, re-proposed, or re-litigated by a later round, and a round that
silently reverts one is a regression, not a redesign.

The surface is the member's workspace at `apps/web/src/routes/(app)/magnus/` and the matter's own
Magnus section, which are one component (`apps/web/src/lib/magnus/magnus-surface.svelte`) over
`packages/magnus/` and `packages/inference/`.

Status values: `settled` (built and confirmed) · `regressed` (was settled, a later round undid it) ·
`open` (asked for, not yet built) · `superseded` (a later ruling replaced it, with the pointer).

## R1 — round one: the rail learns to sort, and the model becomes a choice

The owner's notes of 2026-09-11, staged. **Nothing here has been started** — the round was recorded
ahead of the work and waits on the owner's go-ahead, so every row below is `open` as a statement of
fact rather than an oversight. The research beneath each group is what the code says today.

### The rail

| #  | Ruling                                                                                                                                                                      | Status |
| -- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| R1 | **The rail sorts, and by more than one thing.** By name, by the matter the conversation is kept on, and by date — date being the default.                                   | open   |
| R2 | **The sort control is there in the empty state too.** A rail with nothing in it still shows how it would be ordered; the control is not conjured by the first conversation. | open   |
| R3 | **Renaming a conversation happens in line.** The name is edited where it is read, not by swapping the conversation's head row for a labelled field and two buttons.         | open   |

**What the code says today.** The rail is a `PagedList` read newest-first with no ordering choice at
all — the listing's order is the server's and the surface never asks for another. Sorting by name
and by matter both reach past the loaded page to be true, which is the same paging problem the
messaging correction names: an order applied to what happens to be loaded is not the order. The
matter each conversation is kept on is already carried (`matterId` on the row, resolved to a
citation through `matter-citations.svelte.ts`), so grouping by it needs no new read, only a listing
that can be asked for it.

Renaming today replaces the conversation's head row with a `Label`, an `Input`, "Save Name" and
"Cancel" — a mode the whole header enters. R3 puts the edit on the name itself.

### The conversation

| #  | Ruling                                                                                                                                                    | Status |
| -- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| C1 | **A conversation can be pointed at a matter.** Not only at the moment it is started — a conversation that turns out to belong to a matter is filed on it. | open   |
| C2 | **Files can be uploaded into a conversation.**                                                                                                            | open   |

**What the code says today.** A conversation carries `matterId` and it is set when the conversation
is STARTED (`start: { title, matterId }`); the listing filters by it, and the matter's own section
is that filter. Nothing re-files an existing conversation, so C1 is a write that does not exist yet
— and it has a real consequence to decide, because the matter a transcript is kept on is what
decides who can read it. Moving a conversation onto a matter widens or narrows its audience, which
makes C1 an access decision as much as a filing one.

C2 has no seam at all today: a turn is text, and `packages/magnus/src/limits.ts` refuses an
oversized request rather than shipping it. Files in a conversation means deciding what reaches the
model — the bytes, an extraction, or a citation — which is the question the conversation's own
disclosure (`magnus-disclosure.svelte`) exists to answer honestly.

### The model

| #  | Ruling                                                                                                                                              | Status |
| -- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| M1 | **The model is selectable.** Which model answers is a choice the firm makes and can see, rather than a value fixed behind the surface.              | open   |
| M2 | **The model list keeps itself current**, rather than being a list somebody has to remember to edit. Cloudflare's AI Gateway is the candidate route. | open   |

**What the code says today, and the tension to settle.**

- **It is a firm setting already, with no control over it.** `packages/magnus/src/settings.ts` is
  explicit that "Magnus declares NO model setting: it reads the firm's shipped
  `inference.primaryReasoningModel`", and that setting is real, defaulting to whichever catalog
  model fills the platform's reasoning tier. A firm that has chosen keeps its choice and nothing
  rewrites it. What is missing is the control: Settings · AI REPORTS the model through a read-only
  `modelFact` row, in the Versions page's definition-list voice, and offers no way to change it. So
  M1 is a control over a setting that exists, not a new axis.
- **"Not hardcoded" has two candidate meanings and they lead different places.** The stored firm
  value is not hardcoded; the CATALOG of models is — `packages/inference/src/catalog.ts`, a curated
  list of provider-prefixed, gateway-routable ids. M1 wants the first made settable; M2 is about the
  second.
- **The gateway is already wired, and it does not answer the question M2 asks.**
  `packages/inference/src/gateway.ts` pins one Cloudflare AI Gateway per environment on every
  request through the AI binding's documented options. What the catalog carries beyond an id is the
  part a roster does not supply: each entry records retention and Zero-Data-Retention facts
  "re-checked against the Anthropic reference per release", with `verifiedOn` dates, a freshness
  pass (`model-pin-freshness.ts`) and a fitness gate against pin rot. The file states the stance
  plainly — "which model the platform runs is a decision, and the freshness pass exists to put that
  decision in front of someone rather than to make it for them" — and on a platform where the
  content is privileged, ZDR is the fact that cannot be inherited from a list. So M2's work is
  likely a gateway-fed roster that still cannot be selected from until its retention posture has
  been verified, rather than a catalog the gateway replaces.

### The screen

| #  | Ruling                                                                                                                                        | Status |
| -- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| G1 | **Magnus wants a much better interface, taken as a whole.** The rows above are the specific asks; the screen itself is what the round is for. | open   |

**What the code says today.** `magnus-surface.svelte` is 858 lines carrying both presentations — the
workspace's standing rail and the matter section's switcher — behind one `rail` prop. That is the
right place for the round to land, and it is also why the round is worth taking whole: one screen
improves two.
