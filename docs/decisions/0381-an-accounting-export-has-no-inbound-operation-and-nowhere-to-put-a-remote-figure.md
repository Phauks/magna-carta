---
number: 381
slug: an-accounting-export-has-no-inbound-operation-and-nowhere-to-put-a-remote-figure
status: Proposed
date: 2026-08-17
area: Integrations
summary: "QuickBooks is a sync and never a system of record, and the property is made structural in four ways rather than stated as a policy. The accounting integration category's CapabilityDescriptor declares EXPORT OPERATIONS ONLY — there is no pullJournal, no applyRemoteEntry, no fetchBalance, no reconcileAgainstRemote — and a fitness assertion rejects any operation name in the category matching an import shape, so a capability that does not exist cannot be called by a future route. There is nowhere to put a remote figure: no quickbooks_id on ledger_entry, no external_balance column anywhere, no table reconciling the two books. The only remote state stored is an append-only accounting_export_dispatch row recording what was sent, when, and what the remote said — it records that a fact LEFT and has no column that could hold a fact that came back, which is the load-bearing schema decision, because the day a remote balance is rendered beside the platform's own figure a reader has two answers and no rule about which is right. On conflict the platform does one of two things and says which: an export refusal is a dispatch outcome, recorded and retried through the outbox and surfaced through the standard error pipeline; a divergence caused by somebody editing the remote is NOT DETECTABLE and is not simulated, because detecting it requires reading remote balances, which is exactly the read that would make the remote authoritative — so the user documentation says in plain words that the platform's books are the firm's books and an edit made on the far side does not come back. A source scan asserts no domain package imports the adapter port and that the port returns no monetary figure into one. A bank feed is the one import that would be legitimate — a bank statement is evidence rather than a competing book — and it is reserved with no table, no port method and no column, because reserving a shape for an importer whose reconciliation surface does not exist would be designing the retrofit in."
---

**The accounting integration can only export, and the schema has nowhere to store a figure that came
back.**

**Context:** the roadmap records QuickBooks as an optional sync and never a system of record. Stated as a
policy that is a sentence somebody has to keep honouring; the platform's books are what a bar-audit pack
is produced from, so a read-back that ever became authoritative would put an examiner's document
downstream of a spreadsheet nobody controls.

**Decision:**

(1) **The direction is one-way out because there is no inbound operation.** The `accounting` category's
`CapabilityDescriptor` declares export operations only. No `pullJournal`, `applyRemoteEntry`,
`fetchBalance`, or `reconcileAgainstRemote`. A fitness assertion rejects any operation name in the
category matching an import shape, so the absence is enforced rather than observed. The change feed is
the entry-posted topic `postEntry` already emits, consumed through the transactional outbox with the
ordinary at-least-once, dead-letter, and dedup-on-the-outbox-row behaviour.

(2) **There is nowhere to put a remote figure.** No `quickbooks_id` on `ledger_entry`, no
`external_balance` anywhere, no table reconciling the two books. The only remote state is an append-only
`accounting_export_dispatch` row: what was sent, when, the outcome, and the remote's reference. It
records that a fact left. This is the load-bearing part — a design with a remote balance column has
already lost, because the day that column is rendered beside the platform's figure a reader has two
answers and no rule about which is right.

(3) **On conflict the platform does one of exactly two things, and says which.** An export refusal is a
dispatch outcome: recorded, retried through the outbox, surfaced through the standard error pipeline with
a correlated identifier, and the books are unaffected because the export failing changed nothing about
what happened. A divergence caused by somebody editing the export on the far side is **not detectable**,
is not simulated, and is stated as outside what the platform asserts — detecting it needs a read of
remote balances, which is the read that would make the remote authoritative. The user documentation says
it in plain words rather than leaving a reader to infer it.

(4) **Nothing reads the remote to answer a question about the firm's books.** A source scan asserts no
domain package imports the adapter port and that the port surface returns no monetary figure into one.
The adapter is its own Worker behind a typed port, receives plaintext credentials at call time only, and
never sees key material.

(5) **An export is not refused because the remote reports its own period closed.** The remote's period
state is the remote's business; refusing on it would be the platform taking instruction from the system
it exports to, which is the read-back in a different coat.

(6) **A bank feed is reserved and nothing more.** It is the one import that would be legitimate, because
a bank statement is evidence rather than a competing book, and the platform already has the right shape
for it in the trust bank statement, its guided import, its suggest-only matching, and its
one-line-clears-one-entry rule. No table, no port method, no column now: reserving a shape for an
importer whose reconciliation surface does not exist would be designing the retrofit in.

**Consequences:** a firm's accountant gets its journal in their tool of choice, and a firm that edits on
the far side has two books with the platform's being the one every compliance artifact derives from —
which the documentation says out loud. The adapter Worker itself is Phase 7·2. Builds on **ADR-0015**
and **ADR-0072**.
