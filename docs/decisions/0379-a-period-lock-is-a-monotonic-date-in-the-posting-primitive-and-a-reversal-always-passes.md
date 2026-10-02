---
number: 379
slug: a-period-lock-is-a-monotonic-date-in-the-posting-primitive-and-a-reversal-always-passes
status: Proposed
date: 2026-08-17
area: Financial Core
summary: "Period close is a single monotonic lock date rather than a table of period rows — one never closes March while February stays open, so a scalar makes the illegal state unrepresentable where period rows make it representable and then need overlap and gap validation to police it. It lives in its own table rather than a firm setting, because a setting is reachable by the generic settings route and a lock any settings write can move is not a lock. The check lives INSIDE postEntry, loaded with the account snapshots it already reads and asserted by a pure leaf: a lock only the general journal honours is not a lock, and period membership is a property of the ledger's own effective_date column — the same class of rule as no-future-dating, which validateEntry already enforces — rather than a consumer rule. The consequence reaches other slices and is deliberate: a trust movement or an invoice finalization backdated into a closed period refuses by name. A REVERSAL ALWAYS PASSES, dated into the open period, which reverseEntry's fresh caller-supplied effective date already makes possible; without that exemption a firm that closed a month with a mistake in it would have to reopen the month to fix it, which makes reopening routine and the lock meaningless. The close-versus-posting race is CLOSED rather than accepted: the posting batch aims a value the lock column's date CHECK forbids at the row only when the lock has moved since the read, so a stale read aborts its own whole batch — billing's refuse-on-frozen-work pattern — with the fitness query kept as the backstop rather than the mechanism. Retained earnings is computed as income less expense to the cutoff and never posted: closing entries would have to be reversed on reopen and re-posted on every re-close, turning a derivation into a state machine."
---

**A closed period is one monotonic date, enforced in the posting primitive, and a reversing entry is
never refused by it.**

**Context:** financial statements nobody can rely on are not worth assembling, and a period that can be
reopened silently is exactly that. Period close is not in the phase-3 slice map's scope for the
operating-books slice, so whether it is built at all is the owner's; this records the shape if it is.

**Decision:**

(1) **A monotonic scalar, not period rows.** `accounting_lock.locked_through`: every effective date at
or before it is closed. Accounting close is a high-water mark, so a scalar makes the illegal state
unrepresentable where a table of open/closed periods makes it representable and then requires overlap
and gap validation to keep it honest. Its own table rather than a firm setting, because a setting is
reachable by the generic settings route and a lock any settings write can move is not a lock. Every
close and reopen appends to an append-only `period_close_event` with the actor and a required reason.

(2) **The check lives inside `postEntry`.** It loads the lock row alongside the account snapshots it
already reads, and `validateEntry` — still pure — asserts against pre-loaded values through a leaf
package that trust, billing, and the general ledger all depend on. A lock only one caller honours is not
a lock. This looks like it contradicts the ledger's rule that consumer rules bind elsewhere, and it does
not: period membership is a property of the ledger's own `effective_date` column, the same class of rule
as no-future-dating, which `validateEntry` already enforces and nobody calls a consumer rule. A
firm-configured value is compared against a column the ledger owns.

(3) **A reversal always passes.** `reverseEntry` already takes a fresh caller-supplied effective date
rather than copying the original's, so reversing a closed-period entry means dating the reversal into
the open period. The check exempts an entry carrying `reverses_entry_id` from the refusal on the
original's date and applies normally to its own. Without the exemption, fixing a mistake in a closed
month requires reopening the month, reopening becomes routine, and the lock stops meaning anything.

(4) **The race is closed, not accepted.** A posting composed against a lock value that moves before the
batch commits would otherwise land in a closed period. The batch aims a value the lock column's date
CHECK forbids at the singleton row, conditioned on the stored value differing from the one read: a
no-op when the lock has not moved, and a whole-batch abort when it has — the entry, the lines, the
balances, the idempotency record, and the outbox row together. This is billing's
refuse-on-frozen-work-in-progress pattern; a guarded UPDATE looks safer and is worse, because a zero-row
UPDATE aborts nothing. A fitness query stays as the backstop, since the guard cannot see a lock that
moved between two batches that both committed.

(5) **Retained earnings is computed, never posted.** It is income less expense to the cutoff, a pure
function of append-only rows. Posted closing entries would have to be reversed on reopen and re-posted
on every re-close, turning a derivation into a state machine — and there is no stored derived figure
anywhere else in this financial core.

(6) **A hard lock is honoured from day one and no route sets it.** `hard_locked_through` is refused by
the same check and no permission reopens it; the column stays null until a jurisdiction demands
inalterability. One comparison now against retrofitting it into every posting path later.

**Consequences:** shipped behaviour changes — a backdated trust movement or invoice finalization into a
closed period refuses by name — which is correct and is why the placement is flagged for the owner
rather than assumed. Builds on **ADR-0008** and **ADR-0072**.
