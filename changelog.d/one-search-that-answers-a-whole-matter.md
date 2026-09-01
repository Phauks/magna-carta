---
category: Added
audience: public
---

**A matter can be searched from one box, and the read layer behind it is a registry rather than a screen.** A matter is fourteen sections holding one case and nothing could ask that case a question: five sections had a hand-rolled search box, nine had nothing, and no query reached more than one of them.

`@magna-carta/matter-search` takes the federated timeline's architecture rather than inventing one, because it is the structurally identical problem — many subsystems, one federated read, one visibility seam, a bounded fan-out. A source declares where its rows live, which capability gates them, whether its answer is a listing or a ranked one, what it matches on, and whether it has a non-privileged snippet or declares that it has none. It is never a write-path obligation and there is no second copy of anything, so the answer cannot drift from the section a hit links into.

The shared statement builder is where the guarantees live rather than in anyone's diligence: it composes the matter binding itself, so a source cannot search across matters; it composes the visible-matter predicate before the `LIMIT`; it reads one row past the limit, so "there is more" is measured rather than estimated; and it names an `ESCAPE` on every `LIKE`. `test/source-fitness.test.ts` asserts all four over the SQL each source actually builds, plus the rule that is about disclosure rather than correctness — no registered source may name a discovery review table, because a review set is its own corpus precisely so a matter search cannot reach it.

`GET /api/v1/matters/{matterId}/search` carries two permission gates and the finer one runs first. `search:matter` gates the surface; then every source whose capability the member lacks is dropped **before a statement is built**, never post-filtered, and reported rather than returned empty. `in` narrows the registry before anything is built, which is what makes the default scope — the section the reader is standing on — the cheapest query rather than the most expensive.

`ScreenSearch` gains its first production consumer for the `scope` seam it shipped with, unchanged. The control renders from the matter **layout**, so every section inherits it and none can mount a second one; `sections.ts` now carries a required `searchSource` — a key, or `null` with the line saying what it waits on — and `pnpm run lint:matter-search-coverage` refuses a section that answers neither way, which is what makes the growth mechanical rather than remembered.

Nine sources ship — files by name, time narratives, cost descriptions, parties, notes, custody, billing lines, calendar titles and asset descriptions — and five sections decline with a reason. Notes composes `packages/notes`'s own model rather than restating it — one row, edited in place, ordered by the day the note is ABOUT rather than the day it was typed, so a hit sits where the Notes tab itself would put it. Two incidental fixes: the transport seam takes an `AbortSignal`, and the api-worker conformance suite was already red on this branch's base — the notes routes had landed without their six operation ids or a `notes` namespace binding.

## Public

**A matter can now be searched from one box, and it starts with the screen you are already on.**

Remembering "there was something about the easement" used to mean guessing which tab it was filed under and searching that tab — if it had a search box, which most did not.

The search sits at the top right of every matter screen. It opens scoped to the section you are standing on, because that is usually the question, and one click widens it to the whole matter. It never goes wider than that: searching the whole application is what the box in the top bar is for, and a search that sometimes answered with a settings page when you asked about a case would be worth trusting for neither job.

Nine parts of a matter answer today — files by name, time narratives, costs, parties, notes, the originals held in custody, bills, calendar entries and the asset register — and every result says which section it came from and what it matched on, so a hit is never a guess. The five sections that cannot answer yet are still listed, each greyed out with the line saying what it is waiting for; a section that simply vanished would teach you nothing. Results are grouped by section rather than shuffled into one ranked list, because there is no honest way to rank a file name against a note.

A section you do not have access to says so rather than coming back empty. That distinction matters more than it looks: a search that answered "nothing found" for a section you cannot see would tell you the matter holds nothing when it may hold a great deal.

Next to the scope, **Include deleted** is off by default and appears only where a searched section has a deleted set to offer. A deleted file joins the results marked as deleted, never looking live.

Top results appear under the field; **Open full results** gives the whole answer its own page, and the search lives in the address — so a reload keeps it, and a colleague can be handed the link.

Assets are matched on their description alone: an asset's account and policy numbers are sealed, and searching them would let somebody confirm a full number by typing it.

Two things it deliberately will not do. It does not look inside your files yet, only at their names, and it says so rather than implying otherwise. And it can never reach material another party produced to you in discovery: that lives in its own sealed index, which is exactly why an ordinary matter search cannot name it.
