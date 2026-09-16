---
category: Added
audience: internal
---

**Two guards on the migration lineage, both closing gaps the audit found rather than suspected.**

`tooling/migration-integrity/` now diffs each lineage against the schema it claims to build: it applies the whole chain to node:sqlite and compares the result with `src/declared-tables.ts`, naming the table or column that disagrees. The package's own notes already prescribed exactly this comparison as something to do BY HAND when a divergence was suspected, which means it ran after the damage rather than before it.

The gap was wide open rather than theoretical. Hand-written migrations are the normal case here, so most of the lineage is authored beside the schema rather than derived from it — and the check that looks like it would catch a divergence does not, because `refresh-snapshot` re-derives the snapshot FROM the TypeScript, leaving snapshot and schema agreeing with each other and disagreeing with every database. Measured on the way in: 201 declared tables against 206 live, the five extras being the FTS5 virtual table and its shadow tables, and zero column drift. The discipline was holding; nothing was enforcing it. The FTS5 extras are enumerated by exact name in `UNDECLARED_BY_DESIGN`, not matched by prefix, so the next undeclared table is a finding rather than something the rule swallows.

`runPendingMigrations` now reports **out-of-order arrivals** — a pending migration whose tag sorts before a tag the database has already applied. Apply order is tag order, but the chain grows from parallel branches, and two merging can seat a migration behind one that already shipped: a database that woke in between applies the pair in the order it met them, while one provisioned afterwards applies them in tag order. Independent migrations reach the same schema either way; ones that touch the same objects do not, and that divergence is otherwise silent, because the ledger is a set of tags with nothing recording which arrived late.

It reports rather than refuses: the migration is genuinely pending and genuinely needed, and stranding a database over a usually-harmless condition would be worse. The report carries `outOfOrderTags` and `ledgerHead`, measured before the batch lands; a firm database holds it for its diagnostic read and the control-plane pass emits one `migration.arrivedOutOfOrder` event per tag.

The two migrations that prompted this were checked: they are independent, and both orders produce byte-identical schemas.
