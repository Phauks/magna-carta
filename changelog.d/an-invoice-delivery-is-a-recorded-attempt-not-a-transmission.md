---
category: Added
audience: public
---

Billing — the invoice delivery record: `invoice_delivery`, one append-only row per attempt at getting
a bill to its client, so **"has this bill been given to the client" is finally a question the
platform can answer.** It was specified, its identifier prefix was registered, and the table did not
exist.

**"Sent" is deliberately not an invoice status, and this is why.** A bill goes out possibly several
times and possibly by several channels, and a re-send is not a change to the financial record.
Modelling delivery as a status would force the finalized invoice row to stay mutable for its least
load-bearing field, which is the one concession that stops an append-only table being one. So a
second delivery is a second row: channel, recipient reference, the firm-supplied delivery date, an
optional external reference, the outcome, and who recorded it. Three triggers hold append-only
unconditionally — including the BEFORE INSERT guard that catches `INSERT OR REPLACE`, which fires
neither of the other two because SQLite runs `recursive_triggers` off by default. Two more hold what
a row may describe: a delivery names a **finalized** bill (a draft is still being written; a voided
draft was never issued to anybody), and it cannot predate the bill's own issue date, which is the one
thing about a firm-supplied date the platform can check.

**It records a delivery; it does not perform one — and that is the design rather than a shortfall.**
Nothing here renders an invoice and nothing carries one to a client. Every row is a delivery the firm
made and is reporting: handed over at a meeting, put in the post, emailed from the firm's own mailbox,
submitted to the client's own e-billing portal. Out-of-band delivery is the common case, so a table
that could only hold deliveries the platform itself performed would leave the question unanswerable
for exactly the firms that most need to answer it.

**Surfaced, never a gate.** `readInvoiceDeliveryState` rides the invoice detail read rather than
waiting to be asked for separately, because the surface that has to show it is the one where a firm
decides to take fees out of a client's trust ledger — several jurisdictions expect the client to have
been given a bill first — and a fact that must be fetched on purpose is a fact a surface forgets to
show. Finalization alone still gates. The reasoning is uncomfortable and worth keeping written down:
a hard delivery gate would be satisfied by firms recording deliveries that never happened, which
converts a compliance record into a checkbox and makes the record worse than not having one.

**The state read is built to answer the two questions that look like one.** A bill with no rows has
never been sent; a bill with three failed attempts has been chased and has not landed. Both are "not
delivered", and the attempt counts are what tell them apart — a surface showing one message for both
would tell a firm nothing it needs. The recorded date is the **first** success, not the most recent
one, because when the client was first given the bill is the question a jurisdiction asks and a
courtesy re-send weeks later does not move it. A batched form answers a whole set of open receivables
in one query, since a reminder pass asking per invoice would be an N+1 against the table that grows
with a firm's whole billing history.

`billing.invoice.delivered` is emitted in the same batch as the write, carrying identifiers, the
channel, and the outcome — and never the recipient reference. A client's address is the client's own
fact and a topic payload fans out to every subscriber's notification record; it resolves behind the
deep link, through billing's own access-checked read.

Migration idx 68 (`20260817T000000_billing-invoice-delivery`); two new chokepoint routes on the
existing `billing:draft` and `billing:read` keys, so no permission inventory moved. A PII registry
entry for the recipient reference, on the footing the contact a firm records reaching a client it
holds unclaimed money for sits on.

**Two owner questions this raised and did not answer.** Whether a delivery recorded in error may be
superseded by a correcting row — the table is append-only and the design names no correction shape,
unlike a credit note, whose answer is a further credit note. And the `outcome` vocabulary, which the
design names as a column without enumerating: `delivered` and `failed` are the built floor rather
than an answered set.

## Public

**You can now record that a bill went out — and show it.**

Say how the client got it (posted, handed over, emailed, or submitted to their e-billing portal), who
received it, the date it reached them, and whether it arrived. Record it whenever you like: a bill
you posted last Tuesday carries last Tuesday's date, not today's.

Magna Carta does not send the bill for you. That is the point of recording it this way — most bills
go out by means you arrange yourself, and what matters is being able to show the client got it, not
which system carried it.

**Every attempt is its own permanent record.** A bill sent twice has two. A letter that came back
followed by a successful re-send reads as exactly that. Nothing you record is edited or deleted
afterwards, which is what makes it worth having when a client disputes a fee years later.

**And it shows up where it matters.** When you are about to take your fees out of a client's trust
money, the bill tells you whether there is any record of the client having received it — several
places expect that before fees come out of trust. It does not stop you. It tells you, and the
decision stays yours.
