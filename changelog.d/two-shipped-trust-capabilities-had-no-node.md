---
category: Fixed
audience: internal
---

The build register was missing two capabilities that shipped weeks ago. The bank-charge cushion (the firm-funds carve-out) and the unclaimed client funds diligence file each have their own domain module, their own per-firm tables, their own routes, and in one case their own capability seeded to Owner and Admin alone — and neither appeared anywhere in the feature ledger, so neither was counted.

This is the drift class the staleness linter records as structurally uncatchable: every rule it holds reasons **from** a node, so nothing can find one that was never written. Finding a missing node means reasoning from the tree inward, which no rule does.

Both are recorded at `shipped` with the note the register's own convention asks for — backend only, no screen — and with what each deliberately does **not** do, because in both cases the incompleteness is the design rather than a gap. The carve-out has no movement that withdraws surplus firm funds and none that pays a person: the rule text authorizes the deposit and is silent on taking it back out. Nothing on the unclaimed-funds path moves money at all — the closure takes a movement that already posted and receives no amount, payee, date or method, so the manual-confirmation gate is the absence of the inputs rather than a check somebody could later remove.

The register now stands at 707 capabilities, 248 of them shipped.
