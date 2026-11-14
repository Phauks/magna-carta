---
slug: a-trust-check-number-follows-the-paper
status: Accepted
area: Trust
date: 2026-11-14
summary: "A trust check's number is the next number on the paper in the printer, not a sequence-numbering scheme: the next number is the greater of the stock's starting number and one past the highest used, unique per account and never reused. What happened to a check is an append-only event list (printed, spoiled, voided), and the number reaches reconciliation through a join, because trust_movement is append-only."
---

**A trust check's number follows the paper, and its history is events.**

**Context:** The owner, 2026-11-13: "sometimes we will need to print checks, so lets make sure we
have check printing functionality. Allow scanning a check into the app so that you can see exactly
where stuff would be printed onto." Every other number the firm issues is drawn from the one
register in `@magna-carta/sequence-numbering`, as a scheme the firm shapes.

**Decision.**

1. **A check number is not a scheme.** Preprinted check stock carries its number in the corner and
   in the magnetic-ink line, so the number is fixed by the box of paper in the printer: the firm
   cannot shape it, skip it or give one back. The next number is the greater of the stock's
   starting number (the first sheet of the current box) and one past the highest number used on
   the account. A unique index on account and number refuses a second print that read the same
   number, and the route retries once.
2. **A check is append-only, and its status is its events.** `trust_check` is written once, at
   numbering; `trust_check_event` records printed, spoiled or voided, and a trigger holds the
   allowed sequences. A spoiled or voided check keeps its number and its payment returns to the
   queue. No status column, on the same reasoning as every other trust table.
3. **The queue is derived.** A disbursement by check with no reference and no live check is
   waiting to print. Nothing is written when a disbursement is recorded, so every path that records
   one feeds the queue unchanged.
4. **Reconciliation reads the number through a join.** `trust_movement` is append-only, so the
   number cannot be written into the movement's reference after the fact. The outstanding-items and
   matches reads take the movement's reference, or the live check's number when it has none, and the
   matcher's reference signal works unchanged. `readTrustCheckRegister` is the one register the
   Checks screen and the reconciliation report both read.
5. **The browser makes the PDF.** The server numbers the checks and returns what each says; the
   page composes the PDF in a Web Worker through the composer's new placed-text block.
6. **Printing moves no money and takes no second person.** The money left the client ledger when
   the disbursement was approved under the authorization policy; voiding a check never reverses it.

**Consequences.** A firm that changes boxes saves the stock with the new starting number. A number
below one already used is ignored rather than reused. Operating-account checks, a printed MICR line
and positive-pay export are left for later; the stock and PDF code serve them when they come.
