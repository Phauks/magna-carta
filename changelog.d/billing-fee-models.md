---
category: Added
---

Billing — all four fee models, on the invoice spine. How a matter is billed is now something the
firm records rather than something the platform assumes: an hourly matter bills exactly as before, a
flat-fee matter bills its agreed amount, a contingency matter bills a share of what was actually
recovered, and a retainer matter watches its trust balance against a floor.

**The fee agreement is a versioned record, and a fee change is a new version.** Each matter carries
at most one agreement in force; amending it keeps the old version with the dates it governed, and
every bill composed under an agreement names the exact version — so what a finalized invoice was
computed under stays answerable years later, however many times the deal changed. A matter with no
recorded agreement is billed hourly, as every matter always has been.

**A flat fee shows the client one line and still tracks the work.** The fee line carries the agreed
amount (or a stated instalment of it), and the time it covered is claimed at zero — attributed for
profitability and realization, locked as billed when the invoice finalizes, and never what the
client is charged. Charging a flat-fee matter by the hour is refused outright, naming the agreement.
Billing instalments past the agreed total is possible on purpose and reported by a fitness query
rather than silently blocked.

**A contingency fee is computed, never stored.** The firm records the recovery — the settlement,
judgment, or award — and the fee is derived at the moment the bill is composed: the agreed share,
against the gross recovery or the recovery net of advanced costs as the agreement elects. A wrongly
entered recovery is voided with a reason, never edited. There is no settlement disbursement
statement here: money in trust still leaves only through the existing earned-fee application against
the finalized bill.

**An evergreen retainer has a floor the firm can act on.** The agreement records the target balance
and the replenishment threshold; the platform reads the matter's available trust balance (money
under a hold does not count), says where it stands, and can record a replenishment request — the
observed balance, the shortfall, who asked. The request moves no money and sends nothing; one is
open per matter at a time, and the below-floor automation belongs to a later slice over the same
event this emits.

**A bill spanning several matters renders per-matter pages plus a summary, at the firm's choice.**
The firm sets its default (per-matter pages ships as the default), any single bill can override it
at finalization, and the choice is snapshot onto the invoice like the letterhead — changing the
default later never re-shapes a bill already sent. The per-page derivation is readable now; the PDF
itself is separate work against the same model.
