---
category: Changed
audience: internal
---

**A flag that gates a build and lives only in a spec is not a flag. Fifteen `awaiting-owner` keys
existed across the whole feature ledger while six merged designs carried roughly seventy numbered
owner flags between them; the register's "Waiting on you" section now carries thirty.**

The ledger's `awaiting-owner` key is the register's only channel for "this is waiting on you", and it
had almost nothing in it. Meanwhile the last two days of design work produced five lettered flag
series — S (trust PDF statement import), N (the Nevada court-form library), K (payments), J (client
intake), W (notes, activity, tasks and matter plans) — plus older sets in conflicts deepening and
unified identity that no pass had ever surfaced. Those flags lived in `docs/specs/` and in merged
pull-request bodies, which is to say nowhere the owner looks.

**Fifteen lines added, not seventy.** The whole point of the key is that the section stays readable,
so the rule applied was: surface a flag when the answer changes what gets built — whether a slice
ships at all, a schema shape or an enum that is expensive to shrink, or a professional-conduct
posture the platform must not choose on a firm's behalf. Leave out anything that only decides how an
already-agreed build is written (thresholds, vocabularies, retention windows, capability names,
defaults reversible by a setting), because those get answered when the work starts and competing for
the same attention makes the blocking ones harder to find. Where several flags block one capability
they are compressed into that node's single line; where a flag is a conduct question rather than a
product one, the line says so, because it wants a different kind of attention.

Each line is written to be answerable without opening the spec — what is being decided, and what
turns on each way of deciding it — and names the design and flag numbers for the full list.

**Nodes that gained a line:** `matters` and `matters.lifecycle.consultations`; the whole of `intake`
(root, lead pipeline, public forms, conflict check, conversion); `tasks` and `tasks.matter-plans`;
`financial.trust.reconciliation` and `financial.billing.corrections`; `payments.ach`;
`document-automation.filing-grade-generation`; `conflicts`; `auth`.

**Swept and found already settled**, so deliberately not resurfaced: the merge-field catalog, matter
assets, calendar, auto-file rules, billing, discovery 5·1, AI Search, template expressions, Magnus
and document automation flag sets were closed by the owner's 2026-08-07 docket (ADR-0255) and its
same-day follow-ups, and the handful that docket does not name by number were answered by the builds
that followed — `matter_assignment` and `matter_court_case` exist, so the merge-field catalog's
platform-tables question is decided; the auto-file rules node ships the staged-by-default posture;
the calendar's no-arithmetic position is ratified in ADR-0261; Magnus's context boundary is recorded
on `ai.magnus.context` as the ratified answer for the next slice.

No node's `status` changed. `docs/now.md` is regenerated from the ledger, as always.
