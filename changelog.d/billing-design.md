---
category: Added
---

Billing and invoicing — design. The specification for the slice where time, costs, and trust converge
into a bill, and the answer to the question the trust subsystem shipped without: what evidence
permits money to leave a client's trust account.

**A draft bill is a working document; a finalized one is an evidentiary record.** Before finalization
everything is editable — lines re-worded, entries added and removed, the whole thing thrown away.
Finalization happens in a single all-or-nothing step: an invoice number is drawn, every time and cost
entry on the bill locks, the receivable posts to the books, and the amount owed becomes a figure that
cannot be exceeded. After that nothing about the invoice is ever edited. A bill issued in error is
corrected by a credit note — a second permanent record rather than the erasure of the first — and
"sent" is deliberately not a status, because a bill can be delivered several times by several
channels and a re-send is not a change to a financial record.

**Taking earned fees out of trust now requires a finalized invoice with enough unpaid balance on that
matter, with no override.** The transfer names the invoice it is paying, and the amount is checked
not by looking first but by a database constraint that rides the same transaction — so a payment or a
credit note landing a moment earlier aborts the whole thing rather than letting the firm take money
twice. Partial applications are the normal case: an evergreen retainer pays what it can and the rest
stays owed. The transfer itself is still composed by the trust subsystem, which needed no change at
all to accept the new rule — billing supplies the evidence and never touches a trust record.

**The hard case is stated rather than solved.** When a firm credits a bill after the fee has already
been transferred out of trust, the trust ledger is not rewound: the transfer was valid, the entries
are permanent, and the client's money genuinely moved. What is left is money in the firm's operating
account that the firm has conceded is not its own. The platform records that as an open credit the
firm cannot lose track of, names the three real ways to discharge it — refund it, return it to the
client's trust ledger, or apply it to a future bill — and moves no money on its own, because which of
those is right is a decision about firm funds and not an invoicing question.

**Taxes take the same refusing posture as everything jurisdiction-specific here.** The platform ships
the machinery to charge tax and encodes no knowledge of when tax is owed: no rate table, no
taxability catalog, no default. A firm that has configured nothing gets no tax line, which is the
correct outcome for most law firms, and a firm that owes tax configures its own rates.

Bills combine hourly fees, flat fees, advanced costs, discounts, and tax; one bill covers one client
and may span several of that client's matters, with every line naming its own matter so trust money
applies to the right one. Contingency and retainer arrangements are recorded now and compute nothing
— settlement disbursement statements, with their lien priorities, wait for verified sources rather
than being invented.

Two specs, one decision record, four build sub-slices, and fourteen owner decisions each carrying a
recommended default. No product code in this cycle.
