# Trust — check printing

**Date:** 2026-11-14
**Scope:** Owner request of 2026-11-13: "sometimes we will need to print checks, so lets make sure
we have check printing functionality. Allow scanning a check into the app so that you can see
exactly where stuff would be printed onto." Split from the reconciliation design on the owner's
word ("checks and reconciliation should be different threads").
**Status:** Design, building. The layout screen follows the owner's pick from the board in the
project files (`trust-reconciliation/`: check layout X, Y or Z, and the Checks tab).
**Builds on:** the shipped trust movements (`packages/trust/src/movements.ts`, a disbursement's
`method` and `reference`), the three-way reconciliation (`three-way-proof.ts`, `matching.ts`), and
the PDF composer (`crates/pdf-compose-core`). Sibling design:
[`2026-11-14-trust-reconciliation-screen-design.md`](2026-11-14-trust-reconciliation-screen-design.md)
on the reconciliation thread's branch.

---

## 1. What a firm does, and what the product does for it

A firm pays money out of trust by check. Today it records the disbursement with method `check` and,
if it remembers, types the check number into the reference. Nothing prints the check, nothing
numbers it, and nothing keeps a spoiled check's number.

After this design:

1. A disbursement recorded with method `check` and no reference lands in the account's **To print**
   queue.
2. The person picks the checks to print. The server numbers them from the account's next number in
   one batch, and the browser composes a PDF with each field at its stored position on the paper.
3. After printing, the person answers per check: **printed** or **spoiled**. A spoiled check is
   voided with its number kept, and the payment goes back to To print for a new number.
4. A check that already left the office can be **voided** later (lost, stale, stopped). Voiding
   records the fact and returns the payment to To print for a replacement. It never moves money:
   cancelling the payment itself is a trust movement under the authorization policy, and the dialog
   says so.

How Clio and CosmoLex do the same (templates per stock, a test print on plain paper, checks only
from recorded payments, spoiled checks voided with their numbers kept) is in
`trust-reconciliation/findings.md` in the project files. Neither lets a firm place fields over a scan
of its own stock; this does.

## 2. The register

### 2.1 Tables

**`trust_check`**: one row per check number ever used on an account. Append-only (triggers).

| Column                                | Meaning                                                                |
| ------------------------------------- | ---------------------------------------------------------------------- |
| `id`                                  | `trustCheck_` handle                                                   |
| `trust_account_id`                    | the account the paper belongs to                                       |
| `check_number`                        | integer, unique per account, never reused                              |
| `movement_id`                         | the disbursement it pays; null for a number voided with no payment     |
| `stock_id`                            | the layout version it printed with; null for a number voided unprinted |
| `payee`, `amount_minor`, `currency`   | copied from the movement at numbering, so the register reads alone     |
| `effective_date`                      | the date printed on the check                                          |
| `numbered_by`, `numbered_at`          | who printed it and when                                                |

**`trust_check_event`**: append-only. `check_id`, `kind` (`printed`, `spoiled`, `voided`), `reason`
(required on `spoiled` and `voided`), `recorded_by`, `recorded_at`. The current status is the latest
event, or `numbered` when there is none (the batch was printed and nobody has answered yet). Allowed
sequences: `numbered → printed → voided`, `numbered → spoiled`, `numbered → voided`. Triggers refuse
any other.

Why two tables rather than a status column: every trust record here is append-only so the history
an examiner asks about is the row set itself. A status column would be an UPDATE.

### 2.2 Numbers

A check number must match the paper in the printer: preprinted stock carries its number in the
corner and in the MICR line, so the firm does not shape it and cannot skip it. That is why the
number is not a `@magna-carta/sequence-numbering` scheme: the register's schemes are templates the
firm writes, counters the platform owns, and draft holds a panel gives back, and none of the three
fits a number fixed by a box of paper. The rule here is instead:

- The **next number** for an account is the greater of the stock's `starting_check_number` and one
  more than the highest number on the account. Setting a new starting number (a new box) is saving
  the stock; a starting number below a used one is ignored, so a number is never reused.
- A print batch reads the next number and inserts consecutive rows. The unique index on
  `(trust_account_id, check_number)` refuses a second batch that read the same number, and the route
  retries once on that conflict.
- A payment may have at most one live check (`numbered` or `printed`). The composer refuses a batch
  that names a payment whose check is live, and a partial unique index is not possible here because
  the status lives in events, so the check is the composer's, re-proved by the fitness read.

### 2.3 Where reconciliation reads it

`trust_movement` is append-only, so the number is not written back into the movement's
`reference`. The outstanding-items read joins the live printed check instead:
`COALESCE(printed check number, movement reference)`. The matcher's reference signal works for
printed checks without change. `readTrustCheckRegister(database, account, from, to)` is THE check
register: the Checks tab and the reconciliation report's check register section both read it.

### 2.4 The queue

To print is derived, not stored: disbursements on the account with method `check`, an empty
reference (a hand-written check is recorded with its number and never queued), and no live check.
Nothing new is written when a disbursement is recorded, so every existing path that records a
disbursement (direct, approved request, earned-fee transfer) feeds the queue with no change.

## 3. Check stock

**`trust_check_stock`**: one row per saved version, current = latest per account. Append-only.

| Column                    | Meaning                                                                   |
| ------------------------- | ------------------------------------------------------------------------- |
| `trust_account_id`        | the account                                                               |
| `version`                 | dense per account                                                         |
| `name`                    | "IOLTA checks, voucher bottom"                                            |
| `page_layout`             | `check_top`, `check_middle`, `check_bottom`, `three_per_page`             |
| `fields`                  | JSON list, below                                                          |
| `shift_x_mils`, `shift_y_mils` | whole-page offset, thousandths of an inch                            |
| `starting_check_number`   | the number on the first sheet of the current box                          |
| `scan_object_key`, `scan_sha256` | the straightened scan in the firm's bucket; null until scanned     |
| `saved_by`, `saved_at`    |                                                                           |

A **field** is `{ kind, xMils, yMils, widthMils, sizePoints, align }`, measured from the check's
top-left corner in thousandths of an inch (integers, so nothing drifts in floating point, and inches
because check stock is specified in inches). Kinds: `date`, `payee`, `amount`, `amount_words`,
`memo`, `payee_address`, `matter`, `check_number` (for blank stock with no preprinted number).

The check is 8.5 by 3.5 inches. **The MICR band**, the bottom 0.625 inch, is refused for every
field: ink there makes the bank's reader reject the check. The schema refuses it too.

The four page layouts place the check on letter paper: top (0 in), middle (3.5 in), bottom (7.5 in),
and three per page (0, 3.5 and 7 in, no stubs). On the first three, two voucher stubs repeat the
check number, date, payee, amount, matter and memo for the firm's file copy.

**The scan** is a photograph or scan of one blank check. The person marks its four corners; the
browser straightens it to 8.5 by 3.5 inches at 100 pixels per inch with a perspective transform
and uploads the result as a PNG, which goes to the firm's bucket under
`trust-check-scan/<account>/<sha256>`. It is shown behind the fields and never printed.

**Starting point.** A new stock starts from the standard positions for its page layout, so a firm
with ordinary stock prints correctly before it moves anything.

## 4. Printing

The browser asks the server to number the selected payments and gets back each check's printable
values. It then composes the PDF itself in a Web Worker with `@magna-carta/pdf-compose`: a letter
page, each field set at its position plus the stock's shift, the amount in words filled with
asterisks to the end of its box so nothing can be written in after it. Composing in the browser keeps
CPU work off the request path, and the server never holds the PDF.

The composer gains one block for this: **`Placed`**, text set at an absolute position on the
current page, outside the flow. It emits the existing text mark, so the writer does not change. A
**test page** prints the same layout with sample values and a thin outline of each box, for holding
over a real check against the light.

Amount in words is one pure function, tested to the cent ("Three thousand and 00/100").

## 5. Capabilities

Printing, answering and voiding run under `trust:manage`, the permission that already governs
recording statements. Saving stock does too. Reading the register runs under `trust:read`. The money
moved when the disbursement was approved; printing does not move money, so it takes no second
person.

## 6. Not in this design

1. **Operating-account checks.** The register keys on a trust account. An operating account has no
   payment record to print from yet; when one exists, it gets its own queue over the same stock and
   PDF code.
2. **Printing the MICR line** on blank stock with magnetic toner.
3. **Signatures** printed on the check. Trust checks are signed by hand.
4. **Positive pay** export to the bank.
