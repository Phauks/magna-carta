---
slug: a-firm-chooses-per-matter-whether-transferred-money-is-view-only
status: Accepted
area: Financial
date: 2026-11-12
summary: "When a firm's records are transferred in, the firm decides for each matter whether that matter's earlier money arrives as view-only history beside the live ledger with an opening balance, or as live ledger entries that can be worked on here. The owner ruled the per-matter choice on 2026-11-12. The default of view-only, the lock at cutover, and writing live entries through a transfer-only path are the author's recommendation. Trust reconciliation gates cutover for both."
---

**A firm chooses, matter by matter, whether transferred money is view-only.**

**Context:** The record-transfer framework brings a firm's history in from the system it is leaving. Money is the part with two defensible answers. Held as view-only history, it cannot be damaged or misread by posting rules written for entries made here, and that is how LEAP itself receives firms from other systems (its `conversions/trusttransactionsviewonly` and `conversions/officehistory` endpoints, reference version 1.3.0). Held as live entries, a matter still in progress can be billed, paid and corrected here without a second system open beside it. The framework's design recommended view-only for everything and left the question to the owner.

**Decision.** The owner ruled on 2026-11-12: "allow firms to decide per case when importing if previous money should be view-only." Each matter in a transfer carries a money handling of view-only or live, chosen by the firm when importing.

The author's recommendations, which make the ruling buildable and are open to the owner's correction:

1. **View-only is the default**, for a matter and for a firm that chooses nothing, with a firm-wide default the operator can set.
2. **Live entries are written as the source recorded them, through a transfer-only path.** That path keeps the ledger's structural invariants in `docs/conventions/invariants.md` and skips the rules about how an entry is made (approval, authority, rate lookup), which history cannot satisfy.
3. **A live matter whose history cannot form a valid ledger is reported, never switched silently.** The operator fixes the cause or sets the matter to view-only.
4. **The choice locks at cutover.** It is free to change across rehearsals and fixed once the live firm is written.

**Consequences.** Slice 7 of the framework builds two write paths for money where the recommendation had one, and the rehearsal report shows each matter's handling beside its totals. The trust gate ADR-0021 named applies to both: every matter's trust balance equals the source's and the total equals the bank. A view-only matter's history must also sum to its opening balance. The transfer-only path is a second way into an append-only ledger and is the part of this decision that needs the closest review when it is built; nothing of it exists yet.
