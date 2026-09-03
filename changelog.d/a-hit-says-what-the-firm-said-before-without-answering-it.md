---
category: Added
audience: public
---

**A hit carries what the firm already said about the same party — as context, and nothing more.**
The sixth and last read of the conflicts read surface, built under the owner's ruling of 2026-09-02.

`readPriorConclusions` matches on the ENTITY alone, across every check but the one in hand, and the
check response carries the result as `previouslyAnswered` — a field deliberately separate from
`disposition`, so a hit with an earlier answer about the same party is still **unanswered**.

The case that settled the rule, and the reason a narrower key would not be safer: a company cleared
in March under Rule 1.9 as a FORMER client re-surfaces in September through the graph, as the
subsidiary of a CURRENT client. That is a Rule 1.7 question on a materially higher bar. Same entity,
different question. Matching on the entity and presenting the March clearance as the September hit's
answer would carry a judgment across two conflicts that are not the same conflict.

Both narrower keys were rejected on that same case rather than a different one. Adding the source
class would hide the September hit precisely BECAUSE it arrived through the graph; adding the
evidence tier would make a firm turning on the over-inclusive band look like a new conflict. Neither
makes the judgment safer — they only move where it is wrong.

It needed a second index. `conflicts_hit` carried only `(check_id)`, so matching a party across
earlier checks scanned a table that is append-only and only grows;
`conflicts_hit_entity_created_index` on `(entity_id, created_at)` holds it, with a plan probe beside
the two check-history probes.

`conflicts-gaps.ts` is now down to one entry — the assembled report document, which is its own work.

## Public

**When a candidate surfaces that your firm has answered before, the screen tells you.**

Opening it shows what was decided, when, and a link to the check where it was decided — and the
candidate stays unanswered, waiting for you.

That is deliberate. The same company can come up twice for genuinely different reasons: once as a
former client you are free to act against, and later as the subsidiary of a client you act for
today. The second question is not the first one, and the platform will not answer it for you by
quietly carrying the earlier decision across.

You get the history. The judgment stays yours, and the record says whose it was.
